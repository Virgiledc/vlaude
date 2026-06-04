/// POSIX single-quote escaping: ' -> '\''
fn single_quote(s: &str) -> String {
    let escaped = s.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Claude,
    Term,
}

/// Build the argument vector passed to `wsl.exe` to launch an interactive
/// `claude` REPL in `cwd`. `zsh -ic` loads the user's interactive env (nvm,
/// PATH) and `exec claude` makes closing the PTY kill claude.
pub fn build_wsl_argv(distro: Option<&str>, cwd: &str, kind: SessionKind) -> Vec<String> {
    let program = match kind {
        SessionKind::Claude => "claude",
        SessionKind::Term => "zsh -i",
    };
    let inner = format!("cd {} && exec {}", single_quote(cwd), program);
    let mut argv = Vec::new();
    if let Some(d) = distro {
        argv.push("-d".to_string());
        argv.push(d.to_string());
    }
    argv.push("--".to_string());
    argv.push("zsh".to_string());
    argv.push("-ic".to_string());
    argv.push(inner);
    argv
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_distro() {
        let argv = build_wsl_argv(None, "/home/virgile/dt/threadscrap", SessionKind::Claude);
        assert_eq!(
            argv,
            vec![
                "--".to_string(),
                "zsh".to_string(),
                "-ic".to_string(),
                "cd '/home/virgile/dt/threadscrap' && exec claude".to_string(),
            ]
        );
    }

    #[test]
    fn with_distro() {
        let argv = build_wsl_argv(Some("Ubuntu"), "/a/b", SessionKind::Claude);
        assert_eq!(argv[0], "-d");
        assert_eq!(argv[1], "Ubuntu");
        assert_eq!(argv[2], "--");
        assert_eq!(argv.last().unwrap(), "cd '/a/b' && exec claude");
    }

    #[test]
    fn escapes_single_quote_in_path() {
        let argv = build_wsl_argv(None, "/a b/it's", SessionKind::Claude);
        assert_eq!(argv.last().unwrap(), "cd '/a b/it'\\''s' && exec claude");
    }

    #[test]
    fn term_kind_runs_interactive_zsh() {
        let argv = build_wsl_argv(None, "/home/x", SessionKind::Term);
        assert_eq!(
            argv,
            vec![
                "--".to_string(),
                "zsh".to_string(),
                "-ic".to_string(),
                "cd '/home/x' && exec zsh -i".to_string(),
            ]
        );
    }
}
