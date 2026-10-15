use std::fs;
use std::path::PathBuf;
use std::process::Command;

use crate::files::home;
use crate::pty::shell::single_quote;

const SQUAD_PY: &str = include_str!("../../bus/squad.py");
const SKILL_PERE: &str = include_str!("../../skills/squad-pere/SKILL.md");
const SKILL_FILS: &str = include_str!("../../skills/squad-fils/SKILL.md");

pub(crate) fn write_home_file(rel: &str, content: &str) -> Result<PathBuf, String> {
    let path = home()?.join(rel);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| format!("write failed: {}: {e}", path.display()))?;
    Ok(path)
}

pub fn install_squad_assets() -> Result<(), String> {
    write_home_file(".vlaude/squad.py", SQUAD_PY)?;
    write_home_file(".claude/skills/squad-pere/SKILL.md", SKILL_PERE)?;
    write_home_file(".claude/skills/squad-fils/SKILL.md", SKILL_FILS)?;
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
    let out = Command::new("bash").arg("-c").arg(inner).output().map_err(|e| e.to_string())?;
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
