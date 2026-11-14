//! Tray icon + menu (design spec §12): monochrome icon that follows the taskbar theme, with the
//! states normal / notify / sleep / do-not-disturb, and the menu
//! open · settings · mute sounds · hide for 1 hour · quit.

use std::{ffi::c_void, mem::size_of, sync::Mutex, time::Duration};

use tauri::{
    image::Image,
    menu::{CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuEvent, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};
use windows::{
    core::w,
    Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
};

use crate::{
    ipc::{events, Language, TrayState},
    settings::{self, SettingsStore},
    window::{settings_window, visibility},
};

pub const TRAY_ID: &str = "nimi-tray";

const ID_OPEN: &str = "open";
const ID_SETTINGS: &str = "settings";
const ID_MUTE: &str = "mute";
const ID_HIDE: &str = "hide-1h";
const ID_QUIT: &str = "quit";

pub struct TrayHandles {
    mute_item: Mutex<Option<CheckMenuItem<Wry>>>,
    state: Mutex<TrayState>,
}

struct Labels {
    open: &'static str,
    settings: &'static str,
    mute: &'static str,
    hide: &'static str,
    quit: &'static str,
}

fn labels(lang: Language) -> Labels {
    match lang {
        Language::Ar => Labels {
            open: "افتح نيمي",
            settings: "الإعدادات",
            mute: "كتم الأصوات",
            hide: "إخفاء لساعة",
            quit: "خروج",
        },
        Language::En => Labels {
            open: "Open NIMI",
            settings: "Settings",
            mute: "Mute sounds",
            hide: "Hide for 1 hour",
            quit: "Quit",
        },
    }
}

fn build_menu(
    app: &AppHandle,
    lang: Language,
    muted: bool,
) -> tauri::Result<(Menu<Wry>, CheckMenuItem<Wry>)> {
    let l = labels(lang);
    let open = MenuItemBuilder::with_id(ID_OPEN, l.open).build(app)?;
    let settings = MenuItemBuilder::with_id(ID_SETTINGS, l.settings).build(app)?;
    let mute = CheckMenuItemBuilder::with_id(ID_MUTE, l.mute)
        .checked(muted)
        .build(app)?;
    let hide = MenuItemBuilder::with_id(ID_HIDE, l.hide).build(app)?;
    let quit = MenuItemBuilder::with_id(ID_QUIT, l.quit).build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open)
        .item(&settings)
        .separator()
        .item(&mute)
        .item(&hide)
        .separator()
        .item(&quit)
        .build()?;
    Ok((menu, mute))
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let current = app.state::<SettingsStore>().get();
    let (menu, mute) = build_menu(app, current.language, current.sounds_muted)?;
    app.manage(TrayHandles {
        mute_item: Mutex::new(Some(mute)),
        state: Mutex::new(TrayState::Normal),
    });

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_for(TrayState::Normal, taskbar_is_light()))
        .tooltip("NIMI")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_overlay(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        ID_OPEN => open_overlay(app),
        ID_SETTINGS => {
            if let Err(err) = settings_window::open(app) {
                log::warn!("could not open settings: {err}");
            }
        }
        ID_MUTE => {
            settings::update(app, |s| s.sounds_muted = !s.sounds_muted);
        }
        ID_HIDE => visibility::hide_for(app, Duration::from_secs(60 * 60)),
        ID_QUIT => app.exit(0),
        _ => {}
    }
}

fn open_overlay(app: &AppHandle) {
    visibility::show_now(app);
    let _ = app.emit(events::TRAY_OPEN, ());
}

/// Keeps the "mute sounds" check mark in step with the setting.
pub fn sync_mute(app: &AppHandle) {
    let muted = app.state::<SettingsStore>().get().sounds_muted;
    let handles = app.state::<TrayHandles>();
    let guard = handles.mute_item.lock().expect("tray lock");
    if let Some(item) = guard.as_ref() {
        let _ = item.set_checked(muted);
    }
    drop(guard);
}

/// Rebuilds the menu after a language change.
pub fn rebuild_menu(app: &AppHandle) {
    let current = app.state::<SettingsStore>().get();
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match build_menu(app, current.language, current.sounds_muted) {
        Ok((menu, mute)) => {
            if let Err(err) = tray.set_menu(Some(menu)) {
                log::warn!("tray menu update failed: {err}");
            }
            *app.state::<TrayHandles>()
                .mute_item
                .lock()
                .expect("tray lock") = Some(mute);
        }
        Err(err) => log::warn!("tray menu rebuild failed: {err}"),
    }
}

pub fn set_state(app: &AppHandle, state: TrayState) {
    let Some(handles) = app.try_state::<TrayHandles>() else {
        return;
    };
    *handles.state.lock().expect("tray lock") = state;
    refresh_icon(app);
}

/// Re-applies the icon for the current state and taskbar theme.
pub fn refresh_icon(app: &AppHandle) {
    let Some(handles) = app.try_state::<TrayHandles>() else {
        return;
    };
    let state = *handles.state.lock().expect("tray lock");
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(err) = tray.set_icon(Some(icon_for(state, taskbar_is_light()))) {
            log::warn!("tray icon update failed: {err}");
        }
    }
}

/// The `*_light` assets are white (for a dark taskbar); `*_dark` are near-black (light taskbar).
fn icon_for(state: TrayState, light_taskbar: bool) -> Image<'static> {
    macro_rules! png {
        ($name:literal) => {
            include_bytes!(concat!("../../design/icons/tray/", $name, "_32.png")) as &[u8]
        };
    }
    let bytes = match (state, light_taskbar) {
        (TrayState::Normal, false) => png!("tray_normal_light"),
        (TrayState::Normal, true) => png!("tray_normal_dark"),
        (TrayState::Notify, false) => png!("tray_notify_light"),
        (TrayState::Notify, true) => png!("tray_notify_dark"),
        (TrayState::Sleep, false) => png!("tray_sleep_light"),
        (TrayState::Sleep, true) => png!("tray_sleep_dark"),
        (TrayState::Dnd, false) => png!("tray_dnd_light"),
        (TrayState::Dnd, true) => png!("tray_dnd_dark"),
    };
    Image::from_bytes(bytes).expect("tray icon PNG is valid")
}

/// Reads the taskbar theme: `SystemUsesLightTheme = 1` means a light taskbar.
fn taskbar_is_light() -> bool {
    let mut value: u32 = 0;
    let mut size = size_of::<u32>() as u32;
    // SAFETY: valid buffers; RegGetValueW writes at most `size` bytes into `value`.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"),
            w!("SystemUsesLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut c_void),
            Some(&mut size),
        )
    };
    status.is_ok() && value == 1
}
