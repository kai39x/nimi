//! «كتم المايك»: the mute switch of the default capture device (the same one Windows' sound
//! settings show). Called on a blocking worker, so COM is initialised per call.

use windows::Win32::{
    Media::Audio::{
        eCapture, eConsole, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
        MMDeviceEnumerator,
    },
    System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
};

use crate::ipc::MicState;

fn endpoint() -> windows::core::Result<IAudioEndpointVolume> {
    // SAFETY: standard Core Audio activation; COM (MTA) is initialised for this worker thread.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eCapture, eConsole)?;
        device.Activate(CLSCTX_ALL, None)
    }
}

pub fn state() -> MicState {
    match endpoint() {
        // SAFETY: COM getter on a live interface.
        Ok(v) => MicState {
            available: true,
            muted: unsafe { v.GetMute() }.map(|m| m.as_bool()).unwrap_or(false),
        },
        Err(_) => MicState::default(),
    }
}

pub fn toggle() -> Result<MicState, String> {
    let v = endpoint().map_err(|_| "no-mic".to_string())?;
    // SAFETY: COM calls on a live interface; no out-pointers.
    unsafe {
        let muted = v.GetMute().map(|m| m.as_bool()).unwrap_or(false);
        v.SetMute(!muted, std::ptr::null())
            .map_err(|e| e.message().to_string())?;
    }
    Ok(state())
}
