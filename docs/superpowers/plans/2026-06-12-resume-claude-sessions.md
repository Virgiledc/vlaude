# Reprise automatique des conversations Claude — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Au redémarrage de Vlaude, chaque tuile rouvre sa conversation Claude (`--resume <uuid>`) au lieu d'une conversation vierge — y compris après un crash PC/WSL.

**Architecture:** Vlaude impose un UUID de conversation par tuile (`Session.claudeSessionId`, généré à la création, persisté dans `layout.json` déjà crash-safe). Le spawn `claude` devient un template shell idempotent : si le transcript `<uuid>.jsonl` existe sous `~/.claude/projects` → `exec claude --resume <uuid>`, sinon → `exec claude --session-id <uuid>`. L'UUID transite du store React jusqu'à `build_wsl_argv` via `pty_spawn`.

**Tech Stack:** Rust (Tauri 2, `cargo test`), TypeScript/React (zustand, vitest), zsh dans WSL.

**Spec:** `docs/superpowers/specs/2026-06-12-resume-claude-sessions-design.md`

**⚠️ Règles projet qui priment sur le template du plan :**
- **AUCUN `git commit`** : Virgile committe lui-même. Les étapes « commit » du format standard sont remplacées par des checkpoints (tests verts).
- **Aucun commentaire dans le code**, sauf mise à jour du doc-comment `///` existant de `build_wsl_argv` (règle de synchronisation des commentaires).
- Commandes one-shot depuis WSL (ignorer le warning UNC) :
  - Rust : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test'`
  - Vitest : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run'`
  - Typecheck : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit'`

---

### Task 1 : Rust — template conditionnel resume dans `build_wsl_argv` (TDD)

**Files:**
- Modify: `src-tauri/src/pty/wsl.rs` (fonction lignes 19-44, doc-comment lignes 14-18, tests lignes 46-102)
- Modify: `src-tauri/src/pty/manager.rs:27-46` (signature `spawn` + appel `build_wsl_argv`)
- Modify: `src-tauri/src/lib.rs:12-25` (commande `pty_spawn`)

- [ ] **Step 1 : Écrire les tests (nouveaux + signatures existantes mises à jour)**

Remplacer le module `mod tests` de `src-tauri/src/pty/wsl.rs` par :

```rust
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
    fn term_ignores_session_id() {
        let argv = build_wsl_argv(None, "/home/x", SessionKind::Term, &[], Some(UUID));
        assert_eq!(argv.last().unwrap(), "cd '/home/x' && exec zsh -i");
    }

    #[test]
    fn env_exports_precede_resume_conditional() {
        let env = vec![("VLAUDE_SQUAD_TOKEN".to_string(), "tok".to_string())];
        let argv = build_wsl_argv(None, "/r", SessionKind::Claude, &env, Some(UUID));
        let last = argv.last().unwrap();
        assert!(last.starts_with("cd '/r' && export VLAUDE_SQUAD_TOKEN='tok' && if [ -n "));
        assert!(last.ends_with("else exec claude --session-id '7f3a1c2e-0000-4000-8000-000000000000'; fi"));
    }
}
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test'`
Expected : **FAIL à la compilation** — `build_wsl_argv` prend 4 arguments, les tests en passent 5 (`this function takes 4 arguments but 5 arguments were supplied`).

- [ ] **Step 3 : Implémenter `build_wsl_argv` (+ doc-comment synchronisé)**

Remplacer le doc-comment et la fonction (lignes 14-44 actuelles) de `src-tauri/src/pty/wsl.rs` par :

```rust
/// Build the argument vector passed to `wsl.exe` to launch an interactive
/// `claude` REPL in `cwd`. `zsh -ic` loads the user's interactive env (nvm,
/// PATH) and `exec claude` makes closing the PTY kill claude. `env` pairs are
/// exported before the `exec` so an enrolled squad member carries its token
/// into claude's environment (and thus into the Bash sub-shells it spawns).
/// With a `claude_session_id`, the launch resumes that conversation when its
/// transcript exists and pins the uuid via `--session-id` otherwise; the
/// transcript is located by uuid filename because the cwd encoding under
/// `~/.claude/projects` is claude-internal.
pub fn build_wsl_argv(
    distro: Option<&str>,
    cwd: &str,
    kind: SessionKind,
    env: &[(String, String)],
    claude_session_id: Option<&str>,
) -> Vec<String> {
    let launch = match (kind, claude_session_id) {
        (SessionKind::Claude, Some(uuid)) => format!(
            "if [ -n \"$(find \"$HOME/.claude/projects\" -maxdepth 2 -name {jsonl} -print -quit 2>/dev/null)\" ]; then exec claude --resume {uuid_q}; else exec claude --session-id {uuid_q}; fi",
            jsonl = single_quote(&format!("{uuid}.jsonl")),
            uuid_q = single_quote(uuid),
        ),
        (SessionKind::Claude, None) => "exec claude".to_string(),
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
```

- [ ] **Step 4 : Propager la signature dans `manager.rs` et `lib.rs` (le crate doit compiler)**

`src-tauri/src/pty/manager.rs` — `spawn` (ligne 27) gagne le paramètre, et l'appel (ligne 44) le transmet :

```rust
    pub fn spawn(
        &self,
        id: String,
        distro: Option<String>,
        cwd: String,
        cols: u16,
        rows: u16,
        kind: SessionKind,
        env: Vec<(String, String)>,
        claude_session_id: Option<String>,
        on_data: Channel<Vec<u8>>,
    ) -> Result<(), String> {
```

```rust
        for arg in build_wsl_argv(distro.as_deref(), &cwd, kind, &env, claude_session_id.as_deref()) {
```

`src-tauri/src/lib.rs` — commande `pty_spawn` (lignes 12-25) :

```rust
#[tauri::command]
fn pty_spawn(
    state: State<PtyManager>,
    id: String,
    distro: Option<String>,
    cwd: String,
    cols: u16,
    rows: u16,
    kind: SessionKind,
    env: Option<Vec<(String, String)>>,
    claude_session_id: Option<String>,
    on_data: Channel<Vec<u8>>,
) -> Result<(), String> {
    state.spawn(id, distro, cwd, cols, rows, kind, env.unwrap_or_default(), claude_session_id, on_data)
}
```

- [ ] **Step 5 : Vérifier le vert**

Run : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test'`
Expected : **PASS** — les 8 tests de `pty::wsl::tests` (dont `claude_with_session_id_resumes_or_pins`, `term_ignores_session_id`, `env_exports_precede_resume_conditional`) + les tests `coalesce` existants.

**Checkpoint Task 1 :** `cargo test` vert. Pas de commit (feu vert Virgile requis).

---

### Task 2 : Store TS — `claudeSessionId` + `newUuid()` (TDD)

**Files:**
- Modify: `src/store/sessions.test.ts`
- Modify: `src/store/sessions.ts` (interface ligne 11, helper après ligne 66, `createSession` ligne 91, `hydrate` ligne 197)

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `src/store/sessions.test.ts` :

Remplacer la ligne 1 :
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
```

Remplacer la ligne 2 :
```ts
import { useSessions, type PersistedSnapshot, type Session } from "./sessions";
```

Ajouter en fin de fichier (après le `describe` existant) :

```ts
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("claudeSessionId", () => {
  beforeEach(reset);

  it("createSession assigns a valid v4 uuid", () => {
    useSessions.getState().createSession("/home/v/a");
    expect(useSessions.getState().sessions[0].claudeSessionId).toMatch(UUID_V4);
  });

  it("two sessions in the same cwd get distinct uuids", () => {
    const st = useSessions.getState();
    st.createSession("/home/v/a");
    st.createSession("/home/v/a");
    const [a, b] = useSessions.getState().sessions.map((s) => s.claudeSessionId);
    expect(a).not.toBe(b);
  });

  it("falls back to a valid v4 uuid without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      useSessions.getState().createSession("/home/v/a");
      expect(useSessions.getState().sessions[0].claudeSessionId).toMatch(UUID_V4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hydrate preserves an existing claudeSessionId", () => {
    useSessions.getState().createSession("/home/v/a");
    const snap = useSessions.getState().snapshot();
    const uuid = snap.sessions[0].claudeSessionId;
    expect(uuid).toMatch(UUID_V4);
    reset();
    useSessions.getState().hydrate(snap);
    expect(useSessions.getState().sessions[0].claudeSessionId).toBe(uuid);
  });

  it("hydrate generates a claudeSessionId for legacy snapshots", () => {
    useSessions.getState().createSession("/home/v/a");
    const snap = JSON.parse(JSON.stringify(useSessions.getState().snapshot())) as PersistedSnapshot;
    snap.sessions.forEach((s) => {
      delete (s as Partial<Session>).claudeSessionId;
    });
    reset();
    useSessions.getState().hydrate(snap);
    expect(useSessions.getState().sessions[0].claudeSessionId).toMatch(UUID_V4);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run src/store/sessions.test.ts'`
Expected : **FAIL** — les 5 tests `claudeSessionId` échouent (`expect(undefined).toMatch(...)` : le champ n'existe pas encore). Les tests existants restent verts.

- [ ] **Step 3 : Implémenter dans `sessions.ts`**

Interface `Session` (ligne 11) — ajouter le champ :

```ts
export interface Session {
  id: string;
  name: string;
  cwd: string;
  workspaceId: string;
  order: number;
  state: SessionState;
  openInCanvas: boolean;
  claudeSessionId: string;
}
```

Après `newId` (ligne 66), ajouter :

```ts
const newUuid = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const hex = "0123456789abcdef";
  let u = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) u += "-";
    else if (i === 14) u += "4";
    else if (i === 19) u += hex[8 + Math.floor(Math.random() * 4)];
    else u += hex[Math.floor(Math.random() * 16)];
  }
  return u;
};
```

Dans `createSession`, le littéral `Session` (lignes 91-99) devient :

```ts
      const session: Session = {
        id,
        name: name?.trim() || `session-${counter}`,
        cwd,
        workspaceId: wsId,
        order: maxOrder + 1,
        state: "working",
        openInCanvas: true,
        claudeSessionId: newUuid(),
      };
```

Dans `hydrate`, la ligne sessions (ligne 197) devient :

```ts
      sessions: snap.sessions.map((s) => ({
        ...s,
        state: "working" as SessionState,
        claudeSessionId: s.claudeSessionId ?? newUuid(),
      })),
```

- [ ] **Step 4 : Vérifier le vert**

Run : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run'`
Expected : **PASS** — tous les fichiers de tests (les 5 nouveaux inclus).

Run : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit'`
Expected : **PASS** (zéro erreur).

**Checkpoint Task 2 :** vitest + tsc verts. Pas de commit.

---

### Task 3 : Plomberie front → Rust (usePty, TerminalView, SessionTile)

Pas de nouveau test unitaire : c'est du câblage PTY, vérifié par observation (convention projet). Le filet : `tsc --noEmit` + tests existants.

**Files:**
- Modify: `src/terminal/usePty.ts:9-29`
- Modify: `src/terminal/TerminalView.tsx:13-19,24,77-80`
- Modify: `src/components/SessionTile.tsx:96`

- [ ] **Step 1 : `usePty.ts` — paramètre + arg d'invoke**

`createPty` (lignes 9-29) devient :

```ts
export function createPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
  kind: "claude" | "term" = "claude",
  env?: Record<string, string>,
  claudeSessionId?: string
): PtyHandle {
  const channel = new Channel<Uint8Array | number[]>();
  channel.onmessage = (msg) => {
    onData(msg instanceof Uint8Array ? msg : new Uint8Array(msg));
  };

  invoke("pty_spawn", {
    id, distro: null, cwd, cols, rows, kind,
    env: env ? Object.entries(env) : null,
    claudeSessionId: claudeSessionId ?? null,
    onData: channel,
  }).catch(
    (e) => console.error("pty_spawn failed", e)
  );
```

(Le reste de la fonction — `write`/`resize`/`close` — inchangé. Tauri 2 convertit `claudeSessionId` → `claude_session_id` comme il le fait déjà pour `onData` → `on_data`.)

- [ ] **Step 2 : `TerminalView.tsx` — prop + passage à `createPty`**

Interface `Props` (lignes 13-19) :

```ts
interface Props {
  id: string;
  cwd: string;
  kind?: "claude" | "term";
  claudeSessionId?: string;
  visible: boolean;
  fullscreen: boolean;
}
```

Signature du composant (ligne 24) :

```ts
export function TerminalView({ id, cwd, kind = "claude", claudeSessionId, visible, fullscreen }: Props) {
```

Appel `createPty` (lignes 77-80) :

```ts
    const pty = createPty(id, cwd, term.cols, term.rows, (bytes) => {
      term.write(bytes);
      if (scan) scan(bytes);
    }, kind, env, claudeSessionId);
```

Ne pas toucher au tableau de deps de l'effet (`[id, cwd, kind]`) : `claudeSessionId` est immuable pour la vie d'une session.

- [ ] **Step 3 : `SessionTile.tsx` — passer l'UUID au TerminalView claude uniquement**

Ligne 96 :

```tsx
          <TerminalView id={session.id} cwd={session.cwd} kind="claude" claudeSessionId={session.claudeSessionId} visible={session.openInCanvas && view === "claude"} fullscreen={fullscreen} />
```

Le `TerminalView` du shell (`id={`${session.id}:term`}`, ligne 100) reste **sans** `claudeSessionId`.

- [ ] **Step 4 : Vérifier le vert**

Run : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit'`
Expected : **PASS**.

Run : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run'`
Expected : **PASS** (aucune régression).

**Checkpoint Task 3 :** tsc + vitest verts. Pas de commit.

---

### Task 4 : Vérification finale (Definition of Done — observation live)

- [ ] **Step 1 : Suite complète au vert**

Run (les trois) :
- `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test'` → PASS
- `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run'` → PASS
- `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit'` → PASS

- [ ] **Step 2 : Vérification live (Virgile lance `npm run tauri dev` côté Windows — GUI longue durée)**

Checklist d'observation (spec §5.3) :
1. Créer une tuile → envoyer « réponds pong quand je dis ping » à claude → fermer Vlaude → rouvrir → la tuile affiche **la même conversation** (taper « ping » → claude se souvient).
2. Simulation crash : tuile avec conversation → `wsl --shutdown` (ou tuer `wsl.exe`) → rouvrir Vlaude → conversation reprise.
3. Deux tuiles sur le **même dossier**, conversations distinctes → restart → chacune retrouve **la sienne**.
4. Tuile neuve jamais utilisée → restart → claude démarre normalement (branche `--session-id`, pas d'erreur `No conversation found`).
5. Confirmer en interactif que l'ID reste stable après resume : refaire le restart du point 1 une **2ᵉ fois** → la conversation est toujours là (hypothèse §2 de la spec validée en interactif).

- [ ] **Step 3 : Constat & clôture**

Si les 5 points sont constatés : feature **done**. Annoncer à Virgile que c'est prêt pour commit (lui seul committe). Si un point échoue : STOP, retour en mode debug (superpowers:systematic-debugging), ne pas masquer.
