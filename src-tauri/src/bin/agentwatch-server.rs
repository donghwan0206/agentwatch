#[path = "../activity_log.rs"]
mod activity_log;
#[path = "../config.rs"]
mod config;
#[path = "../monitor.rs"]
mod monitor;
#[path = "../server.rs"]
mod server;
#[path = "../usage.rs"]
mod usage;

use std::{thread, time::Duration};

fn main() {
    let shared_snapshot = monitor::SharedSnapshot::default();
    let handle =
        server::spawn_headless_server(shared_snapshot).expect("start AgentWatch headless server");
    println!("AgentWatch headless server running");
    println!("Local: http://127.0.0.1:{}", handle.port);
    println!("LAN: http://<agent-machine-ip>:{}", handle.port);

    loop {
        thread::sleep(Duration::from_secs(3600));
    }
}
