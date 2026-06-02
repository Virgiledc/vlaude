# Vlaude v0.2 — Plan A : Layout flexible, Workspaces & Persistance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zones par répertoire redimensionnables, tuiles redimensionnables + réordonnables (drag intra-zone), onglets de workspace, et persistance de la disposition avec relance auto des sessions au démarrage.

**Architecture:** On étend le store zustand (workspaces, `state`, `order` par session). Le canvas passe en `react-resizable-panels` (groupe vertical = zones, groupe horizontal = tuiles), le réordonnancement intra-zone via `dnd-kit`. **Toutes les sessions de tous les workspaces restent montées** (workspace inactif = `display:none`) pour ne jamais tuer/remonter un terminal vivant. La disposition structurelle (workspaces/sessions/ordre) est sérialisée en JSON via une commande Rust ; les **tailles** des panneaux sont persistées par `react-resizable-panels` (`autoSaveId` → localStorage WebView2).

**Tech Stack:** React + TS + zustand (existant), `react-resizable-panels`, `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`, Tauri 2 (commande Rust `std::fs` pour la persistance), Vitest (tests logique pure).

**Hors de ce plan (→ Plan B, après spike) :** le **pulse violet d'attente** (injection `--settings`/hooks côté Rust, poll, event, CSS pulse) — son code dépend du résultat du spike « `--settings` merge-t-il les hooks ? ». Le champ `state` est posé ici ; Plan B le câblera.

---

## ⚙️ Conventions d'exécution (lire avant de commencer)

- **Le projet vit côté Windows** : `C:\Users\VirgileDc\Vlaude` = `/mnt/c/Users/VirgileDc/Vlaude`. Claude édite via `/mnt/c/...`.
- **npm/cargo/tauri se lancent côté Windows.** One-shots depuis WSL : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && <cmd>"`. Le dev server `npm run tauri dev` : lancé par Virgile dans un terminal Windows.
- **Vitest** (tests logique pure) : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && npx vitest run <file>"`.
- **Git** : **il n'y a pas encore de dépôt** (le `git init` du plan v0.1 n'a pas été fait). Les étapes « Checkpoint » ci-dessous ne sont **pas** des commits automatiques : conformément à la politique de Virgile, **ne jamais committer sans son feu vert**. Si Virgile fait `git init`, traiter chaque checkpoint comme « prêt à committer, je confirme ? ».
- **TDD** : la **logique pure** (`sessions.ts`, `grouping.ts`) est en vrai TDD (rouge → vert, Vitest). Le canvas/panels/dnd/Tauri est de l'**intégration** → vérifié par **observation** (lancer + constater), pas par test unitaire bidon. C'est la même règle que le plan v0.1.
- **Contrainte dure non négociable** : aucune opération (resize, reorder, switch de workspace, enlever de la page) ne doit **remonter** ni **tuer** un terminal xterm vivant. Chaque tâche d'intégration vérifie ce point explicitement.

---

## 🗺️ Structure des fichiers

```
src/
├─ store/
│  ├─ sessions.ts          (MODIF — workspaces, Session.{workspaceId,order,state}, actions, hydrate/snapshot)
│  ├─ sessions.test.ts     (MODIF — tests des nouvelles actions)
│  ├─ grouping.ts          (MODIF — groupByPath(sessions, workspaceId) trié par order)
│  ├─ grouping.test.ts     (MODIF — tests filtrage workspace + tri order)
│  └─ persistence.ts       (CRÉE — saveLayout/loadLayout via invoke + hook de save debounced)
├─ components/
│  ├─ WorkspaceTabs.tsx     (CRÉE — barre d'onglets)
│  ├─ WorkspaceTabs.css     (CRÉE)
│  ├─ Canvas.tsx            (RÉÉCRIT — react-resizable-panels + dnd-kit + multi-workspace)
│  ├─ Canvas.css            (MODIF — styles des poignées + dnd)
│  ├─ SessionTile.tsx       (MODIF — useSortable + poignée de drag)
│  ├─ SessionTile.css       (MODIF — styles drag handle / dragging)
│  └─ Sidebar.tsx           (MODIF — groupByPath(sessions, activeWorkspaceId))
└─ App.tsx                  (MODIF — WorkspaceTabs + rendu multi-workspace + hydrate au démarrage)

src-tauri/src/
└─ lib.rs                   (MODIF — commandes save_layout / load_layout)
```

**Responsabilités :** `sessions.ts` = état + transitions (pur). `grouping.ts` = dérivation des zones (pur). `persistence.ts` = pont JSON ↔ disque. `Canvas.tsx` = disposition redimensionnable/réordonnable. `WorkspaceTabs.tsx` = onglets. `lib.rs` = lecture/écriture du fichier de layout.

---

## Task 0 : Installer les dépendances

**Files:** Modify `package.json` (via npm)

- [ ] **Step 1 : Installer les libs**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && npm install react-resizable-panels @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities"`
Expected : 4 paquets ajoutés, 0 erreur.

- [ ] **Step 2 : Vérifier que le projet compile encore**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit"`
Expected : 0 erreur TypeScript (rien n'utilise encore les libs).

- [ ] **Step 3 : Checkpoint** (voir conventions git).

---

## Task 1 : Étendre le store `sessions.ts` (TDD)

**Files:**
- Modify: `src/store/sessions.ts`
- Test: `src/store/sessions.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Remplacer le contenu de `src/store/sessions.test.ts` par :
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useSessions } from "./sessions";

const reset = () =>
  useSessions.setState({
    workspaces: [{ id: "ws-1", name: "Workspace 1" }],
    activeWorkspaceId: "ws-1",
    sessions: [],
    focusId: null,
    counter: 0,
    workspaceCounter: 1,
  });

describe("sessions store", () => {
  beforeEach(reset);

  it("creates a session in the active workspace with order 0 and state working", () => {
    const id = useSessions.getState().createSession("/home/v/a");
    const s = useSessions.getState().sessions[0];
    expect(s.id).toBe(id);
    expect(s.workspaceId).toBe("ws-1");
    expect(s.order).toBe(0);
    expect(s.state).toBe("working");
    expect(s.openInCanvas).toBe(true);
  });

  it("assigns increasing order within the same workspace+cwd", () => {
    const st = useSessions.getState();
    st.createSession("/home/v/a");
    st.createSession("/home/v/a");
    const orders = useSessions.getState().sessions.map((s) => s.order);
    expect(orders).toEqual([0, 1]);
  });

  it("reorderInZone rewrites order by position", () => {
    const st = useSessions.getState();
    const a = st.createSession("/home/v/a");
    const b = st.createSession("/home/v/a");
    useSessions.getState().reorderInZone("ws-1", "/home/v/a", [b, a]);
    const byId = Object.fromEntries(useSessions.getState().sessions.map((s) => [s.id, s.order]));
    expect(byId[b]).toBe(0);
    expect(byId[a]).toBe(1);
  });

  it("setSessionState updates only the targeted session", () => {
    const a = useSessions.getState().createSession("/home/v/a");
    useSessions.getState().setSessionState(a, "waiting");
    expect(useSessions.getState().sessions[0].state).toBe("waiting");
  });

  it("createWorkspace becomes active; switchWorkspace changes active", () => {
    const ws2 = useSessions.getState().createWorkspace("Boulot");
    expect(useSessions.getState().activeWorkspaceId).toBe(ws2);
    useSessions.getState().switchWorkspace("ws-1");
    expect(useSessions.getState().activeWorkspaceId).toBe("ws-1");
  });

  it("closeWorkspace removes its sessions and never closes the last workspace", () => {
    const st = useSessions.getState();
    const ws2 = st.createWorkspace("Boulot");
    useSessions.getState().createSession("/home/v/a"); // in ws2 (active)
    useSessions.getState().closeWorkspace(ws2);
    expect(useSessions.getState().workspaces.map((w) => w.id)).toEqual(["ws-1"]);
    expect(useSessions.getState().sessions).toHaveLength(0);
    expect(useSessions.getState().activeWorkspaceId).toBe("ws-1");
    // last workspace can't be closed
    useSessions.getState().closeWorkspace("ws-1");
    expect(useSessions.getState().workspaces).toHaveLength(1);
  });

  it("snapshot/hydrate round-trips and resets state to working", () => {
    const a = useSessions.getState().createSession("/home/v/a");
    useSessions.getState().setSessionState(a, "waiting");
    const snap = useSessions.getState().snapshot();
    reset();
    useSessions.getState().hydrate(snap);
    expect(useSessions.getState().sessions[0].state).toBe("working");
    expect(useSessions.getState().sessions[0].cwd).toBe("/home/v/a");
  });
});
```

- [ ] **Step 2 : Lancer → rouge**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && npx vitest run src/store/sessions.test.ts"`
Expected : FAIL (champs/actions inexistants).

- [ ] **Step 3 : Réécrire `src/store/sessions.ts`**

```ts
import { create } from "zustand";

export type SessionState = "working" | "waiting" | "attention" | "exited";

export interface Workspace {
  id: string;
  name: string;
}

export interface Session {
  id: string;
  name: string;
  cwd: string;
  workspaceId: string;
  order: number;
  state: SessionState;
  openInCanvas: boolean;
}

export interface PersistedSnapshot {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  sessions: Session[];
  counter: number;
  workspaceCounter: number;
}

interface AppState extends PersistedSnapshot {
  focusId: string | null;
  createSession: (cwd: string, name?: string) => string;
  openInCanvas: (id: string) => void;
  removeFromCanvas: (id: string) => void;
  closeSession: (id: string) => void;
  setFocus: (id: string) => void;
  setSessionState: (id: string, state: SessionState) => void;
  reorderInZone: (workspaceId: string, cwd: string, orderedIds: string[]) => void;
  createWorkspace: (name?: string) => string;
  renameWorkspace: (id: string, name: string) => void;
  closeWorkspace: (id: string) => void;
  switchWorkspace: (id: string) => void;
  hydrate: (snap: PersistedSnapshot) => void;
  snapshot: () => PersistedSnapshot;
}

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const FIRST_WS = "ws-1";
const defaultWorkspaces = (): Workspace[] => [{ id: FIRST_WS, name: "Workspace 1" }];

export const useSessions = create<AppState>((set, get) => ({
  workspaces: defaultWorkspaces(),
  activeWorkspaceId: FIRST_WS,
  sessions: [],
  focusId: null,
  counter: 0,
  workspaceCounter: 1,

  createSession: (cwd, name) => {
    const id = newId();
    set((st) => {
      const counter = st.counter + 1;
      const wsId = st.activeWorkspaceId;
      const maxOrder = st.sessions
        .filter((s) => s.workspaceId === wsId && s.cwd === cwd)
        .reduce((m, s) => Math.max(m, s.order), -1);
      const session: Session = {
        id,
        name: name?.trim() || `session-${counter}`,
        cwd,
        workspaceId: wsId,
        order: maxOrder + 1,
        state: "working",
        openInCanvas: true,
      };
      return { sessions: [...st.sessions, session], focusId: id, counter };
    });
    return id;
  },

  openInCanvas: (id) =>
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, openInCanvas: true } : s)),
      focusId: id,
    })),

  removeFromCanvas: (id) =>
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, openInCanvas: false } : s)),
    })),

  closeSession: (id) =>
    set((st) => ({
      sessions: st.sessions.filter((s) => s.id !== id),
      focusId: st.focusId === id ? null : st.focusId,
    })),

  setFocus: (id) => set({ focusId: id }),

  setSessionState: (id, state) =>
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, state } : s)),
    })),

  reorderInZone: (workspaceId, cwd, orderedIds) =>
    set((st) => {
      const pos = new Map(orderedIds.map((sid, i) => [sid, i] as const));
      return {
        sessions: st.sessions.map((s) =>
          s.workspaceId === workspaceId && s.cwd === cwd && pos.has(s.id)
            ? { ...s, order: pos.get(s.id)! }
            : s
        ),
      };
    }),

  createWorkspace: (name) => {
    const id = newId();
    set((st) => {
      const workspaceCounter = st.workspaceCounter + 1;
      const ws: Workspace = { id, name: name?.trim() || `Workspace ${workspaceCounter}` };
      return { workspaces: [...st.workspaces, ws], activeWorkspaceId: id, workspaceCounter };
    });
    return id;
  },

  renameWorkspace: (id, name) =>
    set((st) => ({
      workspaces: st.workspaces.map((w) => (w.id === id ? { ...w, name: name.trim() || w.name } : w)),
    })),

  closeWorkspace: (id) =>
    set((st) => {
      if (st.workspaces.length <= 1) return st;
      const workspaces = st.workspaces.filter((w) => w.id !== id);
      const sessions = st.sessions.filter((s) => s.workspaceId !== id);
      const activeWorkspaceId = st.activeWorkspaceId === id ? workspaces[0].id : st.activeWorkspaceId;
      return { workspaces, sessions, activeWorkspaceId };
    }),

  switchWorkspace: (id) => set({ activeWorkspaceId: id }),

  hydrate: (snap) =>
    set({
      workspaces: snap.workspaces.length ? snap.workspaces : defaultWorkspaces(),
      activeWorkspaceId: snap.activeWorkspaceId || FIRST_WS,
      sessions: snap.sessions.map((s) => ({ ...s, state: "working" as SessionState })),
      counter: snap.counter,
      workspaceCounter: snap.workspaceCounter,
      focusId: null,
    }),

  snapshot: () => {
    const st = get();
    return {
      workspaces: st.workspaces,
      activeWorkspaceId: st.activeWorkspaceId,
      sessions: st.sessions,
      counter: st.counter,
      workspaceCounter: st.workspaceCounter,
    };
  },
}));
```

- [ ] **Step 4 : Lancer → vert**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && npx vitest run src/store/sessions.test.ts"`
Expected : tous PASS.

- [ ] **Step 5 : Checkpoint.**

---

## Task 2 : `grouping.ts` par workspace + tri par `order` (TDD)

**Files:**
- Modify: `src/store/grouping.ts`
- Test: `src/store/grouping.test.ts`

- [ ] **Step 1 : Réécrire les tests**

Remplacer `src/store/grouping.test.ts` par :
```ts
import { describe, expect, it } from "vitest";
import { groupByPath } from "./grouping";
import type { Session } from "./sessions";

const mk = (over: Partial<Session>): Session => ({
  id: over.id ?? "x",
  name: over.name ?? "n",
  cwd: over.cwd ?? "/home/v/a",
  workspaceId: over.workspaceId ?? "ws-1",
  order: over.order ?? 0,
  state: "working",
  openInCanvas: true,
});

describe("groupByPath", () => {
  it("only includes sessions of the given workspace", () => {
    const groups = groupByPath(
      [mk({ id: "1", cwd: "/home/v/a", workspaceId: "ws-1" }), mk({ id: "2", cwd: "/home/v/a", workspaceId: "ws-2" })],
      "ws-1"
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["1"]);
  });

  it("sorts sessions within a zone by order", () => {
    const groups = groupByPath(
      [mk({ id: "a", order: 2 }), mk({ id: "b", order: 0 }), mk({ id: "c", order: 1 })],
      "ws-1"
    );
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps first-seen cwd order between zones and prettifies the label", () => {
    const groups = groupByPath(
      [mk({ id: "1", cwd: "/home/v/b" }), mk({ id: "2", cwd: "/home/v/a" })],
      "ws-1"
    );
    expect(groups.map((g) => g.cwd)).toEqual(["/home/v/b", "/home/v/a"]);
    expect(groups[0].label).toBe("~/b");
  });
});
```

- [ ] **Step 2 : Lancer → rouge**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && npx vitest run src/store/grouping.test.ts"`
Expected : FAIL (signature `groupByPath` à 1 argument).

- [ ] **Step 3 : Réécrire `src/store/grouping.ts`**

```ts
import type { Session } from "./sessions";

export interface PathGroup {
  cwd: string;
  label: string;
  sessions: Session[];
}

export function prettyCwd(cwd: string): string {
  return cwd.replace(/^\/home\/[^/]+/, "~");
}

export function groupByPath(sessions: Session[], workspaceId: string): PathGroup[] {
  const order: string[] = [];
  const map = new Map<string, Session[]>();
  for (const sess of sessions) {
    if (sess.workspaceId !== workspaceId) continue;
    if (!map.has(sess.cwd)) {
      map.set(sess.cwd, []);
      order.push(sess.cwd);
    }
    map.get(sess.cwd)!.push(sess);
  }
  return order.map((cwd) => ({
    cwd,
    label: prettyCwd(cwd),
    sessions: map.get(cwd)!.slice().sort((a, b) => a.order - b.order),
  }));
}
```

- [ ] **Step 4 : Lancer → vert**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && npx vitest run src/store/grouping.test.ts"`
Expected : tous PASS.

- [ ] **Step 5 : Réparer TOUS les appelants impactés (pour garder le build vert)**

Changer la signature de `groupByPath` et retirer `status` casse 3 fichiers pas encore réécrits. Les patcher maintenant (patchs minimaux ; `Canvas`/`SessionTile` seront réécrits Tasks 4-5) :

**`src/components/Sidebar.tsx`** — remplacer `const groups = groupByPath(sessions);` par :
```tsx
  const activeWorkspaceId = useSessions((s) => s.activeWorkspaceId);
  const groups = groupByPath(sessions, activeWorkspaceId);
```
et remplacer `<span className={`vl-dot ${s.status}`} />` par `<span className={`vl-dot ${s.state}`} />`.

**`src/components/Canvas.tsx`** (ancien) — ajouter le sélecteur `const activeWorkspaceId = useSessions((s) => s.activeWorkspaceId);` puis remplacer `const groups = groupByPath(sessions);` par `const groups = groupByPath(sessions, activeWorkspaceId);`.

**`src/components/SessionTile.tsx`** — remplacer `<span className={`vl-dot ${session.status}`} />` par `<span className={`vl-dot ${session.state}`} />`.

- [ ] **Step 6 : Vérifier le typecheck**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && npx tsc --noEmit"`
Expected : 0 erreur (tous les appelants alignés sur `state` + `groupByPath` à 2 args). **Checkpoint.**

---

## Task 3 : `WorkspaceTabs` + rendu multi-workspace dans `App.tsx`

**Files:**
- Create: `src/components/WorkspaceTabs.tsx`, `src/components/WorkspaceTabs.css`
- Modify: `src/App.tsx`

- [ ] **Step 1 : Créer `WorkspaceTabs.tsx`**

```tsx
import { useState } from "react";
import { useSessions } from "../store/sessions";
import "./WorkspaceTabs.css";

interface Props {
  onRequestCloseWorkspace: (id: string) => void;
}

export function WorkspaceTabs({ onRequestCloseWorkspace }: Props) {
  const workspaces = useSessions((s) => s.workspaces);
  const activeId = useSessions((s) => s.activeWorkspaceId);
  const switchWorkspace = useSessions((s) => s.switchWorkspace);
  const createWorkspace = useSessions((s) => s.createWorkspace);
  const renameWorkspace = useSessions((s) => s.renameWorkspace);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <div className="vl-tabs">
      {workspaces.map((w) => (
        <div
          key={w.id}
          className={`vl-tab${w.id === activeId ? " active" : ""}`}
          onClick={() => switchWorkspace(w.id)}
          onDoubleClick={() => { setEditingId(w.id); setDraft(w.name); }}
        >
          {editingId === w.id ? (
            <input
              className="vl-tab-edit"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { renameWorkspace(w.id, draft); setEditingId(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { renameWorkspace(w.id, draft); setEditingId(null); }
                if (e.key === "Escape") setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="vl-tab-name">{w.name}</span>
              {workspaces.length > 1 && (
                <button
                  className="vl-tab-close"
                  title="Fermer le workspace"
                  onClick={(e) => { e.stopPropagation(); onRequestCloseWorkspace(w.id); }}
                >
                  ✕
                </button>
              )}
            </>
          )}
        </div>
      ))}
      <button className="vl-tab-new" title="Nouveau workspace" onClick={() => createWorkspace()}>
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 2 : Créer `WorkspaceTabs.css`**

```css
.vl-tabs {
  display: flex; align-items: flex-end; gap: 3px;
  height: 34px; padding: 0 10px; background: var(--bg-2, #161619);
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,.06));
  flex: none; font-family: var(--font-ui);
}
.vl-tab {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text-mid, #9a9aa2);
  padding: 5px 11px; border-radius: 8px 8px 0 0; cursor: pointer;
  background: var(--bg-3, #1b1b20);
  border: 1px solid var(--border-subtle, rgba(255,255,255,.06)); border-bottom: none;
}
.vl-tab.active { background: var(--bg-1, #0c0c0f); color: var(--text-hi, #f0d3c6); border-color: var(--accent-border, rgba(224,128,95,.4)); }
.vl-tab-name { white-space: nowrap; }
.vl-tab-close { background: none; border: none; color: inherit; cursor: pointer; font-size: 10px; opacity: .55; padding: 0 2px; }
.vl-tab-close:hover { opacity: 1; color: var(--danger, #ff5f57); }
.vl-tab-edit { width: 90px; background: var(--bg-1); border: 1px solid var(--accent-border); border-radius: 5px; color: var(--text-hi); font-size: 12px; padding: 2px 5px; }
.vl-tab-new { background: none; border: none; color: var(--text-lo, #6f6f78); font-size: 15px; cursor: pointer; padding: 0 8px; align-self: center; }
.vl-tab-new:hover { color: var(--text-hi); }
```

- [ ] **Step 3 : Câbler dans `App.tsx`**

Réécrire `src/App.tsx` :
```tsx
import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { WorkspaceTabs } from "./components/WorkspaceTabs";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { ConfirmCloseModal } from "./components/ConfirmCloseModal";
import { useSessions } from "./store/sessions";
import "./App.css";

export default function App() {
  const createSession = useSessions((s) => s.createSession);
  const closeSession = useSessions((s) => s.closeSession);
  const closeWorkspace = useSessions((s) => s.closeWorkspace);
  const sessions = useSessions((s) => s.sessions);
  const workspaces = useSessions((s) => s.workspaces);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [closeWsId, setCloseWsId] = useState<string | null>(null);

  const closeName = closeId ? sessions.find((s) => s.id === closeId)?.name ?? null : null;
  const closeWsName = closeWsId ? workspaces.find((w) => w.id === closeWsId)?.name ?? null : null;
  const wsSessionCount = closeWsId ? sessions.filter((s) => s.workspaceId === closeWsId).length : 0;

  return (
    <div className="vl-app">
      <Sidebar onNewSession={() => setDialogOpen(true)} />
      <div className="vl-main">
        <WorkspaceTabs onRequestCloseWorkspace={setCloseWsId} />
        <Canvas onRequestClose={setCloseId} />
      </div>
      <NewSessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={(cwd, name) => createSession(cwd, name)}
      />
      <ConfirmCloseModal
        name={closeName}
        onCancel={() => setCloseId(null)}
        onConfirm={() => { if (closeId) closeSession(closeId); setCloseId(null); }}
      />
      <ConfirmCloseModal
        name={closeWsId ? `${closeWsName} (${wsSessionCount} session${wsSessionCount > 1 ? "s" : ""})` : null}
        onCancel={() => setCloseWsId(null)}
        onConfirm={() => { if (closeWsId) closeWorkspace(closeWsId); setCloseWsId(null); }}
      />
    </div>
  );
}
```

- [ ] **Step 4 : Ajouter `.vl-main` dans `App.css`**

Ajouter à `src/App.css` :
```css
.vl-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
```
(`.vl-app` reste un flex row : Sidebar + `.vl-main`.)

- [ ] **Step 5 : Vérifier (observation)**

Virgile lance `npm run tauri dev`.
**Expected :** barre d'onglets visible ; `+` crée un workspace (devient actif) ; double-clic renomme ; créer une session la met dans le workspace actif ; basculer entre workspaces change la liste sidebar. (Le canvas peut encore être l'ancien — réécrit en Task 4.) **Checkpoint.**

---

## Task 4 : `Canvas` redimensionnable (`react-resizable-panels`) + multi-workspace monté

**Files:**
- Modify: `src/components/Canvas.tsx` (réécriture), `src/components/Canvas.css`

But : zones empilées verticalement redimensionnables, tuiles horizontales redimensionnables, **tous les workspaces montés** (inactifs masqués) pour garder les terminaux vivants. Pas encore de reorder (Task 5).

- [ ] **Step 1 : Réécrire `Canvas.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useSessions } from "../store/sessions";
import { groupByPath } from "../store/grouping";
import { SessionTile } from "./SessionTile";
import "./Canvas.css";

interface Props {
  onRequestClose: (id: string) => void;
}

export function Canvas({ onRequestClose }: Props) {
  const workspaces = useSessions((s) => s.workspaces);
  const activeWorkspaceId = useSessions((s) => s.activeWorkspaceId);
  return (
    <div className="vl-canvas-root">
      {workspaces.map((w) => (
        <div
          key={w.id}
          className="vl-workspace-layer"
          style={{ display: w.id === activeWorkspaceId ? "block" : "none" }}
        >
          <WorkspaceCanvas workspaceId={w.id} onRequestClose={onRequestClose} />
        </div>
      ))}
    </div>
  );
}

function WorkspaceCanvas({ workspaceId, onRequestClose }: { workspaceId: string } & Props) {
  const sessions = useSessions((s) => s.sessions);
  const focusId = useSessions((s) => s.focusId);
  const setFocus = useSessions((s) => s.setFocus);
  const removeFromCanvas = useSessions((s) => s.removeFromCanvas);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  const groups = groupByPath(sessions, workspaceId)
    .map((g) => ({ ...g, sessions: g.sessions.filter((s) => s.openInCanvas) }))
    .filter((g) => g.sessions.length > 0);

  const fsValid = fullscreenId !== null && sessions.some((s) => s.id === fullscreenId && s.openInCanvas);
  const fs = fsValid ? fullscreenId : null;
  useEffect(() => {
    if (fullscreenId !== null && !fsValid) setFullscreenId(null);
  }, [fullscreenId, fsValid]);

  if (groups.length === 0) {
    return (
      <div className="vl-canvas vl-canvas-empty-wrap">
        <div className="vl-canvas-empty">
          Aucune session ouverte. Double-clique une session dans la barre latérale, ou crée-en une.
        </div>
      </div>
    );
  }

  return (
    <PanelGroup
      direction="vertical"
      className="vl-canvas"
      autoSaveId={`vl-zones-${workspaceId}`}
    >
      {groups.map((g, zi) => (
        <Panel
          key={g.cwd}
          id={`zone-${g.cwd}`}
          order={zi}
          minSize={12}
          className="vl-zone-panel"
        >
          <div className="vl-zone">
            <div className="vl-zone-label">
              <span className="tick" />
              <span className="path">{g.label}</span>
              <span className="count">{g.sessions.length}</span>
            </div>
            <PanelGroup
              direction="horizontal"
              className="vl-zone-tiles"
              autoSaveId={`vl-tiles-${workspaceId}-${g.cwd}`}
            >
              {g.sessions.map((s, ti) => (
                <Panel key={s.id} id={`tile-${s.id}`} order={ti} minSize={15}>
                  <SessionTile
                    session={s}
                    fullscreen={fs === s.id}
                    focused={focusId === s.id}
                    onFocus={() => setFocus(s.id)}
                    onToggleFullscreen={() => setFullscreenId(fs === s.id ? null : s.id)}
                    onRemove={() => removeFromCanvas(s.id)}
                    onRequestClose={() => onRequestClose(s.id)}
                  />
                </Panel>
              ))}
            </PanelGroup>
          </div>
          {zi < groups.length - 1 && null}
        </Panel>
      ))}
    </PanelGroup>
  );
}
```
*(Note : `react-resizable-panels` exige des `PanelResizeHandle` entre les `Panel`. Step 2 les ajoute.)*

- [ ] **Step 2 : Ajouter les poignées de resize**

Les `Panel` doivent être séparés par `<PanelResizeHandle/>`. Mettre à jour les deux boucles pour intercaler une poignée entre les éléments :

Boucle des zones (verticale) — remplacer le `.map` par :
```tsx
{groups.map((g, zi) => (
  <Fragment key={g.cwd}>
    {zi > 0 && <PanelResizeHandle className="vl-rh vl-rh-v" />}
    <Panel id={`zone-${g.cwd}`} order={zi} minSize={12} className="vl-zone-panel">
      {/* …contenu zone… */}
    </Panel>
  </Fragment>
))}
```
Boucle des tuiles (horizontale) — idem :
```tsx
{g.sessions.map((s, ti) => (
  <Fragment key={s.id}>
    {ti > 0 && <PanelResizeHandle className="vl-rh vl-rh-h" />}
    <Panel id={`tile-${s.id}`} order={ti} minSize={15}>
      {/* …SessionTile… */}
    </Panel>
  </Fragment>
))}
```
Et ajouter l'import : `import { Fragment, useEffect, useState } from "react";` (retirer le `null` de fin de zone du Step 1).

- [ ] **Step 3 : Réécrire `Canvas.css`**

```css
.vl-canvas-root { position: relative; flex: 1; min-width: 0; height: 100%; }
.vl-workspace-layer { position: absolute; inset: 0; }
.vl-canvas { height: 100%; background: var(--bg-1); padding: 14px; overflow: hidden; }
.vl-canvas-empty-wrap { display: flex; }
.vl-canvas-empty { margin: auto; max-width: 360px; text-align: center; color: var(--text-lo); font-size: 13px; line-height: 1.6; }
.vl-zone-panel { min-height: 0; }
.vl-zone {
  height: 100%; display: flex; flex-direction: column; gap: 9px;
  border: 1px solid var(--border-subtle); border-radius: var(--r-lg);
  background: rgba(255,255,255,.012); padding: 10px; box-sizing: border-box; overflow: hidden;
}
.vl-zone-label { display: flex; align-items: center; gap: 7px; font-family: var(--font-mono); flex: none; }
.vl-zone-label .tick { width: 3px; height: 12px; border-radius: 2px; background: var(--accent); }
.vl-zone-label .path { font-size: 11px; color: var(--text-mid); }
.vl-zone-label .count { font-size: 10px; color: var(--text-lo); background: var(--bg-3); border-radius: 999px; padding: 1px 7px; }
.vl-zone-tiles { flex: 1; min-height: 0; }
.vl-rh { background: transparent; transition: background 120ms; flex: none; }
.vl-rh-v { height: 8px; cursor: row-resize; }
.vl-rh-h { width: 8px; cursor: col-resize; }
.vl-rh:hover, .vl-rh[data-resize-handle-active] { background: var(--accent-border, rgba(224,128,95,.4)); }
```
*(Important : retirer l'ancien `.vl-tile { flex: 1 1 360px }` côté tuile n'est pas nécessaire — la tuile est désormais à 100% de son `Panel`. Vérifier en Task qu'elle remplit bien le panneau ; sinon ajouter `.vl-tile { height: 100%; }` en Task 4 Step 5.)*

- [ ] **Step 4 : S'assurer que la tuile remplit son panneau**

Dans `src/components/SessionTile.css`, remplacer la règle `.vl-tile { flex: 1 1 360px; min-width: 280px; min-height: 200px; … }` par :
```css
.vl-tile {
  height: 100%; min-width: 0; min-height: 0;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg-1); border: 1px solid var(--border);
  border-radius: var(--r-lg); box-shadow: var(--shadow-tile);
  transition: border-color 140ms var(--ease);
}
```
(retirer le `transform: translateY(-2px)` au hover qui n'a plus de sens en panneau plein ; garder `.vl-tile.focused`, `.vl-tile.fullscreen` tels quels.)

- [ ] **Step 5 : Vérifier (observation — CRITIQUE)**

Virgile lance `npm run tauri dev`, crée 2 sessions dans le même dossier + 1 dans un autre.
**Expected, à constater :**
1. Une poignée horizontale entre les 2 tuiles du même dossier → glisser **élargit/rétrécit** les tuiles. Le terminal **ne clignote pas / ne se vide pas** (pas de remount).
2. Une poignée verticale entre les 2 zones → glisser **agrandit une zone** (le répertoire prend plus de place).
3. Fermer l'app, rouvrir : les tailles sont **restaurées** (autoSaveId/localStorage).
4. Basculer de workspace puis revenir : les terminaux de l'autre workspace **tournaient toujours** (sortie présente), pas de relance. **Checkpoint.**

> **Fallback si `react-resizable-panels` se comporte mal dans une couche `display:none`** (tailles à 0 au retour de workspace) : ne monter QUE le `WorkspaceCanvas` actif (`activeWorkspaceId`) et garder les terminaux inactifs vivants via un pool de portails (`createPortal` vers une div cachée stable). À n'implémenter QUE si le quirk se manifeste à l'étape 5.4.

---

## Task 5 : Réordonnancement intra-zone (`dnd-kit`)

**Files:**
- Modify: `src/components/Canvas.tsx`, `src/components/SessionTile.tsx`, `src/components/SessionTile.css`

But : glisser une tuile par sa poignée pour la réordonner **dans sa zone** ; `order` persiste ; aucun remount de terminal.

- [ ] **Step 1 : Rendre `SessionTile` sortable**

Dans `src/components/SessionTile.tsx`, importer dnd-kit et envelopper. Remplacer le composant par :
```tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TerminalView } from "../terminal/TerminalView";
import type { Session } from "../store/sessions";
import "./SessionTile.css";

interface Props {
  session: Session;
  fullscreen: boolean;
  focused: boolean;
  onFocus: () => void;
  onToggleFullscreen: () => void;
  onRemove: () => void;
  onRequestClose: () => void;
}

export function SessionTile({
  session, fullscreen, focused, onFocus, onToggleFullscreen, onRemove, onRequestClose,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`vl-tile${focused ? " focused" : ""}${fullscreen ? " fullscreen" : ""}${isDragging ? " dragging" : ""}`}
      onMouseDown={onFocus}
    >
      <div className="vl-tile-bar">
        <span className="vl-drag" title="Déplacer" {...attributes} {...listeners}>⠿</span>
        <span className={`vl-dot ${session.state}`} />
        <span className="vl-tile-name">{session.name}</span>
        <span className="vl-tile-actions">
          <button title="Plein écran" className="full" onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }}>⛶</button>
          <button title="Enlever de la page" className="rem" onClick={(e) => { e.stopPropagation(); onRemove(); }}>◳</button>
          <button title="Fermer" className="cls" onClick={(e) => { e.stopPropagation(); onRequestClose(); }}>✕</button>
        </span>
      </div>
      <TerminalView id={session.id} cwd={session.cwd} visible={session.openInCanvas} />
    </div>
  );
}
```
*(Le drag est déclenché par la poignée `⠿` uniquement, pour ne pas gêner la sélection de texte du terminal.)*

- [ ] **Step 2 : Envelopper chaque zone dans un `DndContext` + `SortableContext`**

Dans `Canvas.tsx`, importer :
```tsx
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
```
Dans `WorkspaceCanvas`, ajouter `const reorderInZone = useSessions((s) => s.reorderInZone);` et un capteur :
```tsx
const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
```
Puis, pour CHAQUE zone, envelopper sa `PanelGroup` horizontale dans un `DndContext` propre à la zone (drag borné à la zone) :
```tsx
<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragEnd={(e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = g.sessions.map((s) => s.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    reorderInZone(workspaceId, g.cwd, arrayMove(ids, from, to));
  }}
>
  <SortableContext items={g.sessions.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
    <PanelGroup direction="horizontal" className="vl-zone-tiles" autoSaveId={`vl-tiles-${workspaceId}-${g.cwd}`}>
      {/* …Panels + SessionTile… (inchangé) */}
    </PanelGroup>
  </SortableContext>
</DndContext>
```

- [ ] **Step 3 : Styles drag**

Ajouter à `src/components/SessionTile.css` :
```css
.vl-drag { cursor: grab; color: var(--text-lo); font-size: 12px; line-height: 1; user-select: none; padding-right: 2px; }
.vl-drag:active { cursor: grabbing; }
.vl-tile.dragging { z-index: 60; box-shadow: 0 18px 50px rgba(0,0,0,.55); border-color: var(--accent-border); }
```

- [ ] **Step 4 : Vérifier (observation — CRITIQUE)**

Virgile lance `npm run tauri dev`, crée 3 sessions dans le même dossier.
**Expected :**
1. Glisser la poignée `⠿` d'une tuile la **réordonne** dans la zone (relâcher la pose à la nouvelle position).
2. Le terminal déplacé **ne se remonte pas** (sortie/scrollback intacts pendant et après le drag).
3. On **ne peut pas** sortir une tuile de sa zone (le drag est borné au `DndContext` de la zone).
4. Fermer/rouvrir l'app → l'ordre est **conservé** (via `order` persisté en Task 6 ; si Task 6 pas encore faite, l'ordre tient au moins pour la session courante). **Checkpoint.**

> Si le couple resize (panels) + drag (dnd-kit) entre en conflit visuel (la tuile « saute » au resize) : s'assurer que `PointerSensor` a `activationConstraint.distance ≥ 4` (déjà fait) et que la poignée de resize n'est pas dans la zone draggable (elle est entre les `Panel`, hors `SessionTile` — OK).

---

## Task 6 : Persistance + relance auto (Rust + hydrate au démarrage)

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src/store/persistence.ts`
- Modify: `src/App.tsx`

But : sérialiser `{workspaces, activeWorkspaceId, sessions, counters}` sur disque ; au démarrage, hydrater le store → le rendu des `TerminalView` relance claude (chaque `TerminalView` spawn son PTY au montage, comportement existant).

- [ ] **Step 1 : Commandes Rust `save_layout` / `load_layout`**

Dans `src-tauri/src/lib.rs`, ajouter (après les commandes pty existantes) :
```rust
use std::fs;
use tauri::Manager;

fn layout_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("layout.json"))
}

#[tauri::command]
fn save_layout(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = layout_path(&app)?;
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_layout(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = layout_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}
```
Et enregistrer les commandes dans `invoke_handler` :
```rust
        .invoke_handler(tauri::generate_handler![
            pty_spawn, pty_write, pty_resize, pty_close,
            save_layout, load_layout
        ])
```

- [ ] **Step 2 : Vérifier la compilation Rust**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo build"`
Expected : compile OK.

- [ ] **Step 3 : Créer `src/store/persistence.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { useSessions, type PersistedSnapshot } from "./sessions";

export async function loadLayout(): Promise<void> {
  try {
    const raw = await invoke<string | null>("load_layout");
    if (!raw) return;
    const snap = JSON.parse(raw) as PersistedSnapshot;
    useSessions.getState().hydrate(snap);
  } catch (e) {
    console.error("loadLayout failed", e);
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function startAutoSave(): () => void {
  const persist = () => {
    const snap = useSessions.getState().snapshot();
    invoke("save_layout", { data: JSON.stringify(snap) }).catch((e) =>
      console.error("save_layout failed", e)
    );
  };
  const unsub = useSessions.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, 500);
  });
  return unsub;
}
```

- [ ] **Step 4 : Hydrater au démarrage + démarrer l'auto-save dans `App.tsx`**

Dans `src/App.tsx`, **modifier l'import React existant** `import { useState } from "react";` en `import { useEffect, useState } from "react";`, et ajouter l'import :
```tsx
import { loadLayout, startAutoSave } from "./store/persistence";
```
puis, en tête du composant `App` :
```tsx
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    loadLayout().finally(() => {
      setReady(true);
      unsub = startAutoSave();
    });
    return () => unsub?.();
  }, []);

  if (!ready) return <div className="vl-app vl-booting" />;
```
*(Le `loadLayout` hydrate AVANT le premier rendu des terminaux → au montage, chaque `TerminalView` spawn son PTY = relance auto. `startAutoSave` n'est branché qu'après hydratation pour ne pas réécrire un snapshot vide par-dessus le fichier.)*

- [ ] **Step 5 : Vérifier (observation — CRITIQUE)**

Virgile lance `npm run tauri dev` : crée 2 workspaces, plusieurs sessions, redimensionne, réordonne. Ferme l'app. Rouvre.
**Expected :**
1. Les **workspaces** et leurs sessions reviennent (mêmes noms, mêmes dossiers, même répartition).
2. Chaque session **relance claude à neuf** dans son `cwd` (prompt claude frais — pas de scrollback d'avant, c'est attendu).
3. Tailles (autoSaveId) et **ordre** (`order` persisté) restaurés.
4. `layout.json` présent dans le dossier app-data Tauri. **Checkpoint.**

---

## Task 7 : Polish UI (skill `frontend-design`)

**Files:** `*.css` des composants touchés.

- [ ] **Step 1 : Invoquer le skill `frontend-design`** AVANT tout ajustement visuel (obligation Virgile). Affiner : aspect des poignées de resize (visibles au survol seulement), états de drag, transitions, cohérence du thème sombre Mac/Linear/Warp, lisibilité des onglets actifs/inactifs. **Ne pas** introduire de nouveau composant ni de refactor non lié.
- [ ] **Step 2 : Vérifier (observation)** que rien n'a régressé (resize, reorder, switch workspace, persistance). **Checkpoint.**

---

## ✅ Definition of Done — Plan A
- J'agrandis une zone (un répertoire prend plus de place) ; je redimensionne une tuile ; je réordonne par drag dans la zone — **sans** remonter ni tuer un terminal.
- Je crée / renomme / ferme des **workspaces** (fermeture confirmée, tue ses PTY, jamais le dernier) ; chacun garde sa disposition.
- Je ferme et rouvre l'app → disposition (workspaces, tailles, ordre) restaurée + sessions **relancées** dans leurs dossiers.
- `npx vitest run` : `sessions` + `grouping` verts. `npx tsc --noEmit` : 0 erreur. `cargo build` : OK.
- Aucune étape « faite » sans preuve observée.

## 🔎 Couverture de la spec (traçabilité)
| Exigence spec | Couvert par |
|---|---|
| Zones redimensionnables (agrandir un répertoire) | Task 4 (PanelGroup vertical) |
| Tuiles redimensionnables | Task 4 (PanelGroup horizontal) |
| Reorder intra-zone (dnd-kit) | Task 5 |
| Onglets de workspace | Task 3 |
| Persistance disposition + relance auto | Task 6 |
| `state` par session (préparé pour le pulse) | Task 1 (`SessionState`, `setSessionState`) |
| Modèle de données (§4) | Tasks 1-2 |
| Pulse violet (§6) | **→ Plan B** (après spike `--settings`) |

---

## 📋 Plan B (esquisse — détaillé après le spike)
> Le **spike** d'abord : lancer `claude --settings '<json avec hook Stop sentinelle>'`, taper une question, vérifier que (a) le sentinelle est écrit ET (b) le hook qmd `UserPromptSubmit` tourne toujours (merge OK). Selon le résultat, Plan B détaille soit la voie hooks (injection `--settings` + env `VLAUDE_PULSE_DIR`/`VLAUDE_SESSION_ID` au spawn dans `manager.rs`/`wsl.rs`, thread Rust qui poll le dossier et émet un event, `usePty`/store `setSessionState`, CSS `vl-pulse` violet 5 s), soit le fallback heuristique idle.
