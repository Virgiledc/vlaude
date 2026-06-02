/// POSIX single-quote escaping: ' -> '\''
fn single_quote(s: &str) -> String {
    let escaped = s.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

/// Build the argument vector passed to `wsl.exe` to launch an interactive
/// `claude` REPL in `cwd`. `bash -lic` loads the login PATH (~/.local/bin)
/// and `exec claude` makes closing the PTY kill claude.
pub fn build_wsl_argv(distro: Option<&str>, cwd: &str) -> Vec<String> {
    let inner = format!("cd {} && exec claude", single_quote(cwd));
    let mut argv = Vec::new();
    if let Some(d) = distro {
        argv.push("-d".to_string());
        argv.push(d.to_string());
    }
    argv.push("--".to_string());
    argv.push("bash".to_string());
    argv.push("-lic".to_string());
    argv.push(inner);
    argv
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_distro() {
        let argv = build_wsl_argv(None, "/home/virgile/dt/threadscrap");
        assert_eq!(
            argv,
            vec![
                "--".to_string(),
                "bash".to_string(),
                "-lic".to_string(),
                "cd '/home/virgile/dt/threadscrap' && exec claude".to_string(),
            ]
        );
    }

    #[test]
    fn with_distro() {
        let argv = build_wsl_argv(Some("Ubuntu"), "/a/b");
        assert_eq!(argv[0], "-d");
        assert_eq!(argv[1], "Ubuntu");
        assert_eq!(argv[2], "--");
        assert_eq!(argv.last().unwrap(), "cd '/a/b' && exec claude");
    }

    #[test]
    fn escapes_single_quote_in_path() {
        let argv = build_wsl_argv(None, "/a b/it's");
        assert_eq!(argv.last().unwrap(), "cd '/a b/it'\\''s' && exec claude");
    }
}
