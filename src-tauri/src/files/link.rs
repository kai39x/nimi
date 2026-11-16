//! Links dropped on NIMI: recognising one, and «فحص الرابط».
//!
//! The check is local. Heuristics always run (no network). When the user turns on
//! «فحص الروابط بقائمة OpenPhish» (off by default), the public OpenPhish community feed is
//! downloaded at most once a day with Windows' own HTTP client and the link is matched against
//! that local copy — the link itself never leaves the PC.

use std::{
    collections::HashSet,
    net::IpAddr,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime},
};

use tauri::{AppHandle, Manager};
use url::Url;

use crate::{
    ipc::{LinkSafety, SafetyLevel},
    settings::SettingsStore,
};

const FEED_URL: &str = "https://openphish.com/feed.txt";
const FEED_MAX_AGE: Duration = Duration::from_secs(24 * 3600);

/// A single http(s) link, or None. Accepts «www.example.com» too.
pub fn parse(text: &str) -> Option<Url> {
    let t = text.trim();
    if t.is_empty() || t.contains(char::is_whitespace) {
        return None;
    }
    let candidate = if t.starts_with("www.") {
        format!("https://{t}")
    } else {
        t.to_string()
    };
    let url = Url::parse(&candidate).ok()?;
    matches!(url.scheme(), "http" | "https")
        .then_some(url)
        .filter(|u| {
            u.host_str()
                .is_some_and(|h| h.contains('.') || h == "localhost")
        })
}

/// A `.url` Internet shortcut's target.
pub fn from_shortcut(path: &std::path::Path) -> Option<Url> {
    let body = std::fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&body);
    text.lines()
        .find_map(|l| l.trim().strip_prefix("URL="))
        .and_then(parse)
}

const SHORTENERS: &[&str] = &[
    "bit.ly",
    "tinyurl.com",
    "t.co",
    "goo.gl",
    "is.gd",
    "cutt.ly",
    "rb.gy",
    "shorturl.at",
    "ow.ly",
    "tiny.cc",
    "buff.ly",
    "rebrand.ly",
    "t.ly",
    "s.id",
    "shorte.st",
    "adf.ly",
];
const RISKY_TLDS: &[&str] = &[
    "zip", "mov", "xyz", "top", "tk", "ml", "ga", "cf", "gq", "click", "country", "kim", "work",
    "rest", "cam", "icu", "buzz", "quest", "monster", "sbs", "cfd", "lol",
];
/// Names phishers dress up as (global + Saudi services Kai's audience uses).
const BRANDS: &[&str] = &[
    "paypal",
    "apple",
    "icloud",
    "microsoft",
    "office365",
    "outlook",
    "google",
    "gmail",
    "amazon",
    "netflix",
    "facebook",
    "instagram",
    "whatsapp",
    "snapchat",
    "tiktok",
    "steam",
    "discord",
    "binance",
    "stcpay",
    "alrajhi",
    "alinma",
    "absher",
    "tawakkalna",
    "sadad",
    "riyadbank",
    "aramco",
    "spl",
    "aramex",
    "dhl",
    "fedex",
];
/// Second-level public suffixes, so «bank.com.sa»'s site is «bank», not «com».
const TWO_LEVEL: &[&str] = &[
    "com.sa", "net.sa", "org.sa", "gov.sa", "edu.sa", "med.sa", "co.uk", "org.uk", "ac.uk",
    "com.au", "co.jp", "com.eg", "com.kw", "com.qa", "com.bh", "co.ae", "com.tr", "com.br",
];
/// Shared hosting: a phishing page there doesn't make the whole host bad.
const SHARED_HOSTS: &[&str] = &[
    "sites.google.com",
    "docs.google.com",
    "drive.google.com",
    "github.io",
    "firebaseapp.com",
    "web.app",
    "netlify.app",
    "vercel.app",
    "pages.dev",
    "blogspot.com",
    "wixsite.com",
    "weebly.com",
    "000webhostapp.com",
    "glitch.me",
    "onedrive.live.com",
    "1drv.ms",
];

/// The «site» part of a host: last two labels, or three under a two-level suffix.
fn site_of(host: &str) -> String {
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() >= 3 {
        let last_two = labels[labels.len() - 2..].join(".");
        if TWO_LEVEL.contains(&last_two.as_str()) {
            return labels[labels.len() - 3..].join(".");
        }
    }
    labels[labels.len().saturating_sub(2)..].join(".")
}

pub fn check(app: &AppHandle, url: &Url) -> LinkSafety {
    let host = url.host_str().unwrap_or_default().to_lowercase();
    let mut reasons: Vec<&str> = Vec::new();
    let mut danger = false;

    if url.scheme() == "http" {
        reasons.push("http");
    }
    let is_ip = host.trim_matches(['[', ']']).parse::<IpAddr>().is_ok();
    if is_ip {
        reasons.push("ip");
        danger |= url.scheme() == "http";
    }
    if !url.username().is_empty() || url.password().is_some() {
        // «https://paypal.com@evil.xyz» — everything before @ is decoration.
        reasons.push("at");
        danger = true;
    }
    if host.split('.').any(|l| l.starts_with("xn--")) {
        // Look-alike letters (Cyrillic «а» in «аpple.com»): the url crate gives us punycode.
        reasons.push("punycode");
        danger = true;
    }
    if !is_ip {
        let site = site_of(&host);
        if host.split('.').count() > 4 {
            reasons.push("subdomains");
        }
        if SHORTENERS.contains(&site.as_str()) || SHORTENERS.contains(&host.as_str()) {
            reasons.push("shortener");
        }
        if let Some(tld) = host.rsplit('.').next() {
            if RISKY_TLDS.contains(&tld) {
                reasons.push("tld");
            }
        }
        // «paypal.com.secure-login.xyz»: a brand in the subdomains of someone else's site.
        let sub = host.strip_suffix(&site).unwrap_or("");
        let site_name = site.split('.').next().unwrap_or("");
        if BRANDS
            .iter()
            .any(|b| sub.split(['.', '-']).any(|l| l == *b) && site_name != *b)
        {
            reasons.push("brand");
            danger = true;
        }
    }
    if url.as_str().len() > 200 {
        reasons.push("long");
    }

    let feed_on = app.state::<SettingsStore>().get().phish_feed;
    let mut feed = false;
    if feed_on {
        refresh_feed(app);
        let list = FEED.lock().expect("feed lock");
        if let Some(set) = list.as_ref() {
            feed = true;
            if listed(set, url, &host) {
                reasons.insert(0, "listed");
                danger = true;
            }
        }
    }

    let level = if danger {
        SafetyLevel::Danger
    } else if reasons.is_empty() {
        SafetyLevel::Safe
    } else {
        SafetyLevel::Caution
    };
    LinkSafety {
        level,
        reasons: reasons.into_iter().map(String::from).collect(),
        host,
        feed,
    }
}

// --- the OpenPhish list (opt-in) ----------------------------------------------------------------

/// Normalised feed URLs plus their hosts (hosts only for dedicated, non-shared hosts).
struct Feed {
    urls: HashSet<String>,
    hosts: HashSet<String>,
}

static FEED: Mutex<Option<Feed>> = Mutex::new(None);
static FETCHING: AtomicBool = AtomicBool::new(false);

fn norm(u: &str) -> String {
    u.trim().trim_end_matches('/').to_lowercase()
}

fn listed(feed: &Feed, url: &Url, host: &str) -> bool {
    if feed.urls.contains(&norm(url.as_str())) {
        return true;
    }
    let shared = SHARED_HOSTS
        .iter()
        .any(|s| host == *s || host.ends_with(&format!(".{s}")));
    !shared && feed.hosts.contains(host)
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("openphish.txt"))
}

fn load(body: &str) -> Feed {
    let mut urls = HashSet::new();
    let mut hosts = HashSet::new();
    for line in body.lines().map(str::trim).filter(|l| !l.is_empty()) {
        urls.insert(norm(line));
        if let Some(h) = Url::parse(line)
            .ok()
            .and_then(|u| u.host_str().map(str::to_lowercase))
        {
            hosts.insert(h);
        }
    }
    Feed { urls, hosts }
}

/// Loads the cached list, and downloads a fresh one in the background when it is a day old.
/// Called when the setting is on (at startup, when it is switched on, and at each check).
pub fn refresh_feed(app: &AppHandle) {
    let Some(path) = cache_path(app) else { return };
    let age = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok());
    {
        let mut feed = FEED.lock().expect("feed lock");
        if feed.is_none() {
            if let Ok(body) = std::fs::read_to_string(&path) {
                *feed = Some(load(&body));
            }
        }
    }
    if age.is_some_and(|a| a < FEED_MAX_AGE) || FETCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        match download() {
            Ok(body) if body.lines().count() > 10 => {
                if let Some(dir) = path.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                let _ = std::fs::write(&path, &body);
                *FEED.lock().expect("feed lock") = Some(load(&body));
                log::info!("openphish list: {} links", body.lines().count());
            }
            Ok(_) => log::warn!("openphish list came back empty"),
            Err(e) => log::warn!("openphish list download failed: {e}"),
        }
        FETCHING.store(false, Ordering::SeqCst);
    });
}

/// Turned off: forget the list (the cached file stays for next time).
pub fn drop_feed() {
    *FEED.lock().expect("feed lock") = None;
}

fn download() -> windows::core::Result<String> {
    use windows::{
        core::HSTRING,
        Foundation::Uri,
        Web::Http::HttpClient,
        Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
    };
    // SAFETY: WinRT on a fresh MTA worker thread.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let client = HttpClient::new()?;
    let uri = Uri::CreateUri(&HSTRING::from(FEED_URL))?;
    Ok(client.GetStringAsync(&uri)?.join()?.to_string())
}
