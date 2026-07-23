/// POSIX single-quote escaping: ' -> '\''
pub(crate) fn single_quote(s: &str) -> String {
    let escaped = s.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Claude,
    Claudex,
    Term,
}

/// Build the argument vector passed to `wsl.exe` to launch an interactive
/// `claude` REPL in `cwd`. `zsh -ic` loads the user's interactive env (nvm,
/// PATH) and `exec claude` makes closing the PTY kill claude. `env` pairs are
/// exported before the `exec` so an enrolled squad member carries its token
/// into claude's environment (and thus into the Bash sub-shells it spawns).
/// With a `claude_session_id`, the launch resumes that conversation when its
/// transcript exists and pins the uuid via `--session-id` otherwise; the
/// transcript is located by uuid filename because the cwd encoding under
/// `~/.claude/projects` is claude-internal. `Claudex` launches the `claudex`
/// wrapper (Claude Code → GPT via CLIProxyAPI) with exactly the same
/// resume/session-id scheme.
pub fn build_wsl_argv(
    distro: Option<&str>,
    cwd: &str,
    kind: SessionKind,
    env: &[(String, String)],
    claude_session_id: Option<&str>,
) -> Vec<String> {
    let bin = match kind {
        SessionKind::Claudex => "claudex",
        _ => "claude",
    };
    let launch = match (kind, claude_session_id) {
        (SessionKind::Claude | SessionKind::Claudex, Some(uuid)) => format!(
            "if [ -n \"$(find \"$HOME/.claude/projects\" -maxdepth 2 -name {jsonl} -print -quit 2>/dev/null)\" ]; then exec {bin} --resume {uuid_q}; else exec {bin} --session-id {uuid_q}; fi",
            jsonl = single_quote(&format!("{uuid}.jsonl")),
            uuid_q = single_quote(uuid),
        ),
        (SessionKind::Claude | SessionKind::Claudex, None) => format!("exec {bin}"),
        (SessionKind::Term, _) => "exec zsh -i".to_string(),
    };
    let exports: String = env
        .iter()
        .map(|(k, v)| format!("export {}={} && ", k, single_quote(v)))
        .collect();
    let inner = format!("cd {} && {}{}", single_quote(cwd), exports, launch);
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

    const UUID: &str = "7f3a1c2e-0000-4000-8000-000000000000";

    #[test]
    fn no_distro() {
        let argv = build_wsl_argv(None, "/home/virgile/dt/threadscrap", SessionKind::Claude, &[], None);
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
        let argv = build_wsl_argv(Some("Ubuntu"), "/a/b", SessionKind::Claude, &[], None);
        assert_eq!(argv[0], "-d");
        assert_eq!(argv[1], "Ubuntu");
        assert_eq!(argv[2], "--");
        assert_eq!(argv.last().unwrap(), "cd '/a/b' && exec claude");
    }

    #[test]
    fn escapes_single_quote_in_path() {
        let argv = build_wsl_argv(None, "/a b/it's", SessionKind::Claude, &[], None);
        assert_eq!(argv.last().unwrap(), "cd '/a b/it'\\''s' && exec claude");
    }

    #[test]
    fn escapes_single_quote_in_session_id() {
        let argv = build_wsl_argv(None, "/r", SessionKind::Claude, &[], Some("it's"));
        assert_eq!(
            argv.last().unwrap(),
            r#"cd '/r' && if [ -n "$(find "$HOME/.claude/projects" -maxdepth 2 -name 'it'\''s.jsonl' -print -quit 2>/dev/null)" ]; then exec claude --resume 'it'\''s'; else exec claude --session-id 'it'\''s'; fi"#
        );
    }

    #[test]
    fn term_kind_runs_interactive_zsh() {
        let argv = build_wsl_argv(None, "/home/x", SessionKind::Term, &[], None);
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

    #[test]
    fn injects_env_exports_before_exec() {
        let env = vec![("VLAUDE_SQUAD_TOKEN".to_string(), "ab'c".to_string())];
        let argv = build_wsl_argv(None, "/r", SessionKind::Claude, &env, None);
        assert_eq!(
            argv.last().unwrap(),
            "cd '/r' && export VLAUDE_SQUAD_TOKEN='ab'\\''c' && exec claude"
        );
    }

    #[test]
    fn claude_with_session_id_resumes_or_pins() {
        let argv = build_wsl_argv(None, "/r", SessionKind::Claude, &[], Some(UUID));
        assert_eq!(
            argv.last().unwrap(),
            r#"cd '/r' && if [ -n "$(find "$HOME/.claude/projects" -maxdepth 2 -name '7f3a1c2e-0000-4000-8000-000000000000.jsonl' -print -quit 2>/dev/null)" ]; then exec claude --resume '7f3a1c2e-0000-4000-8000-000000000000'; else exec claude --session-id '7f3a1c2e-0000-4000-8000-000000000000'; fi"#
        );
    }

    #[test]
    fn claudex_kind_execs_claudex() {
        let argv = build_wsl_argv(None, "/home/x", SessionKind::Claudex, &[], None);
        assert_eq!(
            argv.last().unwrap(),
            "cd '/home/x' && exec claudex"
        );
    }

    #[test]
    fn claudex_with_session_id_resumes_or_pins() {
        let argv = build_wsl_argv(None, "/r", SessionKind::Claudex, &[], Some(UUID));
        assert_eq!(
            argv.last().unwrap(),
            r#"cd '/r' && if [ -n "$(find "$HOME/.claude/projects" -maxdepth 2 -name '7f3a1c2e-0000-4000-8000-000000000000.jsonl' -print -quit 2>/dev/null)" ]; then exec claudex --resume '7f3a1c2e-0000-4000-8000-000000000000'; else exec claudex --session-id '7f3a1c2e-0000-4000-8000-000000000000'; fi"#
        );
    }

    #[test]
    fn term_ignores_session_id() {
        let argv = build_wsl_argv(None, "/home/x", SessionKind::Term, &[], Some(UUID));
        assert_eq!(argv.last().unwrap(), "cd '/home/x' && exec zsh -i");
    }

    #[test]
    fn env_exports_precede_resume_conditional() {
        let env = vec![("VLAUDE_SQUAD_TOKEN".to_string(), "tok".to_string())];
        let argv = build_wsl_argv(None, "/r", SessionKind::Claude, &env, Some(UUID));
        assert_eq!(
            argv.last().unwrap(),
            r#"cd '/r' && export VLAUDE_SQUAD_TOKEN='tok' && if [ -n "$(find "$HOME/.claude/projects" -maxdepth 2 -name '7f3a1c2e-0000-4000-8000-000000000000.jsonl' -print -quit 2>/dev/null)" ]; then exec claude --resume '7f3a1c2e-0000-4000-8000-000000000000'; else exec claude --session-id '7f3a1c2e-0000-4000-8000-000000000000'; fi"#
        );
    }
}
