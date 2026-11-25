use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::state::AppState;

pub const TOGGLE_SHORTCUT: &str = "Ctrl+Shift+H";

#[derive(Serialize)]
pub struct AppStateDto {
    pub version: &'static str,
    pub shortcut: &'static str,
    pub room_id: Option<String>,
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

pub fn show_window(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn toggle_window(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_window(app);
        }
    }
}

#[tauri::command]
pub fn get_state(state: tauri::State<'_, AppState>) -> AppStateDto {
    let room_id = state.room_id.lock().unwrap().clone();
    AppStateDto {
        version: env!("CARGO_PKG_VERSION"),
        shortcut: TOGGLE_SHORTCUT,
        room_id,
    }
}

#[tauri::command]
pub fn hide_window(app: AppHandle) {
    if let Some(window) = main_window(&app) {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn minimize_window(app: AppHandle) {
    if let Some(window) = main_window(&app) {
        let _ = window.minimize();
    }
}

#[tauri::command]
pub fn toggle_window_command(app: AppHandle) {
    toggle_window(&app);
}

#[tauri::command]
pub fn toggle_capture_visibility(app: AppHandle, hide: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
        };

        let window = main_window(&app)
            .ok_or_else(|| "No se encontró la ventana principal.".to_string())?;
        let hwnd: HWND = window.hwnd().map_err(|error| error.to_string())?;
        let affinity = if hide {
            WDA_EXCLUDEFROMCAPTURE
        } else {
            WDA_NONE
        };
        unsafe { SetWindowDisplayAffinity(hwnd, affinity).map_err(|error| error.to_string()) }
    }
    #[cfg(not(windows))]
    {
        let _ = (app, hide);
        Ok(())
    }
}
