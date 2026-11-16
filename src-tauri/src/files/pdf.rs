//! PDF meals: merge, keep some pages, compress (`lopdf`), text (`pdf-extract`, with Windows OCR
//! on rendered pages when the PDF is only scans), pages as PNG (`Windows.Data.Pdf`, built in),
//! and images → PDF (a tiny writer that embeds JPEGs as-is).

use std::{
    collections::BTreeMap,
    io::Write,
    path::{Path, PathBuf},
};

use lopdf::{Document, Object, ObjectId};
use windows::{
    core::HSTRING,
    Data::Pdf::{PdfDocument, PdfPageRenderOptions},
    Graphics::Imaging::BitmapEncoder,
    Storage::{
        StorageFile,
        Streams::{DataReader, InMemoryRandomAccessStream},
    },
    Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
};

fn load(path: &Path) -> Result<Document, String> {
    let doc = Document::load(path).map_err(|e| format!("pdf: {e}"))?;
    if doc.is_encrypted() {
        return Err("pdf-locked".into());
    }
    Ok(doc)
}

fn save(doc: &mut Document, out: &Path) -> Result<(), String> {
    let mut file = std::fs::File::create(out).map_err(|e| e.to_string())?;
    let r = doc.save_modern(&mut file).map_err(|e| e.to_string());
    if r.is_err() {
        drop(file);
        let _ = std::fs::remove_file(out);
    }
    r
}

/// «دمج»: pages of every PDF in order (based on lopdf's merge example, without bookmarks).
pub fn merge(inputs: &[PathBuf], out: &Path) -> Result<(), String> {
    let mut max_id = 1;
    let mut pages: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut objects: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut merged = Document::with_version("1.5");

    for path in inputs {
        let mut doc = load(path)?;
        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;
        for id in doc.get_pages().into_values() {
            if let Ok(page) = doc.get_object(id) {
                pages.insert(id, page.to_owned());
            }
        }
        objects.extend(doc.objects);
    }

    let mut catalog: Option<(ObjectId, Object)> = None;
    let mut root_pages: Option<(ObjectId, Object)> = None;
    for (id, object) in objects {
        match object.type_name().unwrap_or(b"") {
            b"Catalog" => {
                catalog.get_or_insert((id, object));
            }
            b"Pages" => {
                if let Ok(dict) = object.as_dict() {
                    let mut dict = dict.clone();
                    if let Some((_, ref old)) = root_pages {
                        if let Ok(old) = old.as_dict() {
                            dict.extend(old);
                        }
                    }
                    let keep = root_pages.as_ref().map_or(id, |(k, _)| *k);
                    root_pages = Some((keep, Object::Dictionary(dict)));
                }
            }
            b"Page" | b"Outlines" | b"Outline" => {}
            _ => {
                merged.objects.insert(id, object);
            }
        }
    }
    let (pages_id, pages_obj) = root_pages.ok_or("pdf: no pages")?;
    let (catalog_id, catalog_obj) = catalog.ok_or("pdf: no catalog")?;

    for (id, page) in &pages {
        if let Ok(dict) = page.as_dict() {
            let mut dict = dict.clone();
            dict.set("Parent", pages_id);
            merged.objects.insert(*id, Object::Dictionary(dict));
        }
    }
    if let Ok(dict) = pages_obj.as_dict() {
        let mut dict = dict.clone();
        dict.set("Count", pages.len() as u32);
        dict.set(
            "Kids",
            pages
                .keys()
                .map(|id| Object::Reference(*id))
                .collect::<Vec<_>>(),
        );
        merged.objects.insert(pages_id, Object::Dictionary(dict));
    }
    if let Ok(dict) = catalog_obj.as_dict() {
        let mut dict = dict.clone();
        dict.set("Pages", pages_id);
        dict.remove(b"Outlines");
        merged.objects.insert(catalog_id, Object::Dictionary(dict));
    }
    merged.trailer.set("Root", catalog_id);
    merged.max_id = merged.objects.len() as u32;
    merged.renumber_objects();
    merged.compress();
    save(&mut merged, out)
}

/// «1-3, 5, 8-» → page numbers within 1..=total.
pub fn parse_pages(spec: &str, total: u32) -> Result<Vec<u32>, String> {
    let mut keep = std::collections::BTreeSet::new();
    let digits = |s: &str| -> String {
        // Accept Arabic-Indic digits too («١-٣»).
        s.chars()
            .map(|c| match c {
                '٠'..='٩' => char::from_digit(c as u32 - '٠' as u32, 10).unwrap_or(c),
                '۰'..='۹' => char::from_digit(c as u32 - '۰' as u32, 10).unwrap_or(c),
                _ => c,
            })
            .collect()
    };
    for part in digits(spec)
        .split([',', '،', ' '])
        .filter(|p| !p.is_empty())
    {
        let (a, b) = match part.split_once('-') {
            Some((a, b)) => (a.trim(), b.trim()),
            None => (part.trim(), part.trim()),
        };
        let start: u32 = if a.is_empty() {
            1
        } else {
            a.parse().map_err(|_| "bad-pages")?
        };
        let end: u32 = if b.is_empty() {
            total
        } else {
            b.parse().map_err(|_| "bad-pages")?
        };
        for p in start.max(1)..=end.min(total) {
            keep.insert(p);
        }
    }
    if keep.is_empty() {
        return Err("bad-pages".into());
    }
    Ok(keep.into_iter().collect())
}

/// «استخراج صفحات»: a copy with only the chosen pages.
pub fn pages(src: &Path, spec: &str, out: &Path) -> Result<u32, String> {
    let mut doc = load(src)?;
    let total = doc.get_pages().len() as u32;
    let keep = parse_pages(spec, total)?;
    let drop: Vec<u32> = (1..=total).filter(|p| !keep.contains(p)).collect();
    doc.delete_pages(&drop);
    doc.prune_objects();
    doc.compress();
    save(&mut doc, out)?;
    Ok(keep.len() as u32)
}

/// «ضغط»: recompress streams, drop unused objects, object streams. Errors with `already-small`
/// when it saves less than 3 %, so we don't leave a pointless copy behind.
pub fn compress(src: &Path, out: &Path) -> Result<(), String> {
    let before = std::fs::metadata(src).map(|m| m.len()).unwrap_or(0);
    let mut doc = load(src)?;
    doc.prune_objects();
    doc.delete_zero_length_streams();
    doc.compress();
    let tmp = super::imaging::temp_file("pdf");
    save(&mut doc, &tmp)?;
    let after = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(u64::MAX);
    if after.saturating_mul(100) > before.saturating_mul(97) {
        let _ = std::fs::remove_file(&tmp);
        return Err("already-small".into());
    }
    let r = std::fs::copy(&tmp, out)
        .map(|_| ())
        .map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&tmp);
    r
}

/// «نص»: the text layer; for scanned PDFs (no text), OCR of the rendered pages (max 30).
pub fn text(src: &Path) -> Result<String, String> {
    let layer = pdf_extract::extract_text(src).unwrap_or_default();
    if layer.chars().filter(|c| c.is_alphanumeric()).count() >= 20 {
        return Ok(layer.trim().to_string());
    }
    let dir = super::imaging::temp_file("pages");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let pages = render(src, &dir, "p", 30).map_err(|e| e.message().to_string());
    let mut out = String::new();
    if let Ok(pages) = &pages {
        for page in pages {
            if let Ok(t) = super::ocr::recognize(page) {
                if !t.trim().is_empty() {
                    out.push_str(t.trim());
                    out.push_str("\n\n");
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    pages?;
    if out.trim().is_empty() {
        return Err("no-text".into());
    }
    Ok(out.trim().to_string())
}

pub fn page_count(src: &Path) -> Option<u32> {
    open_winrt(src).ok()?.PageCount().ok()
}

fn open_winrt(src: &Path) -> windows::core::Result<PdfDocument> {
    // SAFETY: WinRT on a worker thread (MTA).
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(src.as_os_str()))?.join()?;
    PdfDocument::LoadFromFileAsync(&file)?.join()
}

/// Renders up to `max` pages as PNG at 2× (≈ 144 dpi) into `dir` as «<stem> 01.png» …
pub fn render(src: &Path, dir: &Path, stem: &str, max: u32) -> windows::core::Result<Vec<PathBuf>> {
    let doc = open_winrt(src)?;
    let n = doc.PageCount()?.min(max);
    let width = (n.max(1) as f64).log10().floor() as usize + 1;
    let mut out = Vec::new();
    for i in 0..n {
        let page = doc.GetPage(i)?;
        let size = page.Size()?;
        let opts = PdfPageRenderOptions::new()?;
        opts.SetDestinationWidth((size.Width * 2.0).round() as u32)?;
        opts.SetBitmapEncoderId(BitmapEncoder::PngEncoderId()?)?;
        let stream = InMemoryRandomAccessStream::new()?;
        page.RenderWithOptionsToStreamAsync(&stream, &opts)?
            .join()?;
        let len = stream.Size()? as u32;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(len)?.join()?;
        let mut bytes = vec![0u8; len as usize];
        reader.ReadBytes(&mut bytes)?;
        let path = dir.join(format!(
            "{stem} {:0width$}.png",
            i + 1,
            width = width.max(2)
        ));
        std::fs::write(&path, &bytes).map_err(|e| {
            windows::core::Error::new(windows::core::HRESULT(-2147467259), e.to_string())
        })?;
        out.push(path);
    }
    Ok(out)
}

/// One page per JPEG, each fitted into A4 (portrait or landscape to match the picture).
pub fn from_jpegs(images: &[(u32, u32, Vec<u8>)], out: &Path) -> Result<(), String> {
    let mut buf: Vec<u8> = Vec::new();
    let mut offsets: Vec<usize> = Vec::new();
    buf.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    let n = images.len();
    let obj = |buf: &mut Vec<u8>, offsets: &mut Vec<usize>, body: &[u8]| {
        offsets.push(buf.len());
        buf.extend_from_slice(format!("{} 0 obj\n", offsets.len()).as_bytes());
        buf.extend_from_slice(body);
        buf.extend_from_slice(b"\nendobj\n");
    };
    obj(&mut buf, &mut offsets, b"<< /Type /Catalog /Pages 2 0 R >>");
    let kids: Vec<String> = (0..n).map(|i| format!("{} 0 R", 3 + i * 3)).collect();
    obj(
        &mut buf,
        &mut offsets,
        format!("<< /Type /Pages /Kids [{}] /Count {n} >>", kids.join(" ")).as_bytes(),
    );
    for (i, (w, h, jpeg)) in images.iter().enumerate() {
        let (bw, bh) = if w > h {
            (842.0, 595.0)
        } else {
            (595.0, 842.0)
        };
        let k = (bw / f64::from(*w)).min(bh / f64::from(*h));
        let (pw, ph) = (f64::from(*w) * k, f64::from(*h) * k);
        let (page, content, image) = (3 + i * 3, 4 + i * 3, 5 + i * 3);
        debug_assert_eq!(offsets.len() + 1, page);
        obj(
            &mut buf,
            &mut offsets,
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw:.2} {ph:.2}] \
                 /Resources << /XObject << /Im0 {image} 0 R >> /ProcSet [/PDF /ImageC] >> \
                 /Contents {content} 0 R >>"
            )
            .as_bytes(),
        );
        let draw = format!("q {pw:.2} 0 0 {ph:.2} 0 0 cm /Im0 Do Q");
        obj(
            &mut buf,
            &mut offsets,
            format!("<< /Length {} >>\nstream\n{draw}\nendstream", draw.len()).as_bytes(),
        );
        let mut body = format!(
            "<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB \
             /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
            jpeg.len()
        )
        .into_bytes();
        body.extend_from_slice(jpeg);
        body.extend_from_slice(b"\nendstream");
        obj(&mut buf, &mut offsets, &body);
    }
    let xref = buf.len();
    buf.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1).as_bytes(),
    );
    for off in &offsets {
        buf.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    buf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            offsets.len() + 1
        )
        .as_bytes(),
    );
    let mut file = std::fs::File::create(out).map_err(|e| e.to_string())?;
    file.write_all(&buf).map_err(|e| e.to_string())
}
