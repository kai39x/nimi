//! Images through WIC (Windows Imaging Component): decode anything Windows can read, optionally
//! scale, and write PNG or JPEG. Metadata is never copied, so every output is also «مسح بيانات
//! الكاميرا». WIC has no WebP *encoder* on Windows 10/11, so conversion targets are PNG and JPG.

use std::path::Path;

use windows::{
    core::{Interface, GUID, HSTRING},
    Win32::{
        Foundation::GENERIC_WRITE,
        Graphics::Imaging::{
            CLSID_WICImagingFactory, GUID_ContainerFormatJpeg, GUID_ContainerFormatPng,
            GUID_WICPixelFormat24bppBGR, GUID_WICPixelFormat32bppBGRA, IWICBitmapSource,
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

/// Keep the format for shrink / strip: JPEG stays JPEG, everything else becomes PNG.
pub fn same_format_ext(src: &Path) -> &'static str {
    match src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "jpg",
        _ => "png",
    }
}

pub fn convert(src: &Path, out: &Path, scale: f64) -> Result<(), String> {
    let jpeg = matches!(
        out.extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .as_deref(),
        Some("jpg") | Some("jpeg")
    );
    let r = write(src, out, scale, jpeg).map_err(|e| e.message().to_string());
    if r.is_err() {
        let _ = std::fs::remove_file(out);
    }
    r
}

fn write(src: &Path, out: &Path, scale: f64, jpeg: bool) -> windows::core::Result<()> {
    // SAFETY: plain WIC usage on a COM-initialised worker thread; every interface is ref-counted.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
        let decoder = factory.CreateDecoderFromFilename(
            &HSTRING::from(src.as_os_str()),
            None,
            windows::Win32::Foundation::GENERIC_READ,
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
        let format: GUID = if jpeg {
            GUID_WICPixelFormat24bppBGR
        } else {
            GUID_WICPixelFormat32bppBGRA
        };
        let converter = factory.CreateFormatConverter()?;
        converter.Initialize(
            &source,
            &format,
            WICBitmapDitherTypeNone,
            None,
            0.0,
            WICBitmapPaletteTypeMedianCut,
        )?;

        let stream = factory.CreateStream()?;
        stream.InitializeFromFilename(&HSTRING::from(out.as_os_str()), GENERIC_WRITE.0)?;
        let container = if jpeg {
            GUID_ContainerFormatJpeg
        } else {
            GUID_ContainerFormatPng
        };
        let encoder = factory.CreateEncoder(&container, std::ptr::null())?;
        encoder.Initialize(&stream, WICBitmapEncoderNoCache)?;
        let mut frame_out = None;
        let mut props: Option<IPropertyBag2> = None;
        encoder.CreateNewFrame(&mut frame_out, &mut props)?;
        let frame_out = frame_out.ok_or_else(windows::core::Error::empty)?;
        if let (true, Some(bag)) = (jpeg, props.as_ref()) {
            let name = HSTRING::from("ImageQuality");
            let opt = windows::Win32::System::Com::StructuredStorage::PROPBAG2 {
                pstrName: windows::core::PWSTR(name.as_ptr() as *mut _),
                ..Default::default()
            };
            let value = VARIANT::from(0.9f32);
            let _ = bag.Write(1, &opt, &value);
        }
        frame_out.Initialize(props.as_ref())?;
        frame_out.SetSize(w, h)?;
        let mut pf = format;
        frame_out.SetPixelFormat(&mut pf)?;
        frame_out.WriteSource(&converter, std::ptr::null())?;
        frame_out.Commit()?;
        encoder.Commit()?;
        Ok(())
    }
}
