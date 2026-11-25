mod commands;
mod state;
mod tray;

use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            commands::show_window(app);
        }));
    }

    let toggle_shortcut =
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyH);
    let handler_shortcut = toggle_shortcut.clone();

    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &handler_shortcut && event.state() == ShortcutState::Pressed {
                        commands::toggle_window(app);
                    }
                })
                .build(),
        )
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::hide_window,
            commands::minimize_window,
            commands::toggle_window_command,
            commands::toggle_capture_visibility,
        ])
        .setup(move |app| {
            app.global_shortcut().register(toggle_shortcut)?;
            tray::setup(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar Nexo");
}
