mod pty;
mod wslfs;

use pty::manager::PtyManager;
use tauri::ipc::Channel;
use tauri::State;

#[tauri::command]
fn pty_spawn(
    state: State<PtyManager>,
    id: String,
    distro: Option<String>,
    cwd: String,
    cols: u16,
    rows: u16,
    on_data: Channel<Vec<u8>>,
) -> Result<(), String> {
    state.spawn(id, distro, cwd, cols, rows, on_data)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            wslfs::wsl_home,
            wslfs::list_wsl_dirs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
