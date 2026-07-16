mod activity_log;
mod config;
mod monitor;
mod server;
mod tray;
mod update;
mod usage;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            let app_handle = app.handle().clone();
            configure_platform_app_presence(&app_handle);
            let shared_snapshot = monitor::SharedSnapshot::default();
            let update_state = update::UpdateState::desktop(app_handle.clone());
            update::UpdateState::check_on_start(update_state.clone());
            let tray_enabled = !no_tray_mode();
            let server =
                server::spawn_server(shared_snapshot.clone(), tray_enabled, update_state.clone())
                    .expect("start AgentWatch server");
            let dashboard_url = format!("http://127.0.0.1:{}", server.port);
            let tray_installed = if tray_enabled {
                match tray::install(
                    &app_handle,
                    &dashboard_url,
                    server.port,
                    shared_snapshot,
                    update_state,
                ) {
                    Ok(()) => true,
                    Err(error) => {
                        eprintln!("AgentWatch tray setup failed: {error}");
                        false
                    }
                }
            } else {
                false
            };
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&format!("AgentWatch - running on {dashboard_url}"));
                if let Ok(url) = tauri::Url::parse(&dashboard_url) {
                    let _ = window.navigate(url);
                }
                if !tray_installed || show_window_on_start() {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AgentWatch");
}

#[cfg(target_os = "macos")]
fn configure_platform_app_presence(app: &tauri::AppHandle) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    let _ = app.set_dock_visibility(false);
}

#[cfg(not(target_os = "macos"))]
fn configure_platform_app_presence(_app: &tauri::AppHandle) {}

fn no_tray_mode() -> bool {
    truthy_env("AGENTWATCH_NO_TRAY")
}

fn show_window_on_start() -> bool {
    if let Ok(value) = std::env::var("AGENTWATCH_SHOW_WINDOW_ON_START") {
        return truthy_value(&value);
    }
    default_show_window_on_start()
}

fn truthy_env(name: &str) -> bool {
    std::env::var(name)
        .map(|value| truthy_value(&value))
        .unwrap_or(false)
}

fn truthy_value(value: &str) -> bool {
    matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes")
}

#[cfg(target_os = "macos")]
fn default_show_window_on_start() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
fn default_show_window_on_start() -> bool {
    true
}
