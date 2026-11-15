//! System master volume through Core Audio (docs/PLAN.md §3): SMTC has no volume API, so the
//! island slider and the wheel gesture drive the default render endpoint. `OnNotify` keeps the
//! orbit-ring meter in step with changes made elsewhere (keyboard keys, the Windows flyout).
//! The default device can change (headphones), so the thread re-checks it every few seconds.

use std::{
    sync::{
        mpsc::{self, RecvTimeoutError},
        Arc,
    },
    thread,
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager};
use windows::{
    core::{implement, Result, PWSTR},
    Win32::{
        Media::Audio::{
            eConsole, eRender,
            Endpoints::{
                IAudioEndpointVolume, IAudioEndpointVolumeCallback,
                IAudioEndpointVolumeCallback_Impl,
            },
            IMMDeviceEnumerator, MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
        },
    },
};

use super::{MediaShared, VolumeMsg};
use crate::ipc::{events, VolumeState};

const DEVICE_CHECK: Duration = Duration::from_secs(3);

pub fn spawn(app: AppHandle) {
    let (tx, rx) = mpsc::channel();
    let shared = app.state::<Arc<MediaShared>>().inner().clone();
    *shared.volume_tx.lock().expect("volume tx lock") = Some(tx);
    thread::Builder::new()
        .name("nimi-volume".into())
        .spawn(move || {
            // SAFETY: initialises COM (MTA) for this thread only; it lives for the app's lifetime.
            if let Err(err) = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok() {
                log::warn!("volume: COM init failed: {err}");
                return;
            }
            let mut endpoint: Option<Endpoint> = None;
            loop {
                // Follow the default output device.
                let id = default_device_id().ok();
                if endpoint.as_ref().map(|e| Some(&e.id)) != Some(id.as_ref()) {
                    endpoint = id.and_then(|id| Endpoint::open(&app, &shared, id).ok());
                    publish(
                        &app,
                        &shared,
                        endpoint.as_ref().map(Endpoint::read).unwrap_or_default(),
                    );
                }
                match rx.recv_timeout(DEVICE_CHECK) {
                    Ok(msg) => {
                        if let Some(e) = endpoint.as_ref() {
                            let res = match msg {
                                // SAFETY: COM calls on a live interface; no out-pointers.
                                VolumeMsg::Set(level) => unsafe {
                                    e.volume
                                        .SetMasterVolumeLevelScalar(level as f32, std::ptr::null())
                                },
                                VolumeMsg::Mute(muted) => unsafe {
                                    e.volume.SetMute(muted, std::ptr::null())
                                },
                            };
                            if let Err(err) = res {
                                log::info!("volume change failed: {err}");
                            }
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        })
        .expect("spawn volume thread");
}

struct Endpoint {
    id: String,
    volume: IAudioEndpointVolume,
    callback: IAudioEndpointVolumeCallback,
}

impl Endpoint {
    fn open(app: &AppHandle, shared: &Arc<MediaShared>, id: String) -> Result<Self> {
        // SAFETY: standard Core Audio activation on a COM-initialised thread.
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            let callback: IAudioEndpointVolumeCallback = VolumeCallback {
                app: app.clone(),
                shared: shared.clone(),
            }
            .into();
            volume.RegisterControlChangeNotify(&callback)?;
            Ok(Self {
                id,
                volume,
                callback,
            })
        }
    }

    fn read(&self) -> VolumeState {
        // SAFETY: COM getters on a live interface.
        unsafe {
            VolumeState {
                level: self
                    .volume
                    .GetMasterVolumeLevelScalar()
                    .map(f64::from)
                    .unwrap_or(0.0),
                muted: self.volume.GetMute().map(|m| m.as_bool()).unwrap_or(false),
                available: true,
            }
        }
    }
}

impl Drop for Endpoint {
    fn drop(&mut self) {
        // SAFETY: unregisters the callback we registered on this interface.
        unsafe {
            let _ = self.volume.UnregisterControlChangeNotify(&self.callback);
        }
    }
}

fn default_device_id() -> Result<String> {
    // SAFETY: standard Core Audio calls; the id string is freed with CoTaskMemFree.
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let raw: PWSTR = device.GetId()?;
        let id = raw.to_string().unwrap_or_default();
        CoTaskMemFree(Some(raw.0 as *const _));
        Ok(id)
    }
}

fn publish(app: &AppHandle, shared: &MediaShared, state: VolumeState) {
    let mut current = shared.volume.lock().expect("volume lock");
    if *current != state {
        *current = state;
        drop(current);
        let _ = app.emit(events::MEDIA_VOLUME, state);
    }
}

#[implement(IAudioEndpointVolumeCallback)]
struct VolumeCallback {
    app: AppHandle,
    shared: Arc<MediaShared>,
}

impl IAudioEndpointVolumeCallback_Impl for VolumeCallback_Impl {
    fn OnNotify(&self, data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> Result<()> {
        // SAFETY: Core Audio passes a valid pointer for the duration of the call.
        if let Some(d) = unsafe { data.as_ref() } {
            publish(
                &self.app,
                &self.shared,
                VolumeState {
                    level: f64::from(d.fMasterVolume),
                    muted: d.bMuted.as_bool(),
                    available: true,
                },
            );
        }
        Ok(())
    }
}
