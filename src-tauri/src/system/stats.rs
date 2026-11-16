//! CPU / RAM / GPU / battery sampling (design spec §5 and §15). Cheap totals every tick; the
//! per-app breakdown and the GPU counters only while the panel is open.

use std::{collections::HashMap, ffi::c_void, mem::size_of, time::Instant};

use windows::{
    core::{w, PCWSTR},
    Wdk::Graphics::Direct3D::{
        D3DKMTCloseAdapter, D3DKMTOpenAdapterFromLuid, D3DKMTQueryAdapterInfo,
        D3DKMT_ADAPTER_PERFDATA, D3DKMT_CLOSEADAPTER, D3DKMT_OPENADAPTERFROMLUID,
        D3DKMT_QUERYADAPTERINFO, KMTQAITYPE_ADAPTERPERFDATA,
    },
    Win32::{
        Foundation::{FILETIME, LUID},
        Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE},
        System::{
            Performance::{
                PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData,
                PdhGetFormattedCounterArrayW, PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W,
                PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
            },
            Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
            SystemInformation::{
                GetLogicalProcessorInformationEx, GlobalMemoryStatusEx, RelationProcessorCore,
                MEMORYSTATUSEX,
            },
            Threading::{GetActiveProcessorCount, GetSystemTimes, ALL_PROCESSOR_GROUPS},
        },
    },
};

use super::procs::{self, Proc};
use crate::ipc::{BatteryInfo, CpuStats, GpuStats, RamStats, TopApp};

pub struct Sampler {
    cores: u32,
    threads: u32,
    last_sys: Option<(u64, u64)>, // (busy, total) in 100 ns
    last_procs: HashMap<u32, u64>,
    last_procs_at: Option<Instant>,
    gpu: Option<Gpu>,
    gpu_tried: bool,
}

impl Sampler {
    pub fn new() -> Self {
        // SAFETY: plain queries.
        let threads = unsafe { GetActiveProcessorCount(ALL_PROCESSOR_GROUPS) }.max(1);
        Self {
            cores: physical_cores().unwrap_or(threads),
            threads,
            last_sys: None,
            last_procs: HashMap::new(),
            last_procs_at: None,
            gpu: None,
            gpu_tried: false,
        }
    }

    pub fn cpu_ram(&mut self, detailed: bool) -> (CpuStats, RamStats) {
        let usage = self.cpu_usage();
        let (used, total) = memory();
        let (top_cpu, top_ram) = if detailed {
            self.top_apps()
        } else {
            (None, None)
        };
        if !detailed {
            // A stale baseline would turn the next detailed tick into a long average.
            self.last_procs_at = None;
        }
        (
            CpuStats {
                usage,
                cores: self.cores,
                threads: self.threads,
                top: top_cpu,
            },
            RamStats {
                usage: if total > 0 {
                    used as f64 / total as f64 * 100.0
                } else {
                    0.0
                },
                used,
                total,
                top: top_ram,
            },
        )
    }

    fn cpu_usage(&mut self) -> f64 {
        let (mut idle, mut kernel, mut user) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        // SAFETY: valid out-pointers.
        if unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.is_err() {
            return 0.0;
        }
        let total = ft(kernel) + ft(user); // kernel time includes idle time
        let busy = total.saturating_sub(ft(idle));
        let usage = match self.last_sys {
            Some((b0, t0)) if total > t0 => {
                (busy.saturating_sub(b0)) as f64 / (total - t0) as f64 * 100.0
            }
            _ => 0.0,
        };
        self.last_sys = Some((busy, total));
        usage.clamp(0.0, 100.0)
    }

    /// Top CPU (since the last detailed tick) and top RAM app, grouped by exe.
    fn top_apps(&mut self) -> (Option<TopApp>, Option<TopApp>) {
        let list = procs::list();
        let now = Instant::now();
        let elapsed_100ns = self
            .last_procs_at
            .map(|t| now.duration_since(t).as_nanos() as f64 / 100.0);
        let mut cpu: HashMap<&str, (f64, &Proc)> = HashMap::new();
        let mut ram: HashMap<&str, (f64, &Proc)> = HashMap::new();
        let mut next = HashMap::with_capacity(list.len());
        for p in &list {
            next.insert(p.pid, p.cpu_time);
            if let (Some(el), Some(prev)) = (elapsed_100ns, self.last_procs.get(&p.pid)) {
                let share = p.cpu_time.saturating_sub(*prev) as f64
                    / (el * f64::from(self.threads))
                    * 100.0;
                cpu.entry(&p.exe).or_insert((0.0, p)).0 += share;
            }
            ram.entry(&p.exe).or_insert((0.0, p)).0 += p.private_bytes as f64;
        }
        self.last_procs = next;
        self.last_procs_at = Some(now);
        let pick = |m: HashMap<&str, (f64, &Proc)>, min: f64| {
            m.into_values()
                .filter(|(v, _)| *v >= min)
                .max_by(|a, b| a.0.total_cmp(&b.0))
                .map(|(value, p)| TopApp {
                    name: procs::display_name(&p.path, &p.exe),
                    exe: p.exe.clone(),
                    category: procs::category(&p.exe),
                    value,
                })
        };
        (pick(cpu, 0.5), pick(ram, 50.0 * 1024.0 * 1024.0))
    }

    pub fn gpu(&mut self) -> Option<GpuStats> {
        if !self.gpu_tried {
            self.gpu_tried = true;
            self.gpu = Gpu::open();
        }
        self.gpu.as_mut().map(Gpu::sample)
    }
}

fn ft(t: FILETIME) -> u64 {
    (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime)
}

fn memory() -> (u64, u64) {
    let mut m = MEMORYSTATUSEX {
        dwLength: size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // SAFETY: dwLength is set as the API requires.
    if unsafe { GlobalMemoryStatusEx(&mut m) }.is_err() {
        return (0, 0);
    }
    (
        m.ullTotalPhys.saturating_sub(m.ullAvailPhys),
        m.ullTotalPhys,
    )
}

fn physical_cores() -> Option<u32> {
    let mut len = 0u32;
    // SAFETY: first call sizes the buffer; the second fills it; records are walked by their Size.
    unsafe {
        let _ = GetLogicalProcessorInformationEx(RelationProcessorCore, None, &mut len);
        if len == 0 {
            return None;
        }
        let mut buf = vec![0u8; len as usize];
        GetLogicalProcessorInformationEx(
            RelationProcessorCore,
            Some(buf.as_mut_ptr() as *mut _),
            &mut len,
        )
        .ok()?;
        let (mut off, mut count) = (0usize, 0u32);
        while off + 8 <= len as usize {
            // Each SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX starts with Relationship (u32), Size (u32).
            let size = u32::from_le_bytes(buf[off + 4..off + 8].try_into().ok()?) as usize;
            if size == 0 {
                break;
            }
            count += 1;
            off += size;
        }
        (count > 0).then_some(count)
    }
}

pub fn battery() -> Option<BatteryInfo> {
    let mut s = SYSTEM_POWER_STATUS::default();
    // SAFETY: valid out-pointer.
    unsafe { GetSystemPowerStatus(&mut s) }.ok()?;
    // 128 = no system battery, 255 = unknown.
    if s.BatteryFlag & 128 != 0 || s.BatteryFlag == 255 || s.BatteryLifePercent > 100 {
        return None;
    }
    Some(BatteryInfo {
        percent: s.BatteryLifePercent,
        charging: s.ACLineStatus == 1,
    })
}

// --- GPU ---------------------------------------------------------------------------------------

/// The main GPU (DXGI adapter 0 unless it is the software renderer) with PDH counters for
/// utilization and dedicated memory, plus D3DKMT for the temperature (what Task Manager reads).
struct Gpu {
    name: String,
    luid: LUID,
    tag: String,
    vram_total: u64,
    query: PDH_HQUERY,
    engine: PDH_HCOUNTER,
    memory: PDH_HCOUNTER,
}

impl Drop for Gpu {
    fn drop(&mut self) {
        // SAFETY: the query was opened by `Gpu::open`.
        unsafe {
            let _ = PdhCloseQuery(self.query);
        }
    }
}

impl Gpu {
    fn open() -> Option<Self> {
        // SAFETY: COM-free DXGI factory; PDH handles are owned by the returned value.
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
            let mut chosen = None;
            for i in 0..4 {
                let Ok(adapter) = factory.EnumAdapters1(i) else {
                    break;
                };
                let Ok(desc) = adapter.GetDesc1() else {
                    continue;
                };
                if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 || desc.VendorId == 0x1414
                {
                    continue;
                }
                chosen = Some(desc);
                break;
            }
            let desc = chosen?;
            let len = desc
                .Description
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(desc.Description.len());
            let name = String::from_utf16_lossy(&desc.Description[..len])
                .trim()
                .to_string();
            let luid = desc.AdapterLuid;
            let tag = format!("luid_0x{:08x}_0x{:08x}", luid.HighPart as u32, luid.LowPart)
                .to_lowercase();

            let mut query = PDH_HQUERY::default();
            if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
                return None;
            }
            let mut engine = PDH_HCOUNTER::default();
            let mut memory = PDH_HCOUNTER::default();
            let ok_engine = PdhAddEnglishCounterW(
                query,
                w!("\\GPU Engine(*)\\Utilization Percentage"),
                0,
                &mut engine,
            ) == 0;
            let ok_memory = PdhAddEnglishCounterW(
                query,
                w!("\\GPU Adapter Memory(*)\\Dedicated Usage"),
                0,
                &mut memory,
            ) == 0;
            if !ok_engine {
                let _ = PdhCloseQuery(query);
                return None;
            }
            let _ = PdhCollectQueryData(query); // first sample: rates need two
            Some(Self {
                name,
                luid,
                tag,
                vram_total: desc.DedicatedVideoMemory as u64,
                query,
                engine,
                memory: if ok_memory {
                    memory
                } else {
                    PDH_HCOUNTER::default()
                },
            })
        }
    }

    fn sample(&mut self) -> GpuStats {
        // SAFETY: handles owned by self.
        unsafe {
            let _ = PdhCollectQueryData(self.query);
        }
        // Task Manager's number: per engine type, sum all processes; the busiest engine type wins.
        let mut per_type: HashMap<String, f64> = HashMap::new();
        for (instance, value) in counter_array(self.engine) {
            let lower = instance.to_lowercase();
            if !lower.contains(&self.tag) {
                continue;
            }
            let kind = lower.rsplit("engtype_").next().unwrap_or("").to_string();
            *per_type.entry(kind).or_default() += value;
        }
        let usage = per_type
            .values()
            .copied()
            .fold(0.0, f64::max)
            .clamp(0.0, 100.0);
        let vram_used = if self.memory == PDH_HCOUNTER::default() {
            0
        } else {
            counter_array(self.memory)
                .into_iter()
                .filter(|(i, _)| i.to_lowercase().contains(&self.tag))
                .map(|(_, v)| v)
                .sum::<f64>() as u64
        };
        GpuStats {
            name: self.name.clone(),
            usage,
            vram_used,
            vram_total: self.vram_total,
            temp_c: temperature(self.luid),
        }
    }
}

/// `(instance name, value)` pairs of a wildcard counter.
fn counter_array(counter: PDH_HCOUNTER) -> Vec<(String, f64)> {
    let mut out = Vec::new();
    let (mut size, mut count) = (0u32, 0u32);
    // SAFETY: the first call sizes the buffer; items point into it while it lives.
    unsafe {
        let r = PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, None);
        if r != PDH_MORE_DATA || size == 0 {
            return out;
        }
        let mut buf = vec![0u8; size as usize];
        let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
        if PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items))
            != 0
        {
            return out;
        }
        for i in 0..count as usize {
            let item = &*items.add(i);
            if item.FmtValue.CStatus != 0 {
                continue;
            }
            let name = item.szName.to_string().unwrap_or_default();
            out.push((name, item.FmtValue.Anonymous.doubleValue));
        }
    }
    out
}

fn temperature(luid: LUID) -> Option<f64> {
    // SAFETY: the adapter handle is opened and closed here; perf data is a local.
    unsafe {
        let mut open = D3DKMT_OPENADAPTERFROMLUID {
            AdapterLuid: luid,
            ..Default::default()
        };
        if D3DKMTOpenAdapterFromLuid(&mut open).is_err() {
            return None;
        }
        let mut perf = D3DKMT_ADAPTER_PERFDATA::default();
        let mut query = D3DKMT_QUERYADAPTERINFO {
            hAdapter: open.hAdapter,
            Type: KMTQAITYPE_ADAPTERPERFDATA,
            pPrivateDriverData: &mut perf as *mut _ as *mut c_void,
            PrivateDriverDataSize: size_of::<D3DKMT_ADAPTER_PERFDATA>() as u32,
        };
        let ok = D3DKMTQueryAdapterInfo(&mut query).is_ok();
        let _ = D3DKMTCloseAdapter(&D3DKMT_CLOSEADAPTER {
            hAdapter: open.hAdapter,
        });
        // Deci-degrees Celsius; 0 means the driver does not report it.
        (ok && perf.Temperature > 0 && perf.Temperature < 1500)
            .then(|| f64::from(perf.Temperature) / 10.0)
    }
}
