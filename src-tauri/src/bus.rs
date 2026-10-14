use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::Duration;

use tauri::Manager;

use crate::pty::manager::PtyManager;
use crate::squad::write_wsl_file;
use crate::wslfs::no_window;

const VLAUDE_PY: &str = include_str!("../../bus/vlaude.py");
const SKILL_VLAUDE: &str = include_str!("../../skills/vlaude/SKILL.md");

#[derive(serde::Deserialize)]
struct Envelope {
    to: String,
    text: String,
}

fn bus_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .ok()
        .map(|h| PathBuf::from(h).join(".vlaude").join("bus"))
}

pub(crate) fn win_to_wsl(p: &str) -> String {
    let b = p.as_bytes();
    if b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
        let rest = p[2..].trim_start_matches(['\\', '/']).replace('\\', "/");
        return format!("/mnt/{}/{}", (b[0] as char).to_ascii_lowercase(), rest);
    }
    p.replace('\\', "/")
}

pub fn bus_wsl_dir() -> Option<String> {
    bus_dir().map(|p| win_to_wsl(&p.to_string_lossy()))
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
    write_wsl_file("$HOME/.local/bin/vlaude", VLAUDE_PY)?;
    write_wsl_file("$HOME/.claude/skills/vlaude/SKILL.md", SKILL_VLAUDE)?;
    write_wsl_file("$HOME/.agents/skills/vlaude/SKILL.md", SKILL_VLAUDE)?;
    let mut cmd = Command::new("wsl.exe");
    cmd.arg("--").arg("bash").arg("-c").arg("chmod +x \"$HOME/.local/bin/vlaude\"");
    no_window(&mut cmd);
    let status = cmd.status().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("chmod vlaude failed".to_string());
    }
    Ok(())
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

pub fn start_watcher(app: tauri::AppHandle) {
    let Some(out) = bus_dir().map(|d| d.join("out")) else { return };
    let _ = fs::create_dir_all(&out);
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(300));
        let Ok(entries) = fs::read_dir(&out) else { continue };
        let mut files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x == "json"))
            .collect();
        files.sort();
        for path in files {
            if let Err(e) = deliver(&app, &path) {
                eprintln!("bus delivery failed {}: {e}", path.display());
            }
        }
    });
}

#[tauri::command]
pub fn bus_publish_tiles(json: String) -> Result<(), String> {
    let dir = bus_dir().ok_or("USERPROFILE missing")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("tiles.json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("tiles.json")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_drive_path() {
        assert_eq!(win_to_wsl(r"C:\Users\VirgileDc\.vlaude\bus"), "/mnt/c/Users/VirgileDc/.vlaude/bus");
    }

    #[test]
    fn leaves_non_drive_path() {
        assert_eq!(win_to_wsl("/home/x"), "/home/x");
    }

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
