use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub(crate) fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| "HOME missing".to_string())
}

#[tauri::command]
pub fn home_dir() -> Result<String, String> {
    Ok(home()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<Option<String>, String> {
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn visible_dir_names(path: &str) -> Vec<String> {
    let Ok(entries) = fs::read_dir(path) else { return Vec::new() };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| !n.starts_with('.'))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names
}

#[tauri::command]
pub fn list_dirs(path: String) -> Result<Vec<String>, String> {
    Ok(visible_dir_names(&path))
}

const INDEX_SCRIPT: &str = r#"find "$HOME" -mindepth 1 -maxdepth 5 \( -name '.*' -o -name node_modules -o -name __pycache__ -o -name venv -o -name site-packages -o -name target -o -name dist -o -name build \) -prune -o -type d -print 2>/dev/null
exit 0
"#;

#[tauri::command]
pub async fn index_dirs() -> Result<Vec<String>, String> {
    let out = Command::new("bash").arg("-c").arg(INDEX_SCRIPT).output().map_err(|e| e.to_string())?;
    let out = String::from_utf8_lossy(&out.stdout);
    Ok(out.lines().filter(|l| !l.is_empty()).map(|s| s.to_string()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_distinguishes_absent_empty_present() {
        let dir = std::env::temp_dir().join(format!("vlaude-files-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let full = dir.join("a.txt");
        let empty = dir.join("e.txt");
        fs::write(&full, "hello").unwrap();
        fs::write(&empty, "").unwrap();
        assert_eq!(read_file(full.to_string_lossy().to_string()).unwrap(), Some("hello".to_string()));
        assert_eq!(read_file(empty.to_string_lossy().to_string()).unwrap(), Some(String::new()));
        assert_eq!(read_file(dir.join("absent").to_string_lossy().to_string()).unwrap(), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lists_visible_dirs_sorted_case_insensitive() {
        let dir = std::env::temp_dir().join(format!("vlaude-dirs-{}", std::process::id()));
        for d in ["beta", "Alpha", ".hidden", "gamma"] {
            fs::create_dir_all(dir.join(d)).unwrap();
        }
        fs::write(dir.join("file.txt"), "").unwrap();
        assert_eq!(visible_dir_names(&dir.to_string_lossy()), vec!["Alpha", "beta", "gamma"]);
        assert!(visible_dir_names("/nonexistent/vlaude").is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }
}
