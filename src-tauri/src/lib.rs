mod bus;
mod pty;
mod squad;
mod wslfs;

use std::fs;
use pty::manager::PtyManager;
use pty::wsl::SessionKind;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::Manager;
use tauri::State;

#[tauri::command]
fn pty_spawn(
    state: State<PtyManager>,
    id: String,
    distro: Option<String>,
    cwd: String,
    cols: u16,
    rows: u16,
    kind: SessionKind,
    env: Option<Vec<(String, String)>>,
    claude_session_id: Option<String>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let mut env = env.unwrap_or_default();
    if let Some(dir) = bus::bus_wsl_dir() {
        env.push(("VLAUDE_BUS".to_string(), dir));
    }
    state.spawn(id, distro, cwd, cols, rows, kind, env, claude_session_id, on_data)
}

#[tauri::command]
fn pty_write(state: State<PtyManager>, id: String, data: Vec<u8>) -> Result<(), String> {
    state.write(&id, &data)
}

#[tauri::command]
fn pty_resize(state: State<PtyManager>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.resize(&id, cols, rows)
}

#[tauri::command]
fn pty_close(state: State<PtyManager>, id: String) -> Result<(), String> {
    state.close(&id)
}

fn layout_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("layout.json"))
}

#[tauri::command]
fn save_layout(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = layout_path(&app)?;
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_layout(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = layout_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PtyManager::default())
        .setup(|app| {
            std::thread::spawn(|| {
                if let Err(e) = squad::install_squad_assets() {
                    eprintln!("squad assets install failed: {e}");
                }
                if let Err(e) = bus::install_bus_assets() {
                    eprintln!("bus assets install failed: {e}");
                }
            });
            bus::start_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            wslfs::wsl_home,
            wslfs::wsl_read_file,
            wslfs::list_wsl_dirs,
            wslfs::index_wsl_dirs,
            save_layout,
            load_layout,
            squad::squad_cli,
            bus::bus_publish_tiles
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
