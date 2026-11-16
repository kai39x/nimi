//! «نسخ النص اللي فيها»: offline OCR with `Windows.Media.Ocr`, in the user's installed languages
//! (Arabic needs the Arabic OCR language pack; English is always there).

use std::path::Path;

use windows::{
    core::HSTRING,
    Graphics::Imaging::BitmapDecoder,
    Media::Ocr::OcrEngine,
    Storage::{FileAccessMode, StorageFile},
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

pub fn recognize(path: &Path) -> Result<String, String> {
    run(path)
        .map_err(|e| e.message().to_string())?
        .ok_or_else(|| "no-ocr-language".into())
}

fn run(path: &Path) -> windows::core::Result<Option<String>> {
    // SAFETY: initialises WinRT for this worker thread (already-initialised is fine).
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    let Ok(engine) = OcrEngine::TryCreateFromUserProfileLanguages() else {
        return Ok(None);
    };
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.join()?;
    let stream = file.OpenAsync(FileAccessMode::Read)?.join()?;
    let decoder = BitmapDecoder::CreateAsync(&stream)?.join()?;
    let bitmap = decoder.GetSoftwareBitmapAsync()?.join()?;
    // OCR has a maximum image dimension; bigger images are refused rather than scaled here.
    let max = OcrEngine::MaxImageDimension()?;
    if bitmap.PixelWidth()? as u32 > max || bitmap.PixelHeight()? as u32 > max {
        return Err(windows::core::Error::new(
            windows::core::HRESULT(-1),
            "too-big",
        ));
    }
    let result = engine.RecognizeAsync(&bitmap)?.join()?;
    // Lines keep their order; Windows joins words of right-to-left scripts correctly per line.
    let mut lines = Vec::new();
    for line in result.Lines()? {
        lines.push(line.Text()?.to_string());
    }
    Ok(Some(lines.join("\n")))
}
