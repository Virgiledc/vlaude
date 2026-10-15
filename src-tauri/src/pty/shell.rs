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
    Codex,
    Omp,
    Term,
}

/// Build the argument vector passed to `bash` to launch an interactive
/// `claude` REPL in `cwd`. `bash -ic` loads the user's interactive env
/// (`~/.bashrc`: Omarchy PATH, mise) and `exec claude` makes closing the PTY
/// kill claude. `env` pairs are exported before the `exec` so an enrolled
/// squad member carries its token into claude's environment (and thus into
/// the Bash sub-shells it spawns).
/// With a `claude_session_id`, the launch resumes that conversation when its
/// transcript exists and pins the uuid via `--session-id` otherwise; the
/// transcript is located by uuid filename because the cwd encoding under
/// `~/.claude/projects` is claude-internal. If the pin exits nonzero within
/// 30s the launch retries with `--resume`.
/// `Claudex` launches the `claudex` wrapper (Claude Code → GPT via
/// CLIProxyAPI) with exactly the same resume/session-id scheme.
/// `Codex` execs the OpenAI `codex` TUI fresh every time: codex cannot pin a
/// session uuid at launch, so the resume scheme does not apply. It always
/// starts in codex's "Full Access" preset (no sandbox, never ask approval).
/// `tui.fullscreen_transcript=false` stops codex capturing the mouse, so xterm
/// owns selection: codex's own copy puts Markdown (backticks) in the clipboard.
/// `Omp` execs the `omp` TUI fresh every time for the same reason: omp only
/// offers `--resume <id-prefix>` on ids it generated itself, never a pinned id.
pub fn build_shell_argv(
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
            "if [ -n \"$(find \"$HOME/.claude/projects\" -maxdepth 2 -name {jsonl} -print -quit 2>/dev/null)\" ]; then exec {bin} --resume {uuid_q}; else t0=$SECONDS; {bin} --session-id {uuid_q}; rc=$?; if [ $rc -ne 0 ] && [ $((SECONDS-t0)) -lt 30 ]; then exec {bin} --resume {uuid_q}; fi; exit $rc; fi",
            jsonl = single_quote(&format!("{uuid}.jsonl")),
            uuid_q = single_quote(uuid),
        ),
        (SessionKind::Claude | SessionKind::Claudex, None) => format!("exec {bin}"),
        (SessionKind::Codex, _) => {
            "exec codex --sandbox danger-full-access --ask-for-approval never -c tui.fullscreen_transcript=false".to_string()
        }
        (SessionKind::Omp, _) => "exec omp".to_string(),
        (SessionKind::Term, _) => "exec bash -i".to_string(),
    };
    let exports: String = env
        .iter()
        .map(|(k, v)| format!("export {}={} && ", k, single_quote(v)))
        .collect();
    let inner = format!("cd {} && {}{}", single_quote(cwd), exports, launch);
    vec!["-ic".to_string(), inner]
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "7f3a1c2e-0000-4000-8000-000000000000";

    #[test]
    fn claude_without_session_id() {
        let argv = build_shell_argv("/home/virgile/dt/threadscrap", SessionKind::Claude, &[], None);
        assert_eq!(
            argv,
            vec![
                "-ic".to_string(),
                "cd '/home/virgile/dt/threadscrap' && exec claude".to_string(),
            ]
        );
    }

    #[test]
    fn escapes_single_quote_in_path() {
        let argv = build_shell_argv("/a b/it's", SessionKind::Claude, &[], None);
        assert_eq!(argv.last().unwrap(), "cd '/a b/it'\\''s' && exec claude");
    }

    #[test]
    fn escapes_single_quote_in_session_id() {
        let argv = build_shell_argv("/r", SessionKind::Claude, &[], Some("it's"));
        assert_eq!(
            argv.last().unwrap(),
            r#"cd '/r' && if [ -n "$(find "$HOME/.claude/projects" -maxdepth 2 -name 'it'\''s.jsonl' -print -quit 2>/dev/null)" ]; then exec claude --resume 'it'\''s'; else t0=$SECONDS; claude --session-id 'it'\''s'; rc=$?; if [ $rc -ne 0 ] && [ $((SECONDS-t0)) -lt 30 ]; then exec claude --resume 'it'\''s'; fi; exit $rc; fi"#
        );
    }

    #[test]
    fn term_kind_runs_interactive_bash() {
        let argv = build_shell_argv("/home/x", SessionKind::Term, &[], None);
        assert_eq!(
            argv,
            vec!["-ic".to_string(), "cd '/home/x' && exec bash -i".to_string()]
        );
    }

    #[test]
    fn injects_env_exports_before_exec() {
        let env = vec![("VLAUDE_SQUAD_TOKEN".to_string(), "ab'c".to_string())];
        let argv = build_shell_argv("/r", SessionKind::Claude, &env, None);
        assert_eq!(
            argv.last().unwrap(),
            "cd '/r' && export VLAUDE_SQUAD_TOKEN='ab'\\''c' && exec claude"
        );
    }

    #[test]
    fn claude_with_session_id_resumes_or_pins() {
        let argv = build_shell_argv("/r", SessionKind::Claude, &[], Some(UUID));
        assert_eq!(
            argv.last().unwrap(),
            r#"cd '/r' && if [ -n "$(find "$HOME/.claude/projects" -maxdepth 2 -name '7f3a1c2e-0000-4000-8000-000000000000.jsonl' -print -quit 2>/dev/null)" ]; then exec claude --resume '7f3a1c2e-0000-4000-8000-000000000000'; else t0=$SECONDS; claude --session-id '7f3a1c2e-0000-4000-8000-000000000000'; rc=$?; if [ $rc -ne 0 ] && [ $((SECONDS-t0)) -lt 30 ]; then exec claude --resume '7f3a1c2e-0000-4000-8000-000000000000'; fi; exit $rc; fi"#
        );
    }

    #[test]
    fn claudex_kind_execs_claudex() {
        let argv = build_shell_argv("/home/x", SessionKind::Claudex, &[], None);
        assert_eq!(argv.last().unwrap(), "cd '/home/x' && exec claudex");
    }

    #[test]
    fn claudex_with_session_id_resumes_or_pins() {
        let argv = build_shell_argv("/r", SessionKind::Claudex, &[], Some(UUID));
        assert_eq!(
            argv.last().unwrap(),
            r#"cd '/r' && if [ -n "$(find "$HOME/.claude/projects" -maxdepth 2 -name '7f3a1c2e-0000-4000-8000-000000000000.jsonl' -print -quit 2>/dev/null)" ]; then exec claudex --resume '7f3a1c2e-0000-4000-8000-000000000000'; else t0=$SECONDS; claudex --session-id '7f3a1c2e-0000-4000-8000-000000000000'; rc=$?; if [ $rc -ne 0 ] && [ $((SECONDS-t0)) -lt 30 ]; then exec claudex --resume '7f3a1c2e-0000-4000-8000-000000000000'; fi; exit $rc; fi"#
        );
    }

    #[test]
    fn codex_kind_execs_codex_and_ignores_session_id() {
        let expected = "cd '/home/x' && exec codex --sandbox danger-full-access --ask-for-approval never -c tui.fullscreen_transcript=false";
        let argv = build_shell_argv("/home/x", SessionKind::Codex, &[], None);
        assert_eq!(argv.last().unwrap(), expected);
        let argv = build_shell_argv("/home/x", SessionKind::Codex, &[], Some(UUID));
        assert_eq!(argv.last().unwrap(), expected);
    }

    #[test]
    fn omp_kind_execs_omp_and_ignores_session_id() {
        let argv = build_shell_argv("/home/x", SessionKind::Omp, &[], None);
        assert_eq!(argv.last().unwrap(), "cd '/home/x' && exec omp");
        let argv = build_shell_argv("/home/x", SessionKind::Omp, &[], Some(UUID));
        assert_eq!(argv.last().unwrap(), "cd '/home/x' && exec omp");
    }

    #[test]
    fn term_ignores_session_id() {
        let argv = build_shell_argv("/home/x", SessionKind::Term, &[], Some(UUID));
        assert_eq!(argv.last().unwrap(), "cd '/home/x' && exec bash -i");
    }

    #[test]
    fn env_exports_precede_resume_conditional() {
        let env = vec![("VLAUDE_SQUAD_TOKEN".to_string(), "tok".to_string())];
        let argv = build_shell_argv("/r", SessionKind::Claude, &env, Some(UUID));
        assert_eq!(
            argv.last().unwrap(),
            r#"cd '/r' && export VLAUDE_SQUAD_TOKEN='tok' && if [ -n "$(find "$HOME/.claude/projects" -maxdepth 2 -name '7f3a1c2e-0000-4000-8000-000000000000.jsonl' -print -quit 2>/dev/null)" ]; then exec claude --resume '7f3a1c2e-0000-4000-8000-000000000000'; else t0=$SECONDS; claude --session-id '7f3a1c2e-0000-4000-8000-000000000000'; rc=$?; if [ $rc -ne 0 ] && [ $((SECONDS-t0)) -lt 30 ]; then exec claude --resume '7f3a1c2e-0000-4000-8000-000000000000'; fi; exit $rc; fi"#
        );
    }
}
