//! Images: decode anything Windows' WIC can read (the `image` crate covers WebP when the
//! Windows codec is missing), optionally scale, and write PNG / JPG / BMP / TIFF through WIC,
//! WebP through libwebp (`webp` crate, lossy q 82), ICO through `image`, PDF through `pdf.rs`.
//! Metadata is never copied, so every output is also «مسح بيانات الكاميرا».

use std::path::{Path, PathBuf};

use windows::{
    core::{Interface, GUID, HSTRING},
    Win32::{
        Foundation::{GENERIC_READ, GENERIC_WRITE},
        Graphics::Imaging::{
            CLSID_WICImagingFactory, GUID_ContainerFormatBmp, GUID_ContainerFormatJpeg,
            GUID_ContainerFormatPng, GUID_ContainerFormatTiff, GUID_WICPixelFormat24bppBGR,
            GUID_WICPixelFormat32bppBGRA, GUID_WICPixelFormat32bppRGBA, IWICBitmapSource,
            IWICImagingFactory, WICBitmapDitherTypeNone, WICBitmapEncoderNoCache,
            WICBitmapInterpolationModeFant, WICBitmapPaletteTypeMedianCut,
            WICDecodeMetadataCacheOnDemand,
        },
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, StructuredStorage::IPropertyBag2,
                CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
            },
            Variant::VARIANT,
        },
    },
};

/// Decoded straight RGBA, 8 bits per channel.
pub struct Pixels {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

impl Pixels {
    fn has_alpha(&self) -> bool {
        self.rgba.chunks_exact(4).any(|p| p[3] != 255)
    }

    /// JPEG, BMP and PDF have no transparency: put it on white (not black).
    fn on_white(&self) -> Pixels {
        let mut rgba = self.rgba.clone();
        for p in rgba.chunks_exact_mut(4) {
            let a = u32::from(p[3]);
            for c in &mut p[..3] {
                *c = ((u32::from(*c) * a + 255 * (255 - a)) / 255) as u8;
            }
            p[3] = 255;
        }
        Pixels {
            w: self.w,
            h: self.h,
            rgba,
        }
    }
}

pub fn ext_of(p: &Path) -> String {
    match p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
        .as_str()
    {
        "jpeg" | "jpe" | "jfif" => "jpg".into(),
        "tif" => "tiff".into(),
        e => e.to_string(),
    }
}

/// Shrink / strip keep the format when we can write it; anything else becomes PNG.
pub fn same_format_ext(src: &Path) -> &'static str {
    match ext_of(src).as_str() {
        "jpg" => "jpg",
        "webp" => "webp",
        "bmp" => "bmp",
        "tiff" => "tiff",
        _ => "png",
    }
}

/// What an image can become (the second bubble arc), without its own format.
pub fn targets_for(src: &Path) -> Vec<&'static str> {
    let own = ext_of(src);
    ["png", "jpg", "webp", "pdf", "ico", "bmp", "tiff"]
        .into_iter()
        .filter(|t| *t != own)
        .collect()
}

pub fn decode(src: &Path, scale: f64) -> Result<Pixels, String> {
    match decode_wic(src, scale) {
        Ok(px) => Ok(px),
        Err(wic) => {
            // No Windows codec (e.g. WebP without the Store extension): try the image crate.
            let img = image::open(src).map_err(|_| format!("decode: {}", wic.message()))?;
            let mut rgba = img.to_rgba8();
            if scale < 1.0 {
                let (w, h) = (
                    ((f64::from(rgba.width()) * scale).round() as u32).max(1),
                    ((f64::from(rgba.height()) * scale).round() as u32).max(1),
                );
                rgba = image::imageops::resize(&rgba, w, h, image::imageops::FilterType::Triangle);
            }
            Ok(Pixels {
                w: rgba.width(),
                h: rgba.height(),
                rgba: rgba.into_raw(),
            })
        }
    }
}

fn factory() -> windows::core::Result<IWICImagingFactory> {
    // SAFETY: COM on a worker thread (MTA); WIC is free-threaded.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
    }
}

fn decode_wic(src: &Path, scale: f64) -> windows::core::Result<Pixels> {
    let factory = factory()?;
    // SAFETY: WIC calls on ref-counted interfaces; the buffer matches width × height × 4.
    unsafe {
        let decoder = factory.CreateDecoderFromFilename(
            &HSTRING::from(src.as_os_str()),
            None,
            GENERIC_READ,
            WICDecodeMetadataCacheOnDemand,
        )?;
        let frame = decoder.GetFrame(0)?;
        let (mut w, mut h) = (0u32, 0u32);
        frame.GetSize(&mut w, &mut h)?;
        let mut source: IWICBitmapSource = frame.cast()?;
        if scale < 1.0 {
            let scaler = factory.CreateBitmapScaler()?;
            let (sw, sh) = (
                ((f64::from(w) * scale).round() as u32).max(1),
                ((f64::from(h) * scale).round() as u32).max(1),
            );
            scaler.Initialize(&source, sw, sh, WICBitmapInterpolationModeFant)?;
            source = scaler.cast()?;
            (w, h) = (sw, sh);
        }
        let converter = factory.CreateFormatConverter()?;
        converter.Initialize(
            &source,
            &GUID_WICPixelFormat32bppRGBA,
            WICBitmapDitherTypeNone,
            None,
            0.0,
            WICBitmapPaletteTypeMedianCut,
        )?;
        let mut rgba = vec![0u8; (w as usize) * (h as usize) * 4];
        converter.CopyPixels(std::ptr::null(), w * 4, &mut rgba)?;
        Ok(Pixels { w, h, rgba })
    }
}

/// Writes `px` as `fmt` (png, jpg, bmp, tiff, webp, ico, pdf). Removes a half-written file.
pub fn encode(px: &Pixels, out: &Path, fmt: &str) -> Result<(), String> {
    let r = match fmt {
        "png" => wic(px, out, &GUID_ContainerFormatPng, false),
        "tiff" => wic(px, out, &GUID_ContainerFormatTiff, false),
        "jpg" => wic(&px.on_white(), out, &GUID_ContainerFormatJpeg, true),
        "bmp" => wic(&px.on_white(), out, &GUID_ContainerFormatBmp, true),
        "webp" => {
            let enc = webp::Encoder::from_rgba(&px.rgba, px.w, px.h);
            let mem = if px.has_alpha() && px.w * px.h < 256 * 256 {
                enc.encode_lossless()
            } else {
                enc.encode(82.0)
            };
            std::fs::write(out, &*mem).map_err(|e| e.to_string())
        }
        "ico" => ico(px, out),
        "pdf" => jpeg_bytes(px).and_then(|j| super::pdf::from_jpegs(&[(px.w, px.h, j)], out)),
        other => Err(format!("unsupported target {other}")),
    };
    if r.is_err() {
        let _ = std::fs::remove_file(out);
    }
    r
}

/// Icons are square and at most 256 px: pad to a square, then scale down.
fn ico(px: &Pixels, out: &Path) -> Result<(), String> {
    let img = image::RgbaImage::from_raw(px.w, px.h, px.rgba.clone()).ok_or("bad pixels")?;
    let side = px.w.max(px.h);
    let mut square = image::RgbaImage::new(side, side);
    image::imageops::overlay(
        &mut square,
        &img,
        i64::from((side - px.w) / 2),
        i64::from((side - px.h) / 2),
    );
    let icon = if side > 256 {
        image::imageops::resize(&square, 256, 256, image::imageops::FilterType::Lanczos3)
    } else {
        square
    };
    icon.save_with_format(out, image::ImageFormat::Ico)
        .map_err(|e| e.to_string())
}

/// JPEG bytes (q 0.9, on white) for embedding in a PDF.
pub fn jpeg_bytes(px: &Pixels) -> Result<Vec<u8>, String> {
    let tmp = temp_file("jpg");
    wic(&px.on_white(), &tmp, &GUID_ContainerFormatJpeg, true)?;
    let bytes = std::fs::read(&tmp).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&tmp);
    bytes
}

pub fn temp_file(ext: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    std::env::temp_dir().join(format!(
        "nimi-{}-{}.{ext}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ))
}

fn wic(px: &Pixels, out: &Path, container: &GUID, opaque: bool) -> Result<(), String> {
    write_wic(px, out, container, opaque).map_err(|e| e.message().to_string())
}

fn write_wic(px: &Pixels, out: &Path, container: &GUID, opaque: bool) -> windows::core::Result<()> {
    let factory = factory()?;
    // SAFETY: WIC encode from an in-memory bitmap that copies `px` (the slice outlives the call).
    unsafe {
        let bitmap = factory.CreateBitmapFromMemory(
            px.w,
            px.h,
            &GUID_WICPixelFormat32bppRGBA,
            px.w * 4,
            &px.rgba,
        )?;
        let format: GUID = if opaque {
            GUID_WICPixelFormat24bppBGR
        } else {
            GUID_WICPixelFormat32bppBGRA
        };
        let converter = factory.CreateFormatConverter()?;
        converter.Initialize(
            &bitmap,
            &format,
            WICBitmapDitherTypeNone,
            None,
            0.0,
            WICBitmapPaletteTypeMedianCut,
        )?;
        let stream = factory.CreateStream()?;
        stream.InitializeFromFilename(&HSTRING::from(out.as_os_str()), GENERIC_WRITE.0)?;
        let encoder = factory.CreateEncoder(container, std::ptr::null())?;
        encoder.Initialize(&stream, WICBitmapEncoderNoCache)?;
        let mut frame_out = None;
        let mut props: Option<IPropertyBag2> = None;
        encoder.CreateNewFrame(&mut frame_out, &mut props)?;
        let frame_out = frame_out.ok_or_else(windows::core::Error::empty)?;
        if let (true, Some(bag)) = (*container == GUID_ContainerFormatJpeg, props.as_ref()) {
            let name = HSTRING::from("ImageQuality");
            let opt = windows::Win32::System::Com::StructuredStorage::PROPBAG2 {
                pstrName: windows::core::PWSTR(name.as_ptr() as *mut _),
                ..Default::default()
            };
            let value = VARIANT::from(0.9f32);
            let _ = bag.Write(1, &opt, &value);
        }
        frame_out.Initialize(props.as_ref())?;
        frame_out.SetSize(px.w, px.h)?;
        let mut pf = format;
        frame_out.SetPixelFormat(&mut pf)?;
        frame_out.WriteSource(&converter, std::ptr::null())?;
        frame_out.Commit()?;
        encoder.Commit()?;
        Ok(())
    }
}
