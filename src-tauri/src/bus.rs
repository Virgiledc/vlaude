use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use inotify::{EventMask, Inotify, WatchMask};
use tauri::Manager;

use crate::files::home;
use crate::pty::manager::PtyManager;
use crate::squad::write_home_file;

const VLAUDE_PY: &str = include_str!("../../bus/vlaude.py");
const SKILL_VLAUDE: &str = include_str!("../../skills/vlaude/SKILL.md");

#[derive(serde::Deserialize)]
struct Envelope {
    to: String,
    text: String,
}

fn bus_dir() -> Option<PathBuf> {
    home().ok().map(|h| h.join(".vlaude").join("bus"))
}

pub fn bus_dir_string() -> Option<String> {
    bus_dir().map(|p| p.to_string_lossy().to_string())
}

pub(crate) fn paste_payload(text: &str) -> Vec<u8> {
    let body: String = text
        .replace("\r\n", "\n")
        .chars()
        .filter_map(|c| match c {
            '\n' | '\r' => Some('\r'),
            '\t' => Some(c),
            c if c.is_control() => None,
            c => Some(c),
        })
        .collect();
    format!("\x15\x1b[200~{body}\x1b[201~").into_bytes()
}

pub fn install_bus_assets() -> Result<(), String> {
    let cli = write_home_file(".local/bin/vlaude", VLAUDE_PY)?;
    write_home_file(".claude/skills/vlaude/SKILL.md", SKILL_VLAUDE)?;
    write_home_file(".agents/skills/vlaude/SKILL.md", SKILL_VLAUDE)?;
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())
}

fn deliver(app: &tauri::AppHandle, path: &PathBuf) -> Result<(), String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string());
    let _ = fs::remove_file(path);
    let env: Envelope = serde_json::from_str(&raw?).map_err(|e| e.to_string())?;
    let pty = app.state::<PtyManager>();
    pty.write(&env.to, &paste_payload(&env.text))?;
    thread::sleep(Duration::from_millis(150));
    pty.write(&env.to, b"\r")
}

fn deliver_pending(app: &tauri::AppHandle, out: &Path) {
    let Ok(entries) = fs::read_dir(out) else { return };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    for path in files {
        if let Err(e) = deliver(app, &path) {
            eprintln!("bus delivery failed {}: {e}", path.display());
        }
    }
}

fn watch(inotify: &mut Inotify, out: &Path) -> std::io::Result<()> {
    fs::create_dir_all(out)?;
    inotify.watches().add(out, WatchMask::MOVED_TO | WatchMask::CLOSE_WRITE)?;
    Ok(())
}

pub fn start_watcher(app: tauri::AppHandle) {
    let Some(out) = bus_dir().map(|d| d.join("out")) else { return };
    thread::spawn(move || {
        let mut inotify = match Inotify::init().and_then(|mut i| watch(&mut i, &out).map(|_| i)) {
            Ok(i) => i,
            Err(e) => {
                eprintln!("bus inotify unavailable, polling: {e}");
                loop {
                    deliver_pending(&app, &out);
                    thread::sleep(Duration::from_millis(300));
                }
            }
        };
        let mut buf = [0u8; 4096];
        loop {
            deliver_pending(&app, &out);
            let Ok(events) = inotify.read_events_blocking(&mut buf) else {
                thread::sleep(Duration::from_millis(300));
                continue;
            };
            if events.into_iter().any(|e| e.mask.contains(EventMask::IGNORED)) {
                if let Err(e) = watch(&mut inotify, &out) {
                    eprintln!("bus watch lost: {e}");
                    thread::sleep(Duration::from_millis(300));
                }
            }
        }
    });
}

#[tauri::command]
pub fn bus_publish_tiles(json: String) -> Result<(), String> {
    let dir = bus_dir().ok_or("HOME missing")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("tiles.json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("tiles.json")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_wraps_in_bracketed_paste() {
        assert_eq!(paste_payload("a\nb"), b"\x15\x1b[200~a\rb\x1b[201~".to_vec());
    }

    #[test]
    fn payload_normalizes_crlf() {
        assert_eq!(paste_payload("a\r\nb"), b"\x15\x1b[200~a\rb\x1b[201~".to_vec());
    }

    #[test]
    fn payload_strips_escape_sequences() {
        assert_eq!(paste_payload("x\x1b[201~\x1ay"), b"\x15\x1b[200~x[201~y\x1b[201~".to_vec());
    }
}
