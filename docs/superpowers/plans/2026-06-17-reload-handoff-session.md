# Bouton « reload » (handoff → session vierge) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un bouton sur la tuile qui fait écrire à claude un handoff de reprise + ses notes vault, repart sur une session claude vierge, et y pré-remplit le handoff sans l'envoyer.

**Architecture:** Logique pure testable (`reload.ts` : chemins, prompt, transitions `planReload`) consommée par un store zustand `useReload` qui orchestre l'I/O (injection du prompt, poll du fichier sentinelle via une commande Rust `wsl_read_file`, respawn de la session, paste du handoff au `READY_MARKER`). Calqué sur le couple `injection.ts` (pur) / `squad.ts` (store).

**Tech Stack:** React 19 + TypeScript + zustand + xterm.js (front) ; Tauri 2 + Rust (`run_wsl`) (back) ; vitest + cargo test.

## Global Constraints

- **Code = `C:\Users\VirgileDc\Vlaude` = `/mnt/c/Users/VirgileDc/Vlaude`.** Éditer là.
- **Aucun commentaire dans le code** (ni `//`, ni docstrings) — convention projet stricte.
- **TDD pour la logique pure uniquement** (`reload.ts` pur, `sessions.ts`, `wsl_read_file`). Le store I/O, le scanner et l'UI = intégration, **vérifiés par observation live** (comme tout le PTY/xterm Vlaude). Ne pas fabriquer de faux test unitaire pour du code I/O.
- **Modifs chirurgicales** : chaque ligne trace à une tâche. Pas de refactor opportuniste.
- **Commits : JAMAIS automatiques.** Chaque step « commit » attend le feu vert explicite de Virgile.
- **Commandes one-shot depuis WSL** : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && <cmd>'` (ignorer le warning UNC).
  - Typecheck : `npx tsc --noEmit` · Vitest : `npx vitest run <fichier>` · Cargo : depuis `…\Vlaude\src-tauri` → `cargo test`.
- **Sessions squad hors périmètre** : la feature cible les sessions claude normales.
- Spec de référence : `docs/superpowers/specs/2026-06-17-reload-handoff-session-design.md`.

---

### Task 1 : Commande Rust `wsl_read_file`

**Files:**
- Modify: `src-tauri/src/wslfs.rs` (ajout `decode_read` + `wsl_read_file` + test)
- Modify: `src-tauri/src/lib.rs:99-112` (enregistrement dans `invoke_handler`)

**Interfaces:**
- Produces: commande Tauri `wsl_read_file(path: String) -> Result<Option<String>, String>` — `Ok(None)` si le fichier n'existe pas, `Ok(Some(contenu))` sinon (y compris fichier vide → `Some("")`).

- [ ] **Step 1 : Écrire le test cargo qui échoue**

Dans `src-tauri/src/wslfs.rs`, dans le `mod tests` existant, ajouter l'import et le test :

```rust
    use super::decode_read;

    #[test]
    fn decode_read_distinguishes_absent_empty_present() {
        assert_eq!(decode_read("Yhello"), Some("hello".to_string()));
        assert_eq!(decode_read("Y"), Some(String::new()));
        assert_eq!(decode_read("N"), None);
    }
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec de compilation**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test decode_read'`
Expected: FAIL — `cannot find function `decode_read` in module `super``.

- [ ] **Step 3 : Implémenter `decode_read` + `wsl_read_file`**

Dans `src-tauri/src/wslfs.rs`, après `wsl_home` (vers l.25) :

```rust
fn decode_read(out: &str) -> Option<String> {
    out.strip_prefix('Y').map(|s| s.to_string())
}

#[tauri::command]
pub fn wsl_read_file(path: String) -> Result<Option<String>, String> {
    let safe = path.replace('\'', "'\\''");
    let script = format!("if [ -f '{p}' ]; then printf Y; cat '{p}'; else printf N; fi", p = safe);
    Ok(decode_read(&run_wsl(&script)?))
}
```

- [ ] **Step 4 : Enregistrer la commande**

Dans `src-tauri/src/lib.rs`, dans le `tauri::generate_handler![…]` (l.99-112), ajouter après `wslfs::wsl_home,` :

```rust
            wslfs::wsl_read_file,
```

- [ ] **Step 5 : Lancer le test, vérifier le succès**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test decode_read'`
Expected: PASS (1 test).

- [ ] **Step 6 : Commit** *(après feu vert Virgile)*

```bash
git add src-tauri/src/wslfs.rs src-tauri/src/lib.rs
git commit -m "feat(reload): wsl_read_file command (None if absent)"
```

---

### Task 2 : Action `respawnSession` dans le store sessions

**Files:**
- Modify: `src/store/sessions.ts` (interface `AppState` l.44-62 + action)
- Test: `src/store/sessions.test.ts` (nouveau `describe`)

**Interfaces:**
- Consumes: `newUuid()` (privé, `sessions.ts:69`).
- Produces: `useSessions.getState().respawnSession(id: string): void` — régénère `claudeSessionId` de la seule session ciblée (force le re-spawn du PTY via les deps du `useEffect` de `TerminalView`).

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `src/store/sessions.test.ts`, ajouter à la fin (réutilise `UUID_V4` défini l.156) :

```ts
describe("respawnSession", () => {
  beforeEach(reset);

  it("swaps only the targeted session's claudeSessionId for a fresh uuid", () => {
    const a = useSessions.getState().createSession("/home/v/a");
    const b = useSessions.getState().createSession("/home/v/a");
    const beforeA = useSessions.getState().sessions.find((s) => s.id === a)!.claudeSessionId;
    const beforeB = useSessions.getState().sessions.find((s) => s.id === b)!.claudeSessionId;
    useSessions.getState().respawnSession(a);
    const afterA = useSessions.getState().sessions.find((s) => s.id === a)!.claudeSessionId;
    const afterB = useSessions.getState().sessions.find((s) => s.id === b)!.claudeSessionId;
    expect(afterA).toMatch(UUID_V4);
    expect(afterA).not.toBe(beforeA);
    expect(afterB).toBe(beforeB);
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run src/store/sessions.test.ts'`
Expected: FAIL — `respawnSession is not a function`.

- [ ] **Step 3 : Déclarer dans l'interface `AppState`**

Dans `src/store/sessions.ts`, après `setSessionState: (id: string, state: SessionState) => void;` (l.52) :

```ts
  respawnSession: (id: string) => void;
```

- [ ] **Step 4 : Implémenter l'action**

Dans `src/store/sessions.ts`, après le bloc `setSessionState` (l.156-159) :

```ts
  respawnSession: (id) =>
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, claudeSessionId: newUuid() } : s)),
    })),
```

- [ ] **Step 5 : Lancer le test, vérifier le succès**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run src/store/sessions.test.ts'`
Expected: PASS (tous les tests du fichier, dont le nouveau).

- [ ] **Step 6 : Commit** *(après feu vert Virgile)*

```bash
git add src/store/sessions.ts src/store/sessions.test.ts
git commit -m "feat(reload): respawnSession regenerates claudeSessionId"
```

---

### Task 3 : Logique pure reload (chemins, prompt, transitions)

**Files:**
- Create: `src/store/reload.ts` (section pure uniquement pour cette tâche ; le store `useReload` est ajouté en Task 4)
- Test: `src/store/reload.test.ts`

**Interfaces:**
- Produces:
  - `type ReloadPhase = "recapping" | "clearing" | "done" | "error"`
  - `interface ReloadEntry { sessionId: string; handoffPath: string; donePath: string; startedAt: number; phase: ReloadPhase; handoff: string | null; error: string | null }`
  - `interface ReloadSignals { doneContent: string | null; handoffContent: string | null }`
  - `type ReloadAction = { type: "wait" } | { type: "clear"; handoff: string } | { type: "fail"; error: string }`
  - `RECAP_TIMEOUT_MS = 180_000`, `RELOAD_POLL_MS = 800`
  - `reloadPaths(home, claudeSessionId) -> { handoffPath, donePath }`
  - `buildHandoffPrompt(handoffPath, donePath) -> string`
  - `planReload(entry, signals, now) -> ReloadAction`

- [ ] **Step 1 : Écrire les tests qui échouent**

Create `src/store/reload.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import {
  planReload,
  reloadPaths,
  buildHandoffPrompt,
  RECAP_TIMEOUT_MS,
  type ReloadEntry,
} from "./reload";

const recapping = (over?: Partial<ReloadEntry>): ReloadEntry => ({
  sessionId: "s1",
  handoffPath: "/h/.vlaude/handoffs/u.md",
  donePath: "/h/.vlaude/handoffs/u.done",
  startedAt: 1_000,
  phase: "recapping",
  handoff: null,
  error: null,
  ...over,
});

describe("reloadPaths", () => {
  it("derives .md and .done under ~/.vlaude/handoffs, trimming trailing slash", () => {
    expect(reloadPaths("/home/v/", "u-1")).toEqual({
      handoffPath: "/home/v/.vlaude/handoffs/u-1.md",
      donePath: "/home/v/.vlaude/handoffs/u-1.done",
    });
  });
});

describe("buildHandoffPrompt", () => {
  it("embeds both absolute paths", () => {
    const p = buildHandoffPrompt("/a/u.md", "/a/u.done");
    expect(p).toContain("/a/u.md");
    expect(p).toContain("/a/u.done");
  });
});

describe("planReload", () => {
  it("waits while the .done file is absent and the timeout is not reached", () => {
    expect(planReload(recapping(), { doneContent: null, handoffContent: null }, 1_000 + RECAP_TIMEOUT_MS - 1))
      .toEqual({ type: "wait" });
  });

  it("fails on timeout when .done never appears", () => {
    expect(planReload(recapping(), { doneContent: null, handoffContent: null }, 1_000 + RECAP_TIMEOUT_MS))
      .toMatchObject({ type: "fail" });
  });

  it("fails when .done exists but the handoff is empty", () => {
    expect(planReload(recapping(), { doneContent: "ok", handoffContent: "   " }, 2_000))
      .toMatchObject({ type: "fail" });
  });

  it("clears with the handoff once .done exists and the handoff is non-empty", () => {
    expect(planReload(recapping(), { doneContent: "ok", handoffContent: "Objectif: X" }, 2_000))
      .toEqual({ type: "clear", handoff: "Objectif: X" });
  });

  it("is a no-op outside the recapping phase", () => {
    expect(planReload(recapping({ phase: "clearing" }), { doneContent: "ok", handoffContent: "x" }, 2_000))
      .toEqual({ type: "wait" });
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run src/store/reload.test.ts'`
Expected: FAIL — `Failed to resolve import "./reload"`.

- [ ] **Step 3 : Implémenter la section pure**

Create `src/store/reload.ts` :

```ts
export type ReloadPhase = "recapping" | "clearing" | "done" | "error";

export interface ReloadEntry {
  sessionId: string;
  handoffPath: string;
  donePath: string;
  startedAt: number;
  phase: ReloadPhase;
  handoff: string | null;
  error: string | null;
}

export interface ReloadSignals {
  doneContent: string | null;
  handoffContent: string | null;
}

export type ReloadAction =
  | { type: "wait" }
  | { type: "clear"; handoff: string }
  | { type: "fail"; error: string };

export const RECAP_TIMEOUT_MS = 180_000;
export const RELOAD_POLL_MS = 800;

export function reloadPaths(home: string, claudeSessionId: string): { handoffPath: string; donePath: string } {
  const base = `${home.replace(/\/+$/, "")}/.vlaude/handoffs/${claudeSessionId}`;
  return { handoffPath: `${base}.md`, donePath: `${base}.done` };
}

export function buildHandoffPrompt(handoffPath: string, donePath: string): string {
  return [
    "Le contexte de cette session est saturé. Avant que je reparte sur une session vierge,",
    "fais exactement ceci, dans cet ordre, sans me poser de question :",
    "",
    `1. Écris un handoff de reprise dans ${handoffPath} (écrase s'il existe). Court mais`,
    "   actionnable — c'est le PROMPT qui démarrera la prochaine session, pas un journal.",
    "   Contenu : objectif en cours, état/avancement réel, fichiers clés touchés (chemin:ligne),",
    "   prochaine étape concrète, pièges/contraintes à ne pas réoublier.",
    "",
    "2. Persiste dans le vault Obsidian uniquement le savoir durable, selon tes critères",
    "   habituels (trap résolu, décision d'archi, mécanisme du codebase, contournement de",
    "   limitation) — une note = une claim, rien de trivial. S'il n'y a rien qui mérite, skip.",
    "",
    `3. EN TOUT DERNIER, une fois 1 et 2 faits, écris ${donePath} (contenu : ok).`,
  ].join("\n");
}

export function planReload(entry: ReloadEntry, signals: ReloadSignals, now: number): ReloadAction {
  if (entry.phase !== "recapping") return { type: "wait" };
  if (signals.doneContent === null) {
    if (now - entry.startedAt >= RECAP_TIMEOUT_MS) {
      return { type: "fail", error: "timeout : claude n'a pas terminé le récap" };
    }
    return { type: "wait" };
  }
  const handoff = signals.handoffContent;
  if (handoff === null || handoff.trim() === "") {
    return { type: "fail", error: "handoff vide ou illisible" };
  }
  return { type: "clear", handoff };
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run src/store/reload.test.ts'`
Expected: PASS (7 tests).

- [ ] **Step 5 : Commit** *(après feu vert Virgile)*

```bash
git add src/store/reload.ts src/store/reload.test.ts
git commit -m "feat(reload): pure state machine (paths, prompt, planReload)"
```

---

### Task 4 : Store `useReload` (orchestration I/O)

**Files:**
- Modify: `src/store/reload.ts` (ajout du store sous la section pure)

**Interfaces:**
- Consumes: `wsl_read_file` (Task 1), `useSessions.respawnSession` (Task 2), `planReload`/`reloadPaths`/`buildHandoffPrompt`/`RELOAD_POLL_MS` (Task 3), `featurePayload` (`injection.ts:31`), `wslHome` (`store/wslfs.ts`), `getTerm` (`terminal/termRegistry.ts`).
- Produces: `useReload` avec `startReload(id)`, `isClearing(id) -> boolean`, `onReady(id)`, `phaseOf(id) -> ReloadPhase | undefined`, `entries: Record<string, ReloadEntry>`.

> Tâche d'intégration : pas de test unitaire (I/O Tauri + setInterval, comme `squad.ts`). Deliverable vérifié par **typecheck** ici, puis par le **test live** en Task 6.

- [ ] **Step 1 : Ajouter le store sous la section pure de `reload.ts`**

Append à `src/store/reload.ts` :

```ts
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useSessions } from "./sessions";
import { featurePayload } from "./injection";
import { wslHome } from "./wslfs";
import { getTerm } from "../terminal/termRegistry";

const encoder = new TextEncoder();

interface ReloadStore {
  entries: Record<string, ReloadEntry>;
  poll: ReturnType<typeof setInterval> | null;
  startReload: (sessionId: string) => Promise<void>;
  isClearing: (sessionId: string) => boolean;
  phaseOf: (sessionId: string) => ReloadPhase | undefined;
  onReady: (sessionId: string) => void;
  tick: () => Promise<void>;
  ensurePoll: () => void;
  stopPoll: () => void;
}

export const useReload = create<ReloadStore>((set, get) => ({
  entries: {},
  poll: null,

  startReload: async (sessionId) => {
    const active = get().entries[sessionId]?.phase;
    if (active === "recapping" || active === "clearing") return;
    const session = useSessions.getState().sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const home = (await wslHome()) || "/home";
    const { handoffPath, donePath } = reloadPaths(home, session.claudeSessionId);
    const entry: ReloadEntry = {
      sessionId,
      handoffPath,
      donePath,
      startedAt: Date.now(),
      phase: "recapping",
      handoff: null,
      error: null,
    };
    set((s) => ({ entries: { ...s.entries, [sessionId]: entry } }));
    const payload = featurePayload(buildHandoffPrompt(handoffPath, donePath));
    invoke("pty_write", { id: sessionId, data: Array.from(encoder.encode(payload)) }).catch((e) =>
      console.error("pty_write failed", e)
    );
    get().ensurePoll();
  },

  isClearing: (sessionId) => get().entries[sessionId]?.phase === "clearing",

  phaseOf: (sessionId) => get().entries[sessionId]?.phase,

  onReady: (sessionId) => {
    const e = get().entries[sessionId];
    if (!e || e.phase !== "clearing" || e.handoff === null) return;
    getTerm(sessionId)?.paste(e.handoff);
    set((s) => ({ entries: { ...s.entries, [sessionId]: { ...s.entries[sessionId], phase: "done" } } }));
  },

  tick: async () => {
    const recapping = Object.values(get().entries).filter((e) => e.phase === "recapping");
    if (recapping.length === 0) {
      get().stopPoll();
      return;
    }
    const now = Date.now();
    for (const e of recapping) {
      let doneContent: string | null = null;
      let handoffContent: string | null = null;
      try {
        doneContent = await invoke<string | null>("wsl_read_file", { path: e.donePath });
        if (doneContent !== null) handoffContent = await invoke<string | null>("wsl_read_file", { path: e.handoffPath });
      } catch {
        continue;
      }
      const action = planReload(e, { doneContent, handoffContent }, now);
      if (action.type === "wait") continue;
      if (action.type === "fail") {
        set((s) => ({ entries: { ...s.entries, [e.sessionId]: { ...s.entries[e.sessionId], phase: "error", error: action.error } } }));
      } else {
        set((s) => ({ entries: { ...s.entries, [e.sessionId]: { ...s.entries[e.sessionId], phase: "clearing", handoff: action.handoff } } }));
        useSessions.getState().respawnSession(e.sessionId);
      }
    }
  },

  ensurePoll: () => {
    if (get().poll) return;
    set({ poll: setInterval(() => { get().tick(); }, RELOAD_POLL_MS) });
  },

  stopPoll: () => {
    const p = get().poll;
    if (p) clearInterval(p);
    set({ poll: null });
  },
}));
```

- [ ] **Step 2 : Typecheck**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit'`
Expected: aucune erreur.

- [ ] **Step 3 : Re-lancer les tests purs (non-régression)**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx vitest run src/store/reload.test.ts'`
Expected: PASS (7 tests inchangés).

- [ ] **Step 4 : Commit** *(après feu vert Virgile)*

```bash
git add src/store/reload.ts
git commit -m "feat(reload): useReload store (inject, poll, respawn, paste)"
```

---

### Task 5 : Brancher le scanner `READY` en phase clearing

**Files:**
- Modify: `src/terminal/TerminalView.tsx:70-77` (généralise la condition de branchement du scanner)

**Interfaces:**
- Consumes: `useReload.isClearing(id)`, `useReload.onReady(id)` (Task 4) ; `createMarkerScanner` (déjà importé).

> Tâche d'intégration : vérifiée par typecheck ici + test live en Task 6.

- [ ] **Step 1 : Ajouter l'import**

Dans `src/terminal/TerminalView.tsx`, après `import { useSquad } from "../store/squad";` (l.11) :

```ts
import { useReload } from "../store/reload";
```

- [ ] **Step 2 : Étendre la condition du scanner**

Dans `src/terminal/TerminalView.tsx`, remplacer le bloc l.70-77 :

```ts
    let scan: ((bytes: Uint8Array) => void) | null = null;
    if (kind === "claude" && squad.injection[id]) {
      squad.notifySpawn(id);
      scan = createMarkerScanner(() => {
        scan = null;
        useSquad.getState().markReady(id);
      });
    }
```

par :

```ts
    let scan: ((bytes: Uint8Array) => void) | null = null;
    if (kind === "claude" && squad.injection[id]) {
      squad.notifySpawn(id);
      scan = createMarkerScanner(() => {
        scan = null;
        useSquad.getState().markReady(id);
      });
    } else if (kind === "claude" && useReload.getState().isClearing(id)) {
      scan = createMarkerScanner(() => {
        scan = null;
        useReload.getState().onReady(id);
      });
    }
```

- [ ] **Step 3 : Typecheck**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit'`
Expected: aucune erreur.

- [ ] **Step 4 : Commit** *(après feu vert Virgile)*

```bash
git add src/terminal/TerminalView.tsx
git commit -m "feat(reload): wire READY scanner during clearing phase"
```

---

### Task 6 : Bouton « reload » dans la tuile + test live end-to-end

**Files:**
- Modify: `src/components/SessionTile.tsx` (import + hooks + bouton après le `/clear` l.82)

**Interfaces:**
- Consumes: `useReload.startReload(id)`, `useReload` (sélecteur de phase) (Task 4).

> **Prérequis OBLIGATOIRE (règle projet)** : invoquer le skill `frontend-design` AVANT d'écrire le bouton (choix d'icône, cohérence design system, pièges de styling). Le SVG ci-dessous est un point de départ « refresh-cw » à valider/ajuster via le skill.

- [ ] **Step 0 : Invoquer le skill `frontend-design`**

Charger `frontend-design` et confirmer l'icône + les classes avant de coder.

- [ ] **Step 1 : Ajouter l'import du store**

Dans `src/components/SessionTile.tsx`, après `import { useSquad } from "../store/squad";` (l.5) :

```ts
import { useReload } from "../store/reload";
```

- [ ] **Step 2 : Lire la phase reload dans le composant**

Dans `SessionTile`, après `const manualInject = useSquad((s) => s.manualInject);` (l.54) :

```ts
  const reloadPhase = useReload((s) => s.entries[session.id]?.phase);
  const startReload = useReload((s) => s.startReload);
```

- [ ] **Step 3 : Insérer le bouton juste après le `/clear`**

Dans `src/components/SessionTile.tsx`, après la fermeture du bouton `/clear` (l.82, `</button>`), insérer :

```tsx
          <button
            title="reload — récap → session vierge"
            className={`cmd${reloadPhase === "recapping" || reloadPhase === "clearing" ? " pending" : reloadPhase === "error" ? " failed" : ""}`}
            onClick={(e) => { e.stopPropagation(); startReload(session.id); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
          </button>
```

- [ ] **Step 4 : Typecheck + suite complète**

Run: `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit && npx vitest run'`
Expected: aucune erreur TS ; toutes les suites vitest vertes.

- [ ] **Step 5 : Test live (Definition of Done)** — Virgile lance `npm run tauri dev`

1. Tuile en plein travail → clic reload → le bouton passe « pending » ; claude reçoit le prompt, écrit le handoff + (le cas échéant) une note vault, puis le `.done`.
2. La tuile bascule sur une conversation **neuve** (claude ne se souvient plus du fil précédent).
3. Le récap apparaît dans l'input **non soumis** ; un appui sur Entrée relance le travail avec le contexte.
4. Cas d'échec : couper claude avant le `.done` → après ~3 min la session d'origine reste **intacte** (pas de clear), bouton « failed ».
5. Vérifier le fichier vault écrit (présent, conforme aux critères de persistance).
6. Confirmer les hypothèses live : paste multi-lignes éditable et non soumis ; écriture vault effective.

- [ ] **Step 6 : Commit** *(après feu vert Virgile)*

```bash
git add src/components/SessionTile.tsx
git commit -m "feat(reload): tile reload button (handoff to fresh session)"
```

---

## Self-Review

**Spec coverage** : §4.1 UI → Task 6 ; §4.2 store/poll/machine → Tasks 3+4 ; §4.3 prompt → Task 3 (`buildHandoffPrompt`) ; §4.4 respawn → Task 2 ; §4.5 scanner READY → Task 5 ; §4.6 `wsl_read_file` → Task 1 ; §4.7 garde-fous (timeout/handoff vide/intact) → `planReload` (Task 3) + tick (Task 4) + live (Task 6.5) ; §5 tests → Steps TDD (T1/T2/T3) + live (T6). Aucun trou.

**Placeholder scan** : aucun TBD/TODO ; chaque step de code contient le code réel ; commandes exactes avec sortie attendue.

**Type consistency** : `ReloadEntry`/`ReloadPhase`/`ReloadAction`/`ReloadSignals` définis en Task 3, consommés à l'identique en Task 4 ; `planReload`/`reloadPaths`/`buildHandoffPrompt` mêmes signatures partout ; `isClearing`/`onReady`/`phaseOf`/`startReload` définis en Task 4, consommés en Tasks 5-6 ; `wsl_read_file` retourne `Option<String>` (Rust) ↔ `string | null` (TS invoke) cohérent.
