use std::process::Command;

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

fn run_wsl(script: &str) -> Result<String, String> {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["bash", "-c", script]);
    no_window(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub fn wsl_home() -> Result<String, String> {
    Ok(run_wsl("printf '%s' \"$HOME\"")?.trim().to_string())
}

#[tauri::command]
pub fn list_wsl_dirs(path: String) -> Result<Vec<String>, String> {
    let safe = path.replace('\'', "'\\''");
    let script = format!(
        "find '{}' -maxdepth 1 -mindepth 1 -type d ! -name '.*' -printf '%f\\n' 2>/dev/null | LC_ALL=C sort -f",
        safe
    );
    let out = run_wsl(&script)?;
    Ok(out.lines().filter(|l| !l.is_empty()).map(|s| s.to_string()).collect())
}
