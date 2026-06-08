use std::io::Write;
use std::process::{Command, Stdio};

use crate::pty::wsl::single_quote;
use crate::wslfs::no_window;

const SQUAD_PY: &str = include_str!("../../bus/squad.py");
const SKILL_PERE: &str = include_str!("../../skills/squad-pere/SKILL.md");
const SKILL_FILS: &str = include_str!("../../skills/squad-fils/SKILL.md");

fn write_wsl_file(path: &str, content: &str) -> Result<(), String> {
    let inner = format!("mkdir -p \"$(dirname {p})\" && cat > {p}", p = path);
    let mut cmd = Command::new("wsl.exe");
    cmd.arg("--").arg("bash").arg("-c").arg(inner).stdin(Stdio::piped());
    no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("write failed: {path}"));
    }
    Ok(())
}

pub fn install_squad_assets() -> Result<(), String> {
    write_wsl_file("$HOME/.vlaude/squad.py", SQUAD_PY)?;
    write_wsl_file("$HOME/.claude/skills/squad-pere/SKILL.md", SKILL_PERE)?;
    write_wsl_file("$HOME/.claude/skills/squad-fils/SKILL.md", SKILL_FILS)?;
    Ok(())
}

#[tauri::command]
pub async fn squad_cli(cwd: String, args: Vec<String>) -> Result<String, String> {
    let cwd = cwd.trim_end_matches('/');
    let dir = single_quote(&format!("{cwd}/.vlaude"));
    let db = single_quote(&format!("{cwd}/.vlaude/squad.db"));
    let quoted: String = args
        .iter()
        .map(|a| single_quote(a))
        .collect::<Vec<_>>()
        .join(" ");
    let inner = format!(
        "mkdir -p {dir} >/dev/null 2>&1; python3 \"$HOME/.vlaude/squad.py\" --db {db} {quoted}"
    );
    let mut cmd = Command::new("wsl.exe");
    cmd.arg("--").arg("bash").arg("-c").arg(inner);
    no_window(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let json_line = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .to_string();
    if !out.status.success() && json_line.is_empty() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(json_line)
}
