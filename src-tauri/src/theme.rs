use std::collections::HashMap;
use std::fs;

use crate::files::home;

fn parse_toml_strings(src: &str) -> HashMap<String, String> {
    src.lines()
        .map(str::trim)
        .filter(|l| !l.starts_with('#'))
        .filter_map(|line| {
            let (k, v) = line.split_once('=')?;
            let v = v.trim();
            let v = v.strip_prefix('"')?.strip_suffix('"')?;
            Some((k.trim().to_string(), v.to_string()))
        })
        .collect()
}

fn parse_kitty(src: &str) -> HashMap<String, String> {
    src.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| {
            let (k, v) = l.split_once(char::is_whitespace)?;
            Some((k.to_string(), v.trim().to_string()))
        })
        .collect()
}

#[derive(serde::Serialize)]
pub struct OmarchyTheme {
    name: Option<String>,
    colors: HashMap<String, String>,
    terminal: HashMap<String, String>,
}

#[tauri::command]
pub fn omarchy_theme() -> Result<Option<OmarchyTheme>, String> {
    let dir = home()?.join(".local/state/omarchy/current");
    let Ok(colors) = fs::read_to_string(dir.join("theme/colors.toml")) else { return Ok(None) };
    let terminal = fs::read_to_string(dir.join("theme/kitty.conf")).unwrap_or_default();
    let name = fs::read_to_string(dir.join("theme.name")).ok().map(|s| s.trim().to_string());
    Ok(Some(OmarchyTheme {
        name,
        colors: parse_toml_strings(&colors),
        terminal: parse_kitty(&terminal),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_colors_toml_string_values_only() {
        let src = "mode = \"dark\"\n\naccent = \"#8bc9eb\"\nbroken = #fff\n# note = \"x\"\n";
        let map = parse_toml_strings(src);
        assert_eq!(map.get("accent").map(String::as_str), Some("#8bc9eb"));
        assert_eq!(map.get("mode").map(String::as_str), Some("dark"));
        assert!(!map.contains_key("broken"));
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn parses_kitty_key_value_lines() {
        let src = "# Lumon\nforeground #d6e2ee\ncolor0  #16242d\n\nselection_background #243d56\n";
        let map = parse_kitty(src);
        assert_eq!(map.get("foreground").map(String::as_str), Some("#d6e2ee"));
        assert_eq!(map.get("color0").map(String::as_str), Some("#16242d"));
        assert_eq!(map.get("selection_background").map(String::as_str), Some("#243d56"));
        assert_eq!(map.len(), 3);
    }
}
