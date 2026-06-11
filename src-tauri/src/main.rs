#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env, fs, io,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Emitter, Manager, Url};

const DESKTOP_SIDECAR_STARTUP_EVENT: &str = "ai-cove-design://sidecar-startup";

struct SidecarLogPaths {
    startup: PathBuf,
    stdout: PathBuf,
    stderr: PathBuf,
}

struct StartedApiSidecar {
    child: Child,
    url: Url,
    port: u16,
    logs: SidecarLogPaths,
}

#[derive(Default)]
struct ApiSidecar {
    child: Mutex<Option<Child>>,
}

impl Drop for ApiSidecar {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut process) = child.take() {
                let _ = process.kill();
                let _ = process.wait();
            }
        }
    }
}

fn allocate_api_port() -> io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn wait_for_api_port(port: u16) -> io::Result<()> {
    let deadline = Instant::now() + sidecar_startup_timeout();
    let address = format!("127.0.0.1:{port}");

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(
            &address.parse().expect("valid local socket address"),
            Duration::from_millis(250),
        )
        .is_ok()
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    Err(io::Error::new(
        io::ErrorKind::TimedOut,
        "AI Cove Design API sidecar did not start in time",
    ))
}

fn sidecar_startup_timeout() -> Duration {
    if cfg!(target_os = "windows") {
        Duration::from_secs(45)
    } else {
        Duration::from_secs(20)
    }
}

fn resolve_sidecar_root(resource_dir: &Path, sidecar_override: Option<String>) -> PathBuf {
    if let Some(path) = sidecar_override {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let direct_sidecar_dir = resource_dir.join("sidecar");
    if direct_sidecar_dir.exists() {
        return direct_sidecar_dir;
    }

    let nested_sidecar_dir = resource_dir.join("resources").join("sidecar");
    if nested_sidecar_dir.exists() {
        return nested_sidecar_dir;
    }

    direct_sidecar_dir
}

fn sidecar_root(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    Ok(resolve_sidecar_root(
        &app.path().resource_dir()?,
        env::var("AI_COVE_DESIGN_SIDECAR_DIR").ok(),
    ))
}

fn normalize_sidecar_runtime_path(path: &Path) -> PathBuf {
    normalize_sidecar_runtime_path_for_platform(path, cfg!(target_os = "windows"))
}

fn normalize_sidecar_runtime_path_for_platform(path: &Path, windows: bool) -> PathBuf {
    if !windows {
        return path.to_path_buf();
    }

    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }

    path.to_path_buf()
}

#[cfg(target_os = "windows")]
fn configure_sidecar_command(command: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_sidecar_command(_command: &mut Command) {}

fn sidecar_log_paths(app_data_dir: &Path) -> SidecarLogPaths {
    let log_dir = app_data_dir.join("logs");
    SidecarLogPaths {
        startup: log_dir.join("api-sidecar-startup.log"),
        stdout: log_dir.join("api-sidecar-stdout.log"),
        stderr: log_dir.join("api-sidecar-stderr.log"),
    }
}

fn append_sidecar_log(path: &Path, message: &str) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        use std::io::Write;
        let _ = writeln!(file, "[{:?}] {}", std::time::SystemTime::now(), message);
    }
}

fn emit_sidecar_startup(handle: &AppHandle, status: &str, message: Option<String>) {
    let payload = serde_json::json!({
        "status": status,
        "message": message
    });
    let _ = handle.emit(DESKTOP_SIDECAR_STARTUP_EVENT, payload);
}

fn stop_api_sidecar(handle: &AppHandle) {
    if let Ok(mut child) = handle.state::<ApiSidecar>().child.lock() {
        if let Some(mut process) = child.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}

#[tauri::command]
fn prepare_desktop_update_install(handle: AppHandle) {
    stop_api_sidecar(&handle);
}

fn format_sidecar_startup_failure(logs: &SidecarLogPaths, detail: &str) -> String {
    format!(
        "AI Cove Design 本地服务启动失败。{detail} 日志位置：{}",
        logs.startup.display()
    )
}

fn monitor_api_sidecar_startup(handle: AppHandle, port: u16, url: Url, logs: SidecarLogPaths) {
    std::thread::spawn(move || match wait_for_api_port(port) {
        Ok(()) => {
            append_sidecar_log(
                &logs.startup,
                &format!("sidecar ready on http://127.0.0.1:{port}/"),
            );

            if let Some(window) = handle.get_webview_window("main") {
                if let Err(error) = window.navigate(url.clone()) {
                    let message = format_sidecar_startup_failure(
                        &logs,
                        &format!("窗口跳转本地服务失败：{error}。"),
                    );
                    append_sidecar_log(&logs.startup, &message);
                    emit_sidecar_startup(&handle, "error", Some(message));
                }
            }
        }
        Err(error) => {
            let message = format_sidecar_startup_failure(
                &logs,
                &format!("本地服务未在 {} 秒内就绪：{error}。", sidecar_startup_timeout().as_secs()),
            );
            append_sidecar_log(&logs.startup, &message);
            stop_api_sidecar(&handle);
            emit_sidecar_startup(&handle, "error", Some(message));
        }
    });
}

fn start_api_sidecar(app: &tauri::App) -> Result<Option<StartedApiSidecar>, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) && env::var("AI_COVE_DESIGN_START_SIDECAR").as_deref() != Ok("1") {
        return Ok(None);
    }

    let sidecar_dir = sidecar_root(app)?;
    let node_name = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };
    let node_path = normalize_sidecar_runtime_path(&sidecar_dir.join("node").join(node_name));
    let api_entry =
        normalize_sidecar_runtime_path(&sidecar_dir.join("api").join("dist").join("index.js"));
    let api_dir = normalize_sidecar_runtime_path(&sidecar_dir.join("api"));
    let prompt_pool_dir =
        normalize_sidecar_runtime_path(&sidecar_dir.join("prompt-pool-data"));
    let web_dist_dir = normalize_sidecar_runtime_path(&sidecar_dir.join("web-dist"));

    if !node_path.exists() || !api_entry.exists() || !web_dist_dir.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "AI Cove Design sidecar resources are missing in {}",
                sidecar_dir.display()
            ),
        )
        .into());
    }

    let port = allocate_api_port()?;
    let app_data_dir = app.path().app_data_dir()?;
    let data_dir = normalize_sidecar_runtime_path(&app_data_dir.join("data"));
    let logs = sidecar_log_paths(&app_data_dir);
    fs::create_dir_all(&data_dir)?;
    if let Some(parent) = logs.startup.parent() {
        fs::create_dir_all(parent)?;
    }

    let ai_cove_api_base_url =
        env::var("AI_COVE_API_BASE_URL").unwrap_or_else(|_| "https://ai-cove.com".to_string());
    let ai_cove_public_base_url =
        env::var("AI_COVE_PUBLIC_BASE_URL").unwrap_or_else(|_| ai_cove_api_base_url.clone());

    append_sidecar_log(
        &logs.startup,
        &format!(
            "starting sidecar: node={} entry={} cwd={} port={port}",
            node_path.display(),
            api_entry.display(),
            api_dir.display()
        ),
    );

    let stdout_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&logs.stdout)?;
    let stderr_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&logs.stderr)?;

    let mut command = Command::new(node_path);
    command
        .arg(api_entry)
        .current_dir(api_dir)
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("DATA_DIR", data_dir)
        .env("PROMPT_POOL_DIR", prompt_pool_dir)
        .env("HOST_ADAPTER", "ai-cove-new-api")
        .env("AI_COVE_API_BASE_URL", ai_cove_api_base_url)
        .env("AI_COVE_PUBLIC_BASE_URL", ai_cove_public_base_url)
        .env("AI_COVE_DESIGN_WEB_DIST_DIR", web_dist_dir)
        .env("DESKTOP_AUTH_ENABLED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));
    configure_sidecar_command(&mut command);
    let child = command.spawn()?;

    let url = Url::parse(&format!("http://127.0.0.1:{port}/"))?;
    append_sidecar_log(
        &logs.startup,
        &format!("spawned sidecar process pid={}", child.id()),
    );

    Ok(Some(StartedApiSidecar {
        child,
        url,
        port,
        logs,
    }))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(ApiSidecar::default())
        .invoke_handler(tauri::generate_handler![prepare_desktop_update_install])
        .setup(|app| {
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            match start_api_sidecar(app) {
                Ok(Some(started)) => {
                    emit_sidecar_startup(
                        &app.handle(),
                        "starting",
                        Some("正在启动本地服务...".to_string()),
                    );
                    app.state::<ApiSidecar>()
                        .child
                        .lock()
                        .expect("failed to lock API sidecar state")
                        .replace(started.child);
                    monitor_api_sidecar_startup(
                        app.handle().clone(),
                        started.port,
                        started.url,
                        started.logs,
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    if let Ok(app_data_dir) = app.path().app_data_dir() {
                        let logs = sidecar_log_paths(&app_data_dir);
                        let message = format_sidecar_startup_failure(
                            &logs,
                            &format!("本地服务进程创建失败：{error}。"),
                        );
                        append_sidecar_log(&logs.startup, &message);
                        emit_sidecar_startup(&app.handle(), "error", Some(message));
                    } else {
                        emit_sidecar_startup(
                            &app.handle(),
                            "error",
                            Some(format!("AI Cove Design 本地服务启动失败：{error}")),
                        );
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AI Cove Design desktop app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_bundled_sidecar_under_resources_directory() {
        let temp_dir = env::temp_dir().join(format!(
            "ai-cove-design-sidecar-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_dir);
        let bundled_sidecar_dir = temp_dir.join("resources").join("sidecar");
        fs::create_dir_all(&bundled_sidecar_dir).expect("create test sidecar directory");

        let resolved = resolve_sidecar_root(&temp_dir, None);

        assert_eq!(resolved, bundled_sidecar_dir);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn non_empty_sidecar_override_wins() {
        let resource_dir = PathBuf::from("/tmp/ai-cove-design-resource-dir");
        let override_dir = PathBuf::from("/tmp/ai-cove-design-override-sidecar");

        let resolved =
            resolve_sidecar_root(&resource_dir, Some(override_dir.to_string_lossy().to_string()));

        assert_eq!(resolved, override_dir);
    }

    #[test]
    fn sidecar_log_paths_live_under_app_logs_directory() {
        let app_data_dir = PathBuf::from("/tmp/ai-cove-design-app-data");
        let paths = sidecar_log_paths(&app_data_dir);

        assert_eq!(
            paths.startup,
            app_data_dir.join("logs").join("api-sidecar-startup.log")
        );
        assert_eq!(
            paths.stdout,
            app_data_dir.join("logs").join("api-sidecar-stdout.log")
        );
        assert_eq!(
            paths.stderr,
            app_data_dir.join("logs").join("api-sidecar-stderr.log")
        );
    }

    #[test]
    fn strips_windows_verbatim_drive_prefix_for_runtime_paths() {
        let raw = PathBuf::from(r"\\?\D:\Software\AI Cove Design\resources\sidecar\api\dist\index.js");

        let normalized = normalize_sidecar_runtime_path_for_platform(&raw, true);

        assert_eq!(
            normalized,
            PathBuf::from(r"D:\Software\AI Cove Design\resources\sidecar\api\dist\index.js")
        );
    }

    #[test]
    fn strips_windows_verbatim_unc_prefix_for_runtime_paths() {
        let raw = PathBuf::from(r"\\?\UNC\server\share\AI Cove Design\resources\sidecar");

        let normalized = normalize_sidecar_runtime_path_for_platform(&raw, true);

        assert_eq!(
            normalized,
            PathBuf::from(r"\\server\share\AI Cove Design\resources\sidecar")
        );
    }

    #[test]
    fn leaves_non_windows_runtime_paths_unchanged() {
        let raw = PathBuf::from("/tmp/ai-cove-design/resources/sidecar/api/dist/index.js");

        let normalized = normalize_sidecar_runtime_path_for_platform(&raw, false);

        assert_eq!(normalized, raw);
    }
}
