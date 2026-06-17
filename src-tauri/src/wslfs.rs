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

/// An invocable Claude Code command or skill discovered under ~/.claude.
#[derive(serde::Serialize)]
pub struct PluginItem {
    pub invocation: String, // e.g. "/adversarial" or "/vercel:deploy"
    pub kind: String,       // "skill" | "command"
    pub source: String,     // "global" or the plugin name
    pub description: String,
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

/// Bash enumeration of every invocable command/skill under ~/.claude.
/// Emits records: invocation \037 kind \037 source \037 description \036
const ENUM_SCRIPT: &str = r#"#!/usr/bin/env bash
CLAUDE="$HOME/.claude"
US=$'\037'
RS=$'\036'

desc_of() {
  awk '
    function trim(s){ sub(/^[ \t]+/,"",s); sub(/[ \t]+$/,"",s); return s }
    NR==1 { if ($0 !~ /^---[ \t]*$/) exit; infm=1; next }
    infm && /^---[ \t]*$/ { exit }
    infm && /^description:/ {
      v=$0; sub(/^description:[ \t]*/,"",v); gsub(/\r/,"",v); v=trim(v);
      if (v=="" || v==">" || v=="|" || v==">-" || v=="|-" || v==">+" || v=="|+") { want=1; next }
      sub(/^"/,"",v); sub(/"$/,"",v); sub(/^'\''/,"",v); sub(/'\''$/,"",v);
      print v; exit
    }
    infm && want {
      v=$0; gsub(/\r/,"",v); v=trim(v);
      if (v=="") next;
      sub(/^"/,"",v); sub(/"$/,"",v);
      print v; exit
    }
  ' "$1" 2>/dev/null
}

name_of() { awk -F'"' '/"name"[ \t]*:/ { print $4; exit }' "$1" 2>/dev/null; }

emit() {
  local desc; desc="$(desc_of "$4")"; desc="${desc//$'\n'/ }"
  printf '%s%s%s%s%s%s%s%s' "$1" "$US" "$2" "$US" "$3" "$US" "$desc" "$RS"
}

if [ -d "$CLAUDE/skills" ]; then
  for d in "$CLAUDE"/skills/*/; do
    f="${d}SKILL.md"; [ -f "$f" ] || continue
    emit "/$(basename "$d")" "skill" "global" "$f"
  done
fi

if [ -d "$CLAUDE/commands" ]; then
  for f in "$CLAUDE"/commands/*.md; do
    [ -f "$f" ] || continue
    b="$(basename "$f" .md)"; case "$b" in _*) continue;; esac
    emit "/$b" "command" "global" "$f"
  done
fi

find -L "$CLAUDE/plugins" -name plugin.json -path '*/.claude-plugin/plugin.json' \
     -not -path '*/marketplaces/*' -not -path '*/.git/*' 2>/dev/null |
while IFS= read -r pj; do
  root="$(dirname "$(dirname "$pj")")"
  pname="$(name_of "$pj")"
  [ -n "$pname" ] || continue
  if [ -d "$root/commands" ]; then
    for f in "$root"/commands/*.md; do
      [ -f "$f" ] || continue
      b="$(basename "$f" .md)"; case "$b" in _*) continue;; esac
      emit "/$pname:$b" "command" "$pname" "$f"
    done
  fi
  if [ -d "$root/skills" ]; then
    for d in "$root"/skills/*/; do
      f="${d}SKILL.md"; [ -f "$f" ] || continue
      emit "/$pname:$(basename "$d")" "skill" "$pname" "$f"
    done
  fi
done

exit 0
"#;

/// Enumerate every invocable command/skill on disk under ~/.claude (all
/// installed plugins + global skills/commands), deduplicated by invocation.
#[tauri::command]
pub fn list_claude_plugins() -> Result<Vec<PluginItem>, String> {
    let cmd = format!("printf %s {} | base64 -d | bash", b64_encode(ENUM_SCRIPT.as_bytes()));
    let out = run_wsl(&cmd)?;

    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::new();
    for rec in out.split('\u{1e}') {
        let rec = rec.trim_matches('\n');
        if rec.is_empty() {
            continue;
        }
        let mut fields = rec.split('\u{1f}');
        let invocation = fields.next().unwrap_or("").to_string();
        let kind = fields.next().unwrap_or("").to_string();
        let source = fields.next().unwrap_or("").to_string();
        let description = fields.next().unwrap_or("").trim().to_string();
        if invocation.is_empty() {
            continue;
        }
        if seen.insert(invocation.clone()) {
            items.push(PluginItem { invocation, kind, source, description });
        }
    }
    items.sort_by(|a, b| a.invocation.to_lowercase().cmp(&b.invocation.to_lowercase()));
    Ok(items)
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
