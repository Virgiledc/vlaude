use std::process::Command;

#[cfg(windows)]
pub(crate) fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
}
#[cfg(not(windows))]
pub(crate) fn no_window(_cmd: &mut Command) {}

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

fn decode_read(out: &str) -> Option<String> {
    out.strip_prefix('Y').map(|s| s.to_string())
}

#[tauri::command]
pub fn wsl_read_file(path: String) -> Result<Option<String>, String> {
    let safe = path.replace('\'', "'\\''");
    let script = format!("if [ -f '{p}' ]; then printf Y; cat '{p}'; else printf N; fi", p = safe);
    Ok(decode_read(&run_wsl(&script)?))
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

const INDEX_SCRIPT: &str = r#"find "$HOME" -mindepth 1 -maxdepth 5 \( -name '.*' -o -name node_modules -o -name __pycache__ -o -name venv -o -name site-packages -o -name target -o -name dist -o -name build \) -prune -o -type d -print 2>/dev/null
exit 0
"#;

#[tauri::command]
pub fn index_wsl_dirs() -> Result<Vec<String>, String> {
    let cmd = format!("printf %s {} | base64 -d | bash", b64_encode(INDEX_SCRIPT.as_bytes()));
    let out = run_wsl(&cmd)?;
    Ok(out.lines().filter(|l| !l.is_empty()).map(|s| s.to_string()).collect())
}

/// Standard base64 encode (no padding tricks), used to ship the enumeration
/// script to WSL without any Windows->WSL argument-quoting hazards.
fn b64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::b64_encode;
    use super::decode_read;

    #[test]
    fn decode_read_distinguishes_absent_empty_present() {
        assert_eq!(decode_read("Yhello"), Some("hello".to_string()));
        assert_eq!(decode_read("Y"), Some(String::new()));
        assert_eq!(decode_read("N"), None);
    }

    #[test]
    fn base64_rfc4648_vectors() {
        assert_eq!(b64_encode(b""), "");
        assert_eq!(b64_encode(b"f"), "Zg==");
        assert_eq!(b64_encode(b"fo"), "Zm8=");
        assert_eq!(b64_encode(b"foo"), "Zm9v");
        assert_eq!(b64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(b64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(b64_encode(b"foobar"), "Zm9vYmFy");
    }
}
