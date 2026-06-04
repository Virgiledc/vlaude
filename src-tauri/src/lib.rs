mod pty;
mod wslfs;

use std::fs;
use pty::manager::PtyManager;
use pty::wsl::SessionKind;
use tauri::ipc::Channel;
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
    on_data: Channel<Vec<u8>>,
) -> Result<(), String> {
    state.spawn(id, distro, cwd, cols, rows, kind, on_data)
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

fn favorites_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("plugin_favorites.json"))
}

#[tauri::command]
fn save_plugin_favorites(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = favorites_path(&app)?;
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_plugin_favorites(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = favorites_path(&app)?;
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
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            wslfs::wsl_home,
            wslfs::list_wsl_dirs,
            wslfs::list_claude_plugins,
            save_layout,
            load_layout,
            save_plugin_favorites,
            load_plugin_favorites
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
