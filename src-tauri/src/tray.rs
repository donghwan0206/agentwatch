use crate::monitor;
use std::{thread, time::Duration};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const TRAY_ID: &str = "agentwatch";
const TRAY_ICON_SIZE: u32 = 128;
const TRAY_ICON_COORD_SIZE: f32 = 64.0;

pub fn install(
    app: &AppHandle,
    dashboard_url: &str,
    port: u16,
    shared_snapshot: monitor::SharedSnapshot,
) -> tauri::Result<()> {
    let status = MenuItem::with_id(
        app,
        "status",
        format!("AgentWatch monitoring: running on {dashboard_url}"),
        false,
        None::<&str>,
    )?;
    let lan_url = MenuItem::with_id(
        app,
        "lan_url",
        "LAN: detecting local IP",
        false,
        None::<&str>,
    )?;
    let local_url = MenuItem::with_id(
        app,
        "local_url",
        format!("Local: {dashboard_url}"),
        false,
        None::<&str>,
    )?;
    let runtime = MenuItem::with_id(
        app,
        "runtime",
        format!("Runtime: {} · monitoring on", std::env::consts::OS),
        false,
        None::<&str>,
    )?;
    let agents = MenuItem::with_id(app, "agents", "Agents: detecting", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status, &runtime, &agents, &local_url, &lan_url, &open, &quit,
        ],
    )?;

    let tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(agent_monitor_icon())
        .icon_as_template(true)
        .tooltip(format!("AgentWatch monitoring on · Local {dashboard_url}"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });

    let tray = tray_builder.build(app)?;

    start_status_loop(
        tray,
        status,
        runtime,
        agents,
        local_url,
        lan_url,
        dashboard_url.to_string(),
        port,
        shared_snapshot,
    );

    Ok(())
}

fn start_status_loop(
    tray: tauri::tray::TrayIcon,
    status_item: MenuItem<tauri::Wry>,
    runtime_item: MenuItem<tauri::Wry>,
    agents_item: MenuItem<tauri::Wry>,
    local_url_item: MenuItem<tauri::Wry>,
    lan_url_item: MenuItem<tauri::Wry>,
    dashboard_url: String,
    port: u16,
    shared_snapshot: monitor::SharedSnapshot,
) {
    thread::spawn(move || loop {
        let summary = tray_summary(&dashboard_url, port, &shared_snapshot);
        let _ = status_item.set_text(&summary.menu_text);
        let _ = runtime_item.set_text(&summary.runtime_text);
        let _ = agents_item.set_text(&summary.agents_text);
        let _ = local_url_item.set_text(&summary.local_text);
        let _ = lan_url_item.set_text(&summary.lan_text);
        let _ = tray.set_tooltip(Some(summary.tooltip));
        let _ = tray.set_title(Some(summary.title));
        thread::sleep(Duration::from_secs(10));
    });
}

struct TraySummary {
    menu_text: String,
    runtime_text: String,
    agents_text: String,
    local_text: String,
    lan_text: String,
    tooltip: String,
    title: String,
}

fn tray_summary(
    dashboard_url: &str,
    port: u16,
    shared_snapshot: &monitor::SharedSnapshot,
) -> TraySummary {
    let snapshot = shared_snapshot
        .read()
        .ok()
        .and_then(|current| current.clone());
    let Some(snapshot) = snapshot else {
        return TraySummary {
            menu_text: format!("AgentWatch monitoring: starting on {dashboard_url}"),
            runtime_text: format!("Runtime: {} · monitoring on", std::env::consts::OS),
            agents_text: "Agents: detecting".to_string(),
            local_text: format!("Local: {dashboard_url}"),
            lan_text: "LAN: detecting local IP".to_string(),
            tooltip: format!(
                "AgentWatch monitoring starting · Local {dashboard_url} · LAN detecting"
            ),
            title: String::new(),
        };
    };

    let status = snapshot.activity.status;
    let process_count = snapshot.activity.active_process_count;
    let cpu = snapshot.activity.total_cpu;
    let agents_text = agent_summary(&snapshot.providers);
    let lan_url = snapshot
        .local_ips
        .first()
        .map(|ip| format!("http://{ip}:{port}"));
    let lan_text = lan_url
        .as_ref()
        .map(|url| format!("LAN: {url}"))
        .unwrap_or_else(|| "LAN: no non-loopback IP detected".to_string());
    let tooltip_lan = lan_url
        .as_ref()
        .map(|url| format!("LAN {url}"))
        .unwrap_or_else(|| "LAN unavailable".to_string());
    TraySummary {
        menu_text: format!(
            "AgentWatch monitoring: {status} · {process_count} processes · CPU {cpu:.1}%"
        ),
        runtime_text: format!("Runtime: {} · monitoring on", std::env::consts::OS),
        agents_text,
        local_text: format!("Local: {dashboard_url}"),
        lan_text,
        tooltip: format!(
            "AgentWatch monitoring {status} · {process_count} processes · CPU {cpu:.1}% · Local {dashboard_url} · {tooltip_lan}"
        ),
        title: String::new(),
    }
}

fn agent_summary(providers: &[monitor::Provider]) -> String {
    let active = providers
        .iter()
        .filter(|provider| provider.process_count > 0 && provider.status != "offline")
        .take(3)
        .map(|provider| format!("{} {}", provider.name, provider.process_count))
        .collect::<Vec<_>>();

    if active.is_empty() {
        "Agents: none detected".to_string()
    } else {
        format!("Agents: {}", active.join(", "))
    }
}

fn agent_monitor_icon() -> Image<'static> {
    let mut rgba = vec![0; (TRAY_ICON_SIZE * TRAY_ICON_SIZE * 4) as usize];

    // Monochrome template mask matching the app icon: rounded agent head,
    // antenna, side ears, and a cut-out sine graph. macOS inverts template
    // icons automatically for light and dark menu bars.
    let scale = TRAY_ICON_SIZE as f32 / TRAY_ICON_COORD_SIZE;
    for y in 0..TRAY_ICON_SIZE {
        for x in 0..TRAY_ICON_SIZE {
            let px = (x as f32 + 0.5) / scale;
            let py = (y as f32 + 0.5) / scale;
            let body = rounded_rect_mask(px, py, 15.0, 20.0, 34.0, 31.0, 5.5)
                .max(rounded_rect_mask(px, py, 30.0, 11.0, 5.0, 13.0, 2.5))
                .max(rounded_rect_mask(px, py, 9.0, 29.0, 5.0, 14.0, 1.8))
                .max(rounded_rect_mask(px, py, 50.0, 29.0, 5.0, 14.0, 1.8));
            let graph = sine_graph_mask(px, py);
            let alpha = (body * (1.0 - graph) * 255.0).round() as u8;
            put_pixel(&mut rgba, x as i32, y as i32, alpha);
        }
    }

    Image::new_owned(rgba, TRAY_ICON_SIZE, TRAY_ICON_SIZE)
}

fn rounded_rect_mask(
    px: f32,
    py: f32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    radius: f32,
) -> f32 {
    let cx = x + width / 2.0;
    let cy = y + height / 2.0;
    let qx = (px - cx).abs() - (width / 2.0 - radius);
    let qy = (py - cy).abs() - (height / 2.0 - radius);
    let outside_x = qx.max(0.0);
    let outside_y = qy.max(0.0);
    let outside = (outside_x * outside_x + outside_y * outside_y).sqrt();
    let inside = qx.max(qy).min(0.0);
    let distance = outside + inside - radius;
    smooth_alpha(distance)
}

fn sine_graph_mask(px: f32, py: f32) -> f32 {
    let points = [
        (21.0, 35.0),
        (24.0, 35.0),
        (27.0, 31.0),
        (30.0, 27.5),
        (34.0, 29.0),
        (37.0, 35.0),
        (40.0, 42.0),
        (44.0, 44.0),
        (47.0, 39.0),
        (49.0, 35.0),
        (52.0, 35.0),
    ];
    let mut distance = f32::MAX;
    for pair in points.windows(2) {
        distance = distance.min(distance_to_segment(px, py, pair[0], pair[1]));
    }
    smooth_alpha(distance - 2.7)
}

fn distance_to_segment(px: f32, py: f32, start: (f32, f32), end: (f32, f32)) -> f32 {
    let vx = end.0 - start.0;
    let vy = end.1 - start.1;
    let wx = px - start.0;
    let wy = py - start.1;
    let len_sq = vx * vx + vy * vy;
    let t = if len_sq == 0.0 {
        0.0
    } else {
        ((wx * vx + wy * vy) / len_sq).clamp(0.0, 1.0)
    };
    let cx = start.0 + t * vx;
    let cy = start.1 + t * vy;
    let dx = px - cx;
    let dy = py - cy;
    (dx * dx + dy * dy).sqrt()
}

fn smooth_alpha(distance: f32) -> f32 {
    (0.5 - distance).clamp(0.0, 1.0)
}

fn put_pixel(rgba: &mut [u8], x: i32, y: i32, alpha: u8) {
    if x < 0 || y < 0 || x >= TRAY_ICON_SIZE as i32 || y >= TRAY_ICON_SIZE as i32 {
        return;
    }
    let offset = ((y as u32 * TRAY_ICON_SIZE + x as u32) * 4) as usize;
    rgba[offset] = 0;
    rgba[offset + 1] = 0;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = alpha;
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::monitor::{Activity, Snapshot};
    use std::sync::{Arc, RwLock};

    #[test]
    fn tray_summary_reports_starting_state_without_snapshot() {
        let shared_snapshot = Arc::new(RwLock::new(None));

        let summary = tray_summary("http://127.0.0.1:8765", 8765, &shared_snapshot);

        assert_eq!(
            summary.menu_text,
            "AgentWatch monitoring: starting on http://127.0.0.1:8765"
        );
        assert_eq!(
            summary.runtime_text,
            format!("Runtime: {} · monitoring on", std::env::consts::OS)
        );
        assert_eq!(summary.agents_text, "Agents: detecting");
        assert_eq!(summary.local_text, "Local: http://127.0.0.1:8765");
        assert_eq!(summary.lan_text, "LAN: detecting local IP");
        assert_eq!(
            summary.tooltip,
            "AgentWatch monitoring starting · Local http://127.0.0.1:8765 · LAN detecting"
        );
        assert_eq!(summary.title, "");
    }

    #[test]
    fn tray_summary_reports_activity_and_lan_url() {
        let shared_snapshot = Arc::new(RwLock::new(Some(Snapshot {
            timestamp: 1,
            hostname: "agent-host".to_string(),
            local_ips: vec!["192.168.50.93".to_string()],
            activity: Activity {
                score: 72,
                status: "busy".to_string(),
                active_process_count: 12,
                total_cpu: 34.56,
                total_memory: 10.0,
            },
            providers: vec![
                monitor::Provider {
                    key: "codex".to_string(),
                    name: "OpenAI Codex".to_string(),
                    accent: "#10a37f".to_string(),
                    status: "busy".to_string(),
                    process_count: 9,
                    cpu: 30.0,
                    memory: 1.0,
                    processes: Vec::new(),
                },
                monitor::Provider {
                    key: "claude".to_string(),
                    name: "Claude Code".to_string(),
                    accent: "#c15f3c".to_string(),
                    status: "active".to_string(),
                    process_count: 3,
                    cpu: 4.6,
                    memory: 0.8,
                    processes: Vec::new(),
                },
            ],
        })));

        let summary = tray_summary("http://127.0.0.1:8765", 8765, &shared_snapshot);

        assert_eq!(
            summary.menu_text,
            "AgentWatch monitoring: busy · 12 processes · CPU 34.6%"
        );
        assert_eq!(
            summary.runtime_text,
            format!("Runtime: {} · monitoring on", std::env::consts::OS)
        );
        assert_eq!(summary.agents_text, "Agents: OpenAI Codex 9, Claude Code 3");
        assert_eq!(summary.local_text, "Local: http://127.0.0.1:8765");
        assert_eq!(summary.lan_text, "LAN: http://192.168.50.93:8765");
        assert_eq!(
            summary.tooltip,
            "AgentWatch monitoring busy · 12 processes · CPU 34.6% · Local http://127.0.0.1:8765 · LAN http://192.168.50.93:8765"
        );
        assert_eq!(summary.title, "");
    }

    #[test]
    fn tray_summary_falls_back_to_local_url_without_lan_ip() {
        let shared_snapshot = Arc::new(RwLock::new(Some(Snapshot {
            timestamp: 1,
            hostname: "agent-host".to_string(),
            local_ips: Vec::new(),
            activity: Activity {
                score: 10,
                status: "quiet".to_string(),
                active_process_count: 0,
                total_cpu: 0.0,
                total_memory: 0.0,
            },
            providers: Vec::new(),
        })));

        let summary = tray_summary("http://127.0.0.1:8765", 8765, &shared_snapshot);

        assert_eq!(summary.agents_text, "Agents: none detected");
        assert_eq!(summary.lan_text, "LAN: no non-loopback IP detected");
        assert_eq!(summary.local_text, "Local: http://127.0.0.1:8765");
        assert_eq!(
            summary.tooltip,
            "AgentWatch monitoring quiet · 0 processes · CPU 0.0% · Local http://127.0.0.1:8765 · LAN unavailable"
        );
        assert_eq!(summary.title, "");
    }

    #[test]
    fn tray_summary_limits_agent_menu_to_three_active_providers() {
        let providers = ["OpenAI Codex", "Claude Code", "Gemini CLI", "OpenCode"]
            .into_iter()
            .enumerate()
            .map(|(index, name)| monitor::Provider {
                key: format!("agent-{index}"),
                name: name.to_string(),
                accent: "#ffffff".to_string(),
                status: "active".to_string(),
                process_count: index + 1,
                cpu: 1.0,
                memory: 0.0,
                processes: Vec::new(),
            })
            .collect::<Vec<_>>();

        assert_eq!(
            agent_summary(&providers),
            "Agents: OpenAI Codex 1, Claude Code 2, Gemini CLI 3"
        );
    }
}
