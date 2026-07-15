mod activity_log;
mod config;
mod monitor;
mod server;
mod tray;
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
                install_available_update(app.handle().clone());
            }
            let app_handle = app.handle().clone();
            configure_platform_app_presence(&app_handle);
            let shared_snapshot = monitor::SharedSnapshot::default();
            let tray_enabled = !no_tray_mode();
            let server = server::spawn_server(shared_snapshot.clone(), tray_enabled)
                .expect("start AgentWatch server");
            let dashboard_url = format!("http://127.0.0.1:{}", server.port);
            if tray_enabled {
                tray::install(&app_handle, &dashboard_url, server.port, shared_snapshot)?;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&format!("AgentWatch - running on {dashboard_url}"));
                if let Ok(url) = tauri::Url::parse(&dashboard_url) {
                    let _ = window.navigate(url);
                }
                if !tray_enabled || show_window_on_start() {
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
    truthy_env("AGENTWATCH_SHOW_WINDOW_ON_START")
}

fn truthy_env(name: &str) -> bool {
    matches!(
        std::env::var(name)
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes"
    )
}

#[cfg(desktop)]
fn install_available_update(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = check_and_install_update(app).await {
            eprintln!("AgentWatch updater check failed: {error}");
        }
    });
}

#[cfg(desktop)]
async fn check_and_install_update(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    use tauri_plugin_updater::UpdaterExt;

    if let Some(update) = app.updater()?.check().await? {
        update.download_and_install(|_, _| {}, || {}).await?;
        app.restart();
    }
    Ok(())
}
