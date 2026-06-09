#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env, fs, io,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, Url};

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
    let deadline = Instant::now() + Duration::from_secs(20);
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

fn start_api_sidecar(app: &tauri::App) -> Result<Option<(Child, Url)>, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) && env::var("AI_COVE_DESIGN_START_SIDECAR").as_deref() != Ok("1") {
        return Ok(None);
    }

    let sidecar_dir = sidecar_root(app)?;
    let node_name = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };
    let node_path = sidecar_dir.join("node").join(node_name);
    let api_entry = sidecar_dir.join("api").join("dist").join("index.js");
    let web_dist_dir = sidecar_dir.join("web-dist");

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
    let data_dir = app.path().app_data_dir()?.join("data");
    fs::create_dir_all(&data_dir)?;

    let ai_cove_api_base_url =
        env::var("AI_COVE_API_BASE_URL").unwrap_or_else(|_| "https://ai-cove.com".to_string());
    let ai_cove_public_base_url =
        env::var("AI_COVE_PUBLIC_BASE_URL").unwrap_or_else(|_| ai_cove_api_base_url.clone());

    let child = Command::new(node_path)
        .arg(api_entry)
        .current_dir(sidecar_dir.join("api"))
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("DATA_DIR", data_dir)
        .env(
            "PROMPT_POOL_DIR",
            sidecar_dir.join("prompt-pool-data"),
        )
        .env("HOST_ADAPTER", "ai-cove-new-api")
        .env("AI_COVE_API_BASE_URL", ai_cove_api_base_url)
        .env("AI_COVE_PUBLIC_BASE_URL", ai_cove_public_base_url)
        .env("AI_COVE_DESIGN_WEB_DIST_DIR", web_dist_dir)
        .env("DESKTOP_AUTH_ENABLED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    wait_for_api_port(port)?;
    let url = Url::parse(&format!("http://127.0.0.1:{port}/"))?;
    Ok(Some((child, url)))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(ApiSidecar::default())
        .setup(|app| {
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            if let Some((child, url)) = start_api_sidecar(app)? {
                app.state::<ApiSidecar>()
                    .child
                    .lock()
                    .expect("failed to lock API sidecar state")
                    .replace(child);

                if let Some(window) = app.get_webview_window("main") {
                    window.navigate(url)?;
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
}
