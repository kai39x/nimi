//! Manual update check (About → «تحقق من التحديثات»). NIMI stays offline: this asks GitHub for
//! the latest release only when the button is pressed, and never downloads or installs anything —
//! a newer version just offers a link to the releases page.

use crate::ipc::UpdateInfo;

const LATEST_API: &str = "https://api.github.com/repos/kai39x/nimi/releases/latest";
/// Pages the «صفحة التحميل» button may open.
const RELEASES_PREFIX: &str = "https://github.com/kai39x/nimi/releases/";
const RELEASES_PAGE: &str = "https://github.com/kai39x/nimi/releases/latest";

/// Blocking: one HTTPS request. Call from a worker thread.
pub fn check(current: &str) -> Result<UpdateInfo, String> {
    let body = fetch_latest().map_err(|e| e.message().to_string())?;
    let json: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let tag = json["tag_name"]
        .as_str()
        .ok_or("no tag_name in the reply")?;
    let latest = tag.trim_start_matches('v').to_string();
    let url = json["html_url"]
        .as_str()
        .filter(|u| u.starts_with(RELEASES_PREFIX))
        .unwrap_or(RELEASES_PAGE)
        .to_string();
    Ok(UpdateInfo {
        newer: parse(&latest) > parse(current),
        current: current.to_string(),
        latest,
        url,
    })
}

/// Opens a release page in the default browser (only NIMI's own releases).
pub fn open_page(url: &str) -> Result<(), String> {
    if !url.starts_with(RELEASES_PREFIX) {
        return Err("not a NIMI release page".into());
    }
    crate::files::shell::open_url(url).map_err(|e| e.message().to_string())
}

/// "1.0.12" → [1, 0, 12]; anything after a `-` (pre-release) is ignored.
fn parse(v: &str) -> Vec<u64> {
    v.split('-')
        .next()
        .unwrap_or("")
        .split('.')
        .map(|p| p.parse().unwrap_or(0))
        .collect()
}

fn fetch_latest() -> windows::core::Result<String> {
    use windows::{
        core::HSTRING,
        Foundation::Uri,
        Web::Http::HttpClient,
        Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
    };
    // SAFETY: WinRT on a worker thread; a repeat call on a pooled thread just returns S_FALSE.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let client = HttpClient::new()?;
    let headers = client.DefaultRequestHeaders()?;
    // GitHub's API refuses requests without a User-Agent. A generic name, nothing about the user.
    headers
        .UserAgent()?
        .TryParseAdd(&HSTRING::from("NIMI-update-check"))?;
    headers
        .Accept()?
        .TryParseAdd(&HSTRING::from("application/vnd.github+json"))?;
    let uri = Uri::CreateUri(&HSTRING::from(LATEST_API))?;
    Ok(client.GetStringAsync(&uri)?.join()?.to_string())
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn versions_compare_numerically() {
        assert!(parse("1.0.10") > parse("1.0.9"));
        assert!(parse("1.1.0") > parse("1.0.99"));
        assert!(parse("1.0.1") == parse("1.0.1"));
        assert!(parse("2.0.0-beta") == parse("2.0.0"));
    }
}
