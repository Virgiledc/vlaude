# Sessions claudex — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ouvrir dans Vlaude des sessions « claudex » (CLI `claude` branché sur gpt-5.6-sol via CLIProxyAPI), choisies par session, badgées, et resumées avec le bon type.

**Architecture:** Un script wrapper exécutable `~/.local/bin/claudex` (hors repo) porte toute la config proxy et `exec claude`. Côté Vlaude, `SessionKind` gagne `Claudex` (le launch Rust ne change que le nom du binaire), le store persiste `kind` par session, le dialog gagne un toggle et les tuiles/sidebar un badge « GPT ».

**Tech Stack:** Rust (Tauri 2, `src-tauri`), React 19 + TypeScript (Vite), zustand, vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-07-20-claudex-sessions-design.md`

## Global Constraints

- **Aucun commentaire dans le code** (ni `//`, ni docstrings, ni JSDoc). Exception : les doc-comments Rust `///` existants de `wsl.rs` peuvent être mis à jour s'ils deviennent faux.
- **JAMAIS de `git commit`** : Virgile committe lui-même. Les étapes « commit » classiques sont remplacées par un checkpoint (récap + attendre).
- **Commandes one-shot depuis WSL** (le repo est sur C:) :
  - Typecheck : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit'`
  - Tests front : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run'`
  - Tests Rust : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test'`
  - Ignorer le warning UNC de cmd.exe.
- **Modifs chirurgicales** : ne toucher que ce que le plan liste.
- Squads : restent `claude` (hors périmètre). Ne pas toucher `squad.ts`, `SquadPanel`, ni la branche squad d'`App.tsx`.
- Avant les Tasks 5 et 6 (UI), **invoquer le skill `frontend-design`** (obligatoire projet).

---

### Task 1: Script wrapper `~/.local/bin/claudex` (hors repo)

**Files:**
- Create: `/home/virgile/.local/bin/claudex` (WSL, hors repo Vlaude)
- Modify: `/home/virgile/.zshrc` (supprimer la fonction `claudex()`, lignes ~139-150)

**Interfaces:**
- Produces: un exécutable `claudex` dans le PATH, même contrat CLI que `claude` (accepte `--system-prompt-file`, `--resume`, `--session-id`, …). C'est lui que le Rust (Task 2) exec-era.

- [ ] **Step 1: Créer le script**

```bash
cat > ~/.local/bin/claudex << 'EOF'
#!/usr/bin/env bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8317"
export ANTHROPIC_AUTH_TOKEN="$(< ~/.cli-proxy-api/local.key)"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="gpt-5.6-sol"
export CLAUDE_CODE_SUBAGENT_MODEL="gpt-5.6-sol"
export CLAUDE_CODE_MAX_CONTEXT_TOKENS=372000
export CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1
export CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=3
export ENABLE_TOOL_SEARCH=false
exec claude --model gpt-5.6-sol "$@"
EOF
chmod +x ~/.local/bin/claudex
```

(Le script est en bash mais lancé par zsh via exec : aucun impact. `exec claude` remplace le process → fermer la tuile tue claude, comme pour les sessions claude.)

- [ ] **Step 2: Supprimer la fonction zsh**

Dans `~/.zshrc`, supprimer le bloc entier (commentaire inclus) :

```
# claudex : Claude Code via CLIProxyAPI (modèles Codex/GPT), scope limité à l'invocation
claudex() {
  ANTHROPIC_BASE_URL="http://127.0.0.1:8317" \
  ...
  claude --model gpt-5.6-sol "$@"
}
```

- [ ] **Step 3: Vérifier**

Run: `zsh -ic 'type claudex'`
Expected: `claudex is /home/virgile/.local/bin/claudex` (plus « shell function »)

Run: `zsh -ic 'claudex --version'`
Expected: une version `x.y.z (Claude Code)` s'affiche (pas d'erreur « command not found »)

- [ ] **Step 4: Checkpoint** — récap 3 lignes, pas de commit (rien dans le repo de toute façon).

---

### Task 2: Rust — `SessionKind::Claudex` dans `wsl.rs`

**Files:**
- Modify: `src-tauri/src/pty/wsl.rs` (enum ligne 7-12, match ligne 33-41, doc-comment 14-24, tests)

**Interfaces:**
- Consumes: le binaire `claudex` du PATH (Task 1).
- Produces: `SessionKind::Claudex` (serde `"claudex"`) accepté par `pty_spawn` (le param `kind: SessionKind` de `lib.rs` désérialise la string envoyée par le front — aucun changement dans `lib.rs`).

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter dans `mod tests` de `wsl.rs` :

```rust
#[test]
fn claudex_kind_execs_claudex() {
    let argv = build_wsl_argv(None, "/home/x", SessionKind::Claudex, &[], None);
    assert_eq!(
        argv.last().unwrap(),
        "cd '/home/x' && exec claudex --system-prompt-file \"$HOME/dt/c.md\""
    );
}

#[test]
fn claudex_with_session_id_resumes_or_pins() {
    let argv = build_wsl_argv(None, "/r", SessionKind::Claudex, &[], Some(UUID));
    assert_eq!(
        argv.last().unwrap(),
        r#"cd '/r' && if [ -n "$(find "$HOME/.claude/projects" -maxdepth 2 -name '7f3a1c2e-0000-4000-8000-000000000000.jsonl' -print -quit 2>/dev/null)" ]; then exec claudex --system-prompt-file "$HOME/dt/c.md" --resume '7f3a1c2e-0000-4000-8000-000000000000'; else exec claudex --system-prompt-file "$HOME/dt/c.md" --session-id '7f3a1c2e-0000-4000-8000-000000000000'; fi"#
    );
}
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test'`
Expected: erreur de compilation `no variant named 'Claudex'`

- [ ] **Step 3: Implémenter**

Enum :

```rust
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Claude,
    Claudex,
    Term,
}
```

Match de `build_wsl_argv` (remplace le match existant ; `bin` est le seul delta entre claude et claudex) :

```rust
    let sp = r#"--system-prompt-file "$HOME/dt/c.md""#;
    let bin = match kind {
        SessionKind::Claudex => "claudex",
        _ => "claude",
    };
    let launch = match (kind, claude_session_id) {
        (SessionKind::Claude | SessionKind::Claudex, Some(uuid)) => format!(
            "if [ -n \"$(find \"$HOME/.claude/projects\" -maxdepth 2 -name {jsonl} -print -quit 2>/dev/null)\" ]; then exec {bin} {sp} --resume {uuid_q}; else exec {bin} {sp} --session-id {uuid_q}; fi",
            jsonl = single_quote(&format!("{uuid}.jsonl")),
            uuid_q = single_quote(uuid),
        ),
        (SessionKind::Claude | SessionKind::Claudex, None) => format!("exec {bin} {sp}"),
        (SessionKind::Term, _) => "exec zsh -i".to_string(),
    };
```

Mettre à jour le doc-comment `///` de `build_wsl_argv` : mentionner que `Claudex` lance le wrapper `claudex` (Claude Code → GPT via CLIProxyAPI) avec exactement le même schéma resume/session-id.

- [ ] **Step 4: Vérifier le vert**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test'`
Expected: tous les tests passent (les 9 existants + 2 nouveaux)

- [ ] **Step 5: Checkpoint** — récap, pas de commit.

---

### Task 3: Store — `Session.kind` persisté

**Files:**
- Modify: `src/store/sessions.ts`
- Test: `src/store/sessions.test.ts`

**Interfaces:**
- Produces: `export type SessionLaunchKind = "claude" | "claudex"` ; `Session.kind: SessionLaunchKind` ; `createSession(cwd: string, name?: string, kind?: SessionLaunchKind): string` (défaut `"claude"`). `hydrate` retombe sur `"claude"` pour les snapshots antérieurs sans `kind`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter dans `src/store/sessions.test.ts` (suivre le style des tests existants, qui resettent le store entre les cas) :

```ts
it("createSession defaults kind to claude", () => {
  const id = useSessions.getState().createSession("/home/v/a");
  expect(useSessions.getState().sessions.find((s) => s.id === id)!.kind).toBe("claude");
});

it("createSession with claudex kind persists it through snapshot/hydrate", () => {
  const id = useSessions.getState().createSession("/home/v/a", undefined, "claudex");
  const snap = useSessions.getState().snapshot();
  useSessions.getState().hydrate(snap);
  expect(useSessions.getState().sessions.find((s) => s.id === id)!.kind).toBe("claudex");
});

it("hydrate falls back to claude for sessions without kind", () => {
  useSessions.getState().createSession("/home/v/a");
  const snap = useSessions.getState().snapshot();
  const legacy = { ...snap, sessions: snap.sessions.map(({ kind: _k, ...rest }) => rest) } as never;
  useSessions.getState().hydrate(legacy);
  expect(useSessions.getState().sessions[0].kind).toBe("claude");
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run src/store/sessions.test.ts'`
Expected: FAIL (`kind` n'existe pas sur `Session`)

- [ ] **Step 3: Implémenter**

Dans `src/store/sessions.ts` :

```ts
export type SessionLaunchKind = "claude" | "claudex";
```

`Session` gagne `kind: SessionLaunchKind;` (après `claudeSessionId`).

Signature dans `AppState` :

```ts
createSession: (cwd: string, name?: string, kind?: SessionLaunchKind) => string;
```

Implémentation :

```ts
createSession: (cwd, name, kind) => {
```

et dans l'objet `session` créé : `kind: kind ?? "claude",`.

Dans `hydrate`, le map des sessions devient :

```ts
sessions: snap.sessions.map((s) => ({
  ...s,
  state: "working" as SessionState,
  claudeSessionId: s.claudeSessionId ?? newUuid(),
  kind: s.kind ?? "claude",
})),
```

- [ ] **Step 4: Vérifier le vert**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run'`
Expected: toute la suite passe

- [ ] **Step 5: Checkpoint** — récap, pas de commit.

---

### Task 4: Plomberie front → Rust (types + passage du kind)

**Files:**
- Modify: `src/terminal/usePty.ts:15` (type du param `kind`)
- Modify: `src/terminal/TerminalView.tsx:17` (Props), `:78` (gate reload)
- Modify: `src/components/SessionTile.tsx:106` (passer `session.kind`)

**Interfaces:**
- Consumes: `Session.kind` (Task 3), `SessionKind::Claudex` côté Rust (Task 2 — la string `"claudex"` part telle quelle dans `pty_spawn`).
- Produces: une tuile dont la couche claude spawn `claudex` quand `session.kind === "claudex"`.

- [ ] **Step 1: Élargir les types et brancher**

`src/terminal/usePty.ts` ligne 15 :

```ts
  kind: "claude" | "claudex" | "term" = "claude",
```

`src/terminal/TerminalView.tsx` ligne 17 :

```ts
  kind?: "claude" | "claudex" | "term";
```

Ligne 78 — le gate reload/clear doit couvrir claudex (le bouton /clear existe sur toutes les tuiles) :

```ts
    } else if (kind !== "term" && useReload.getState().isClearing(id)) {
```

Ne PAS toucher la ligne 72 (`kind === "claude" && squad.injection[id]`) : l'injection est squad-only et les squads restent claude. Ne pas toucher la ligne 38 (`ignoreBracketedPasteMode: kind === "term"`) : déjà correcte pour claudex.

`src/components/SessionTile.tsx` ligne 106, la couche claude passe le kind de la session :

```tsx
<TerminalView id={session.id} cwd={session.cwd} kind={session.kind} claudeSessionId={session.claudeSessionId} visible={session.openInCanvas && view === "claude"} fullscreen={fullscreen} />
```

(La couche term ligne ~110 reste `kind="term"`.)

- [ ] **Step 2: Vérifier**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit'`
Expected: 0 erreur

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run'`
Expected: vert

- [ ] **Step 3: Checkpoint** — récap, pas de commit.

---

### Task 5: Toggle claude / claudex dans `NewSessionDialog`

**Pré-requis : invoquer le skill `frontend-design` avant de coder.**

**Files:**
- Modify: `src/components/NewSessionDialog.tsx`
- Modify: `src/components/NewSessionDialog.css`
- Modify: `src/App.tsx:66` (propager le kind)

**Interfaces:**
- Consumes: `SessionLaunchKind` et `createSession(cwd, name?, kind?)` (Task 3).
- Produces: `onCreate: (cwd: string, name?: string, kind?: SessionLaunchKind) => void` — `kind` envoyé uniquement en mode `"session"` (les squads n'en reçoivent pas).

- [ ] **Step 1: Implémenter le toggle**

`NewSessionDialog.tsx` :

```ts
import type { SessionLaunchKind } from "../store/sessions";
```

Props :

```ts
  onCreate: (cwd: string, name?: string, kind?: SessionLaunchKind) => void;
```

State (réinitialisé à l'ouverture, dans le `useEffect` existant sur `open` : `setKind("claude")`) :

```ts
const [kind, setKind] = useState<SessionLaunchKind>("claude");
```

`submit` passe le kind (uniquement utile en mode session, inoffensif sinon) :

```ts
onCreate(trimmed, name.trim() || undefined, kind);
```

UI — sous le champ « Nom (optionnel) », seulement en mode session :

```tsx
{mode === "session" && (
  <>
    <label>Agent</label>
    <div className="vl-kind-toggle" role="radiogroup">
      <button
        type="button"
        className={kind === "claude" ? "active" : ""}
        onClick={() => setKind("claude")}
      >claude</button>
      <button
        type="button"
        className={kind === "claudex" ? "active" : ""}
        onClick={() => setKind("claudex")}
      >claudex · GPT</button>
    </div>
  </>
)}
```

(Style exact du toggle : à caler avec le skill `frontend-design` sur les conventions du fichier CSS existant — même famille visuelle que `.vl-chip`/`.vl-input`, état `.active` net, pas de redesign du modal.)

`NewSessionDialog.css` — base à adapter :

```css
.vl-kind-toggle { display: flex; gap: 6px; }
.vl-kind-toggle button { flex: 1; }
.vl-kind-toggle button.active { /* accent visible, cf. conventions du fichier */ }
```

- [ ] **Step 2: Propager dans App.tsx**

Ligne 66 :

```tsx
onCreate={(cwd, name, kind) => { if (dialogMode === "squad") createSquad(cwd, name); else createSession(cwd, name, kind); }}
```

- [ ] **Step 3: Vérifier**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit'`
Expected: 0 erreur

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run'`
Expected: vert

- [ ] **Step 4: Checkpoint** — récap, pas de commit.

---

### Task 6: Badge « GPT » (tuile + sidebar)

**Pré-requis : skill `frontend-design` (déjà chargé en Task 5 si même session).**

**Files:**
- Modify: `src/components/SessionTile.tsx` (barre de titre, après `vl-tile-name`)
- Modify: `src/components/SessionTile.css`
- Modify: `src/components/Sidebar.tsx` (row, après `vl-side-name`)
- Modify: `src/components/Sidebar.css`

**Interfaces:**
- Consumes: `session.kind` / `s.kind` (Task 3).

- [ ] **Step 1: SessionTile**

Après `<span className="vl-tile-name">{session.name}</span>` (ligne ~71) :

```tsx
{session.kind === "claudex" && <span className="vl-badge-gpt">GPT</span>}
```

- [ ] **Step 2: Sidebar**

Après `<span className="vl-side-name">{s.name}</span>` (ligne 33) :

```tsx
{s.kind === "claudex" && <span className="vl-badge-gpt">GPT</span>}
```

- [ ] **Step 3: CSS (dans les deux fichiers, même classe)**

Base à adapter aux tokens existants (discret : uppercase minuscule, pas de couleur criarde) :

```css
.vl-badge-gpt {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 1px 4px;
  border-radius: 3px;
  opacity: 0.75;
  border: 1px solid currentColor;
}
```

- [ ] **Step 4: Vérifier**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit'`
Expected: 0 erreur

- [ ] **Step 5: Checkpoint** — récap, pas de commit.

---

### Task 7: Vérification finale

- [ ] **Step 1: Suites complètes**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit && npx vitest run'`
Expected: 0 erreur / suite verte

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test'`
Expected: vert

- [ ] **Step 2: Checklist live (Virgile, `npm run tauri dev` côté Windows)**

1. Nouvelle session **claudex** → REPL répond, modèle gpt-5.6-sol confirmé (`/status` ou statusline).
2. Fermer/rouvrir Vlaude → la session claudex resume **en claudex** (badge GPT présent, même conversation).
3. Une session **claude** classique à côté fonctionne toujours (non-régression).
4. Badge GPT visible sur la tuile ET la sidebar, absent des sessions claude.
5. Terminal zsh hors Vlaude : `claudex` fonctionne toujours (script).

Rien n'est « fait » sans cette checklist. Si un point échoue → systematic-debugging, pas de rustine.
