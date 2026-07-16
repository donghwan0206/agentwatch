use serde::Serialize;
use std::sync::{Arc, Mutex, RwLock};
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

pub type SharedUpdateState = Arc<UpdateState>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub phase: String,
    pub current_version: String,
    pub available_version: Option<String>,
    pub update_available: bool,
    pub checked_at: Option<i64>,
    pub downloaded_bytes: u64,
    pub content_length: Option<u64>,
    pub percent: Option<f64>,
    pub message: String,
    pub release_date: Option<String>,
    pub release_notes: Option<String>,
    pub download_url: Option<String>,
}

pub struct UpdateState {
    app: Option<AppHandle>,
    status: RwLock<UpdateStatus>,
    pending_update: Mutex<Option<Update>>,
}

impl UpdateState {
    #[allow(dead_code)]
    pub fn desktop(app: AppHandle) -> SharedUpdateState {
        Arc::new(Self::new(Some(app)))
    }

    pub fn unavailable() -> SharedUpdateState {
        Arc::new(Self::new(None))
    }

    fn new(app: Option<AppHandle>) -> Self {
        let current_version = app
            .as_ref()
            .map(|app| app.package_info().version.to_string())
            .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
        Self {
            app,
            status: RwLock::new(UpdateStatus {
                phase: "idle".to_string(),
                current_version,
                available_version: None,
                update_available: false,
                checked_at: None,
                downloaded_bytes: 0,
                content_length: None,
                percent: None,
                message: "업데이트 확인 대기".to_string(),
                release_date: None,
                release_notes: None,
                download_url: None,
            }),
            pending_update: Mutex::new(None),
        }
    }

    pub fn status(&self) -> UpdateStatus {
        self.status.read().expect("update state lock").clone()
    }

    #[allow(dead_code)]
    pub fn check_on_start(state: SharedUpdateState) {
        tauri::async_runtime::spawn(async move {
            let _ = state.check().await;
        });
    }

    pub async fn check(&self) -> UpdateStatus {
        let Some(app) = self.app.clone() else {
            return self.set_error("이 빌드는 온에어 업데이트를 지원하지 않습니다.");
        };

        self.update_status(|status| {
            status.phase = "checking".to_string();
            status.message = "업데이트 확인 중".to_string();
            status.downloaded_bytes = 0;
            status.content_length = None;
            status.percent = None;
        });

        let update_result = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(error) => Err(error),
        };

        match update_result {
            Ok(Some(update)) => self.store_available_update(update),
            Ok(None) => {
                if let Ok(mut pending) = self.pending_update.lock() {
                    *pending = None;
                }
                self.update_status(|status| {
                    status.phase = "up-to-date".to_string();
                    status.available_version = None;
                    status.update_available = false;
                    status.checked_at = Some(now_ts());
                    status.downloaded_bytes = 0;
                    status.content_length = None;
                    status.percent = None;
                    status.message = "최신 버전입니다.".to_string();
                    status.release_date = None;
                    status.release_notes = None;
                    status.download_url = None;
                })
            }
            Err(error) => self.set_error(&format!("업데이트 확인 실패: {error}")),
        }
    }

    pub async fn install(&self) -> UpdateStatus {
        let Some(app) = self.app.clone() else {
            return self.set_error("이 빌드는 온에어 업데이트를 지원하지 않습니다.");
        };

        let mut update = self
            .pending_update
            .lock()
            .ok()
            .and_then(|guard| guard.clone());
        if update.is_none() {
            let status = self.check().await;
            if !status.update_available {
                return status;
            }
            update = self
                .pending_update
                .lock()
                .ok()
                .and_then(|guard| guard.clone());
        }

        let Some(update) = update else {
            return self.set_error("설치할 업데이트를 찾지 못했습니다.");
        };

        self.update_status(|status| {
            status.phase = "downloading".to_string();
            status.message = format!("v{} 다운로드 중", update.version);
            status.downloaded_bytes = 0;
            status.content_length = None;
            status.percent = Some(0.0);
        });

        let result = update
            .download_and_install(
                |chunk_length, content_length| {
                    self.record_download_progress(chunk_length as u64, content_length);
                },
                || {
                    self.update_status(|status| {
                        status.phase = "installing".to_string();
                        status.message = "업데이트 설치 중".to_string();
                        status.percent = Some(100.0);
                    });
                },
            )
            .await;

        match result {
            Ok(()) => {
                let _ = self.update_status(|status| {
                    status.phase = "restarting".to_string();
                    status.message = "업데이트 설치 완료. 앱을 재시작합니다.".to_string();
                    status.percent = Some(100.0);
                });
                app.restart();
            }
            Err(error) => self.set_error(&format!("업데이트 설치 실패: {error}")),
        }
    }

    fn store_available_update(&self, update: Update) -> UpdateStatus {
        let available_version = update.version.clone();
        let release_date = update.date.map(|date| date.to_string());
        let release_notes = update.body.clone();
        let download_url = Some(update.download_url.to_string());

        if let Ok(mut pending) = self.pending_update.lock() {
            *pending = Some(update);
        }

        self.update_status(|status| {
            status.phase = "available".to_string();
            status.available_version = Some(available_version.clone());
            status.update_available = true;
            status.checked_at = Some(now_ts());
            status.downloaded_bytes = 0;
            status.content_length = None;
            status.percent = None;
            status.message = format!("v{available_version} 업데이트 가능");
            status.release_date = release_date;
            status.release_notes = release_notes;
            status.download_url = download_url;
        })
    }

    fn record_download_progress(&self, chunk_length: u64, content_length: Option<u64>) {
        self.update_status(|status| {
            status.phase = "downloading".to_string();
            status.downloaded_bytes = status.downloaded_bytes.saturating_add(chunk_length);
            status.content_length = content_length;
            status.percent = content_length
                .filter(|length| *length > 0)
                .map(|length| (status.downloaded_bytes as f64 / length as f64 * 100.0).min(99.0));
            status.message = match status.percent {
                Some(percent) => format!("업데이트 다운로드 중 {percent:.0}%"),
                None => "업데이트 다운로드 중".to_string(),
            };
        });
    }

    fn set_error(&self, message: &str) -> UpdateStatus {
        self.update_status(|status| {
            status.phase = "error".to_string();
            status.checked_at = Some(now_ts());
            status.message = message.to_string();
            status.percent = None;
        })
    }

    fn update_status(&self, update: impl FnOnce(&mut UpdateStatus)) -> UpdateStatus {
        let mut status = self.status.write().expect("update state lock");
        update(&mut status);
        status.clone()
    }
}

fn now_ts() -> i64 {
    chrono::Local::now().timestamp()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_state_reports_update_unsupported() {
        let state = UpdateState::unavailable();

        let status = tauri::async_runtime::block_on(state.check());

        assert_eq!(status.phase, "error");
        assert!(status.message.contains("지원하지 않습니다"));
    }
}
