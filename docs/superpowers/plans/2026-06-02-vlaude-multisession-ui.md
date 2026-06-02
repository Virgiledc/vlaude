# Vlaude — Plan B : UI multi-sessions (sidebar groupée + canvas en zones)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Passer du spike « 1 terminal en dur » à la vraie app : créer/fermer des sessions `claude`, groupées par chemin dans une sidebar ET un canvas, avec 3 actions par tuile (plein écran / enlever de la page / fermer+modal), dans un style sombre « Quiet cockpit ».

**Architecture:** Store Zustand (sessions, focus, recents) → Sidebar (groupée par chemin) + Canvas (zones par chemin, tuiles xterm). Le backend Rust (pont PTY) est inchangé : chaque tuile monte un `TerminalView` qui `pty_spawn`/`pty_close`.

**Tech Stack:** React+TS, Zustand, framer-motion, @fontsource/geist-sans + geist-mono, xterm.js (déjà là), Vitest (logique pure).

---

## ⚠️ INVARIANT CRITIQUE — ne JAMAIS le casser
**Une session vivante = son `TerminalView` reste monté en continu jusqu'à la fermeture explicite (✕).**
- « Enlever de la page » = `openInCanvas=false` → la tuile passe en `display:none` (le PTY et le buffer xterm restent vivants). **PAS de démontage.**
- « Fermer » (✕) = retirer la session du store → React démonte la tuile → `TerminalView` cleanup → `pty_close`. C'est le SEUL chemin qui tue un PTY.
- Toutes les tuiles vivent dans **UN conteneur DOM stable**, avec `key={session.id}` stable. React réordonne/affiche/masque sans recréer le nœud → le terminal survit aux changements de layout.
- **Conséquence pour les implémenteurs** : ne jamais conditionner le *montage* d'un `TerminalView` sur `openInCanvas` ni sur le plein écran. Toujours monté ; on ne joue que sur le CSS.

---

## ⚙️ Conventions d'exécution (identiques au Plan A)
- Fichiers : `/mnt/c/Users/VirgileDc/Vlaude/...`. Build/test : `cmd.exe /c 'C:\Users\VirgileDc\Vlaude\vlenv.bat <cmd>' 2>&1 | tr -d '\r'` (1re ligne = warning UNC cosmétique à ignorer).
- `npm run tauri dev` = GUI → observation humaine (Virgile), pas le sous-agent.
- Pas de `git commit` (checkpoints pour Virgile). Pas de commentaires de code. Surgical.

## 🗺️ Fichiers
```
src/
├─ theme.css                     (tokens design system — variables CSS)
├─ store/
│  ├─ grouping.ts                (pure: groupByPath)            ← TDD
│  ├─ grouping.test.ts
│  ├─ sessions.ts                (zustand store)                ← TDD (logique)
│  └─ sessions.test.ts
├─ components/
│  ├─ Sidebar.tsx / Sidebar.css
│  ├─ NewSessionDialog.tsx / NewSessionDialog.css
│  ├─ Canvas.tsx / Canvas.css
│  ├─ SessionTile.tsx / SessionTile.css
│  └─ ConfirmCloseModal.tsx / ConfirmCloseModal.css
├─ terminal/TerminalView.tsx     (MODIF : prop `visible` → refit/focus)
└─ App.tsx                       (assemblage + reveal au load)
vitest.config.ts                 (env node pour la logique pure)
```

---

## Task B1 : Deps + design tokens + Vitest

**Files:** Create `src/theme.css`, `vitest.config.ts`. Modify `src/main.tsx`, `package.json`.

- [ ] **Step 1 : Installer les deps**
```
cmd.exe /c 'C:\Users\VirgileDc\Vlaude\vlenv.bat npm install zustand framer-motion @fontsource/geist-sans @fontsource/geist-mono' 2>&1 | tr -d '\r'
cmd.exe /c 'C:\Users\VirgileDc\Vlaude\vlenv.bat npm install -D vitest' 2>&1 | tr -d '\r'
```

- [ ] **Step 2 : `vitest.config.ts`**
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```
Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3 : `src/theme.css` (design tokens « Quiet cockpit »)**
```css
@import "@fontsource/geist-sans/400.css";
@import "@fontsource/geist-sans/500.css";
@import "@fontsource/geist-sans/600.css";
@import "@fontsource/geist-mono/400.css";
@import "@fontsource/geist-mono/500.css";

:root {
  --bg-0: #0b0b0d;
  --bg-1: #0e0e11;
  --bg-2: #161619;
  --bg-3: #1c1c21;
  --bg-4: #24242b;
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border: rgba(255, 255, 255, 0.10);
  --text-hi: #ececf0;
  --text-mid: #b6b6bd;
  --text-lo: #6f6f78;
  --text-dim: #55555c;
  --accent: #e0805f;
  --accent-soft: rgba(224, 128, 95, 0.14);
  --accent-border: rgba(224, 128, 95, 0.45);
  --ok: #28c840;
  --idle: #e0a33f;
  --off: #5a5a60;
  --danger: #d9483f;
  --font-ui: "Geist Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, "JetBrains Mono", Menlo, monospace;
  --r-sm: 7px;
  --r-md: 10px;
  --r-lg: 14px;
  --r-xl: 18px;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --shadow-tile: 0 8px 30px rgba(0, 0, 0, 0.45);
  --shadow-modal: 0 24px 60px rgba(0, 0, 0, 0.6);
}

* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--bg-1);
  color: var(--text-hi);
  font-family: var(--font-ui);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

@keyframes vl-breathe { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes vl-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
```

- [ ] **Step 4 : importer le thème** — dans `src/main.tsx`, ajouter en première ligne d'import : `import "./theme.css";`

- [ ] **Step 5 : vérifier**
```
cmd.exe /c 'C:\Users\VirgileDc\Vlaude\vlenv.bat npm run build' 2>&1 | tr -d '\r'
```
Expected : build OK (les polices se bundlent).

---

## Task B2 (TDD) : `src/store/grouping.ts` — grouper par chemin

**Files:** Create `src/store/grouping.ts`, `src/store/grouping.test.ts`.

- [ ] **Step 1 : test rouge** — `src/store/grouping.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { groupByPath, prettyCwd } from "./grouping";
import type { Session } from "./sessions";

const s = (id: string, cwd: string): Session => ({
  id, name: id, cwd, status: "running", openInCanvas: true,
});

describe("groupByPath", () => {
  it("groups sessions by cwd, preserving creation order of groups", () => {
    const groups = groupByPath([
      s("a", "/home/v/dt/threadscrap"),
      s("b", "/home/v/dt/saas"),
      s("c", "/home/v/dt/threadscrap"),
    ]);
    expect(groups.map((g) => g.cwd)).toEqual([
      "/home/v/dt/threadscrap",
      "/home/v/dt/saas",
    ]);
    expect(groups[0].sessions.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("labels with ~ for home", () => {
    expect(prettyCwd("/home/virgile/dt/threadscrap")).toBe("~/dt/threadscrap");
    expect(prettyCwd("/srv/app")).toBe("/srv/app");
  });
});
```
Run: `cmd.exe /c 'C:\Users\VirgileDc\Vlaude\vlenv.bat npm test' 2>&1 | tr -d '\r'` → FAIL.

- [ ] **Step 2 : implémenter** — `src/store/grouping.ts`
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

export function groupByPath(sessions: Session[]): PathGroup[] {
  const order: string[] = [];
  const map = new Map<string, Session[]>();
  for (const sess of sessions) {
    if (!map.has(sess.cwd)) {
      map.set(sess.cwd, []);
      order.push(sess.cwd);
    }
    map.get(sess.cwd)!.push(sess);
  }
  return order.map((cwd) => ({ cwd, label: prettyCwd(cwd), sessions: map.get(cwd)! }));
}
```
Run npm test → grouping tests PASS.

---

## Task B3 (TDD) : `src/store/sessions.ts` — store Zustand

**Files:** Create `src/store/sessions.ts`, `src/store/sessions.test.ts`.

- [ ] **Step 1 : test rouge** — `src/store/sessions.test.ts`
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useSessions } from "./sessions";

const reset = () =>
  useSessions.setState({ sessions: [], focusId: null, counter: 0 });

describe("sessions store", () => {
  beforeEach(reset);

  it("createSession adds an open, focused running session with auto name", () => {
    const id = useSessions.getState().createSession("/home/v/dt/x");
    const st = useSessions.getState();
    expect(st.sessions).toHaveLength(1);
    expect(st.sessions[0]).toMatchObject({
      id, cwd: "/home/v/dt/x", name: "session-1", status: "running", openInCanvas: true,
    });
    expect(st.focusId).toBe(id);
  });

  it("createSession honors an explicit name", () => {
    useSessions.getState().createSession("/home/v/dt/x", "fix-bug");
    expect(useSessions.getState().sessions[0].name).toBe("fix-bug");
  });

  it("removeFromCanvas keeps the session but hides it", () => {
    const id = useSessions.getState().createSession("/home/v/dt/x");
    useSessions.getState().removeFromCanvas(id);
    const sess = useSessions.getState().sessions.find((s) => s.id === id)!;
    expect(sess.openInCanvas).toBe(false);
    expect(useSessions.getState().sessions).toHaveLength(1);
  });

  it("openInCanvas re-shows and focuses", () => {
    const id = useSessions.getState().createSession("/home/v/dt/x");
    useSessions.getState().removeFromCanvas(id);
    useSessions.getState().openInCanvas(id);
    expect(useSessions.getState().sessions.find((s) => s.id === id)!.openInCanvas).toBe(true);
    expect(useSessions.getState().focusId).toBe(id);
  });

  it("closeSession removes the session entirely", () => {
    const id = useSessions.getState().createSession("/home/v/dt/x");
    useSessions.getState().closeSession(id);
    expect(useSessions.getState().sessions).toHaveLength(0);
  });
});
```
Run npm test → FAIL.

- [ ] **Step 2 : implémenter** — `src/store/sessions.ts`
```ts
import { create } from "zustand";

export type SessionStatus = "running" | "idle" | "exited";

export interface Session {
  id: string;
  name: string;
  cwd: string;
  status: SessionStatus;
  openInCanvas: boolean;
}

interface SessionsState {
  sessions: Session[];
  focusId: string | null;
  counter: number;
  createSession: (cwd: string, name?: string) => string;
  openInCanvas: (id: string) => void;
  removeFromCanvas: (id: string) => void;
  closeSession: (id: string) => void;
  setFocus: (id: string) => void;
}

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const useSessions = create<SessionsState>((set) => ({
  sessions: [],
  focusId: null,
  counter: 0,
  createSession: (cwd, name) => {
    const id = newId();
    set((st) => {
      const counter = st.counter + 1;
      const session: Session = {
        id,
        name: name?.trim() || `session-${counter}`,
        cwd,
        status: "running",
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
}));
```
Run npm test → all store + grouping tests PASS.

---

## Task B4 : `TerminalView` — prop `visible` (refit/focus quand affiché)

**Files:** Modify `src/terminal/TerminalView.tsx`.

- [ ] **Step 1** : Étendre les props et garder l'instance term/fit dans des refs pour refit. Le `useEffect` de spawn reste `[id, cwd]` UNIQUEMENT (montage une seule fois — invariant). Nouveau `useEffect` sur `visible`. Final :
```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { createPty } from "./usePty";

interface Props {
  id: string;
  cwd: string;
  visible: boolean;
}

export function TerminalView({ id, cwd, visible }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<ReturnType<typeof createPty> | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily: '"Geist Mono", ui-monospace, "JetBrains Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: "#0e0e11", foreground: "#c8c8cf" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try { term.loadAddon(new WebglAddon()); } catch (e) { console.warn("WebGL off", e); }
    fit.fit();
    const pty = createPty(id, cwd, term.cols, term.rows, (bytes) => term.write(bytes));
    const dataSub = term.onData((d) => pty.write(d));
    const ro = new ResizeObserver(() => { fit.fit(); pty.resize(term.cols, term.rows); });
    ro.observe(hostRef.current);
    termRef.current = term; fitRef.current = fit; ptyRef.current = pty;
    return () => {
      ro.disconnect(); dataSub.dispose(); pty.close(); term.dispose();
      termRef.current = null; fitRef.current = null; ptyRef.current = null;
    };
  }, [id, cwd]);

  useEffect(() => {
    if (!visible || !termRef.current || !fitRef.current || !ptyRef.current) return;
    fitRef.current.fit();
    ptyRef.current.resize(termRef.current.cols, termRef.current.rows);
    termRef.current.focus();
  }, [visible]);

  return <div className="vl-terminal-host" ref={hostRef} />;
}
```

---

## Task B5 : `SessionTile` — barre de titre + 3 actions, wrappe TerminalView

**Files:** Create `src/components/SessionTile.tsx`, `src/components/SessionTile.css`.

- [ ] **Step 1** : `src/components/SessionTile.tsx`
```tsx
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
  return (
    <div
      className={`vl-tile${focused ? " focused" : ""}${fullscreen ? " fullscreen" : ""}`}
      onMouseDown={onFocus}
      style={{ display: session.openInCanvas ? "flex" : "none" }}
    >
      <div className="vl-tile-bar">
        <span className={`vl-dot ${session.status}`} />
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

- [ ] **Step 2** : `src/components/SessionTile.css`
```css
.vl-tile {
  flex: 1 1 360px; min-width: 280px; min-height: 200px;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg-1); border: 1px solid var(--border);
  border-radius: var(--r-lg); box-shadow: var(--shadow-tile);
  transition: border-color 140ms var(--ease), transform 140ms var(--ease);
  animation: vl-rise 220ms var(--ease) both;
}
.vl-tile:hover { transform: translateY(-2px); }
.vl-tile.focused { border-color: var(--accent-border); }
.vl-tile.fullscreen {
  position: absolute; inset: 12px; z-index: 50; flex: none;
  min-height: 0; transform: none;
}
.vl-tile-bar {
  display: flex; align-items: center; gap: 9px; height: 30px; padding: 0 11px;
  background: var(--bg-3); border-bottom: 1px solid var(--border-subtle);
  font-family: var(--font-ui); flex: none;
}
.vl-tile-name { font-size: 12px; color: var(--text-mid); }
.vl-tile-actions { margin-left: auto; display: flex; gap: 4px; }
.vl-tile-actions button {
  background: none; border: none; color: var(--text-lo); cursor: pointer;
  font-size: 12px; padding: 3px 5px; border-radius: 6px; line-height: 1;
  transition: color 120ms, background 120ms;
}
.vl-tile-actions button:hover { background: var(--bg-4); }
.vl-tile-actions .full:hover { color: var(--text-hi); }
.vl-tile-actions .rem:hover { color: var(--idle); }
.vl-tile-actions .cls:hover { color: var(--danger); }
.vl-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.vl-dot.running { background: var(--ok); animation: vl-breathe 2.4s var(--ease) infinite; }
.vl-dot.idle { background: var(--idle); }
.vl-dot.exited { background: var(--off); }
```

---

## Task B6 : `Canvas` — zones par chemin (conteneur stable, PTY-safe)

**Files:** Create `src/components/Canvas.tsx`, `src/components/Canvas.css`.

- [ ] **Step 1** : `src/components/Canvas.tsx`. **PTY-safe** : chaque `SessionTile` a `key={s.id}` et reste dans le même parent `.vl-zone-tiles` tant que la session existe ; le plein écran est **CSS-only en place** (`fullscreen={fullscreenId === s.id}` → la tuile prend `position:absolute; inset:12px`, cf. CSS Task B5), JAMAIS un re-render sous un autre parent. Masquage des zones via `display` uniquement.
```tsx
import { useState } from "react";
import { useSessions } from "../store/sessions";
import { groupByPath } from "../store/grouping";
import { SessionTile } from "./SessionTile";
import "./Canvas.css";

interface Props {
  onRequestClose: (id: string) => void;
}

export function Canvas({ onRequestClose }: Props) {
  const sessions = useSessions((s) => s.sessions);
  const focusId = useSessions((s) => s.focusId);
  const setFocus = useSessions((s) => s.setFocus);
  const removeFromCanvas = useSessions((s) => s.removeFromCanvas);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  const groups = groupByPath(sessions);
  const anyOpen = sessions.some((s) => s.openInCanvas);

  return (
    <div className="vl-canvas">
      {!anyOpen && (
        <div className="vl-canvas-empty">
          Aucune session ouverte. Double-clique une session dans la barre latérale, ou crée-en une.
        </div>
      )}
      {groups.map((g) => {
        const openCount = g.sessions.filter((s) => s.openInCanvas).length;
        const hasFullscreen = g.sessions.some((s) => s.id === fullscreenId);
        const visible = fullscreenId ? hasFullscreen : openCount > 0;
        return (
          <div className="vl-zone" key={g.cwd} style={{ display: visible ? "flex" : "none" }}>
            <div className="vl-zone-label">
              <span className="tick" />
              <span className="path">{g.label}</span>
              <span className="count">{openCount}</span>
            </div>
            <div className="vl-zone-tiles">
              {g.sessions.map((s) => (
                <SessionTile
                  key={s.id}
                  session={s}
                  fullscreen={fullscreenId === s.id}
                  focused={focusId === s.id}
                  onFocus={() => setFocus(s.id)}
                  onToggleFullscreen={() => setFullscreenId(fullscreenId === s.id ? null : s.id)}
                  onRemove={() => removeFromCanvas(s.id)}
                  onRequestClose={() => onRequestClose(s.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```
Quand `fullscreenId` est posé : seule la zone contenant la tuile reste affichée, et cette tuile passe en `position:absolute; inset:12px` (recouvre le canvas) — même parent DOM, donc **PTY intact**. Re-clic ⛶ ou clic ✕ remet `fullscreenId=null`.

- [ ] **Step 2** : `src/components/Canvas.css`
```css
.vl-canvas {
  position: relative; flex: 1; min-width: 0; height: 100%;
  background: var(--bg-1); padding: 14px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 14px;
}
.vl-canvas-empty {
  margin: auto; max-width: 360px; text-align: center;
  color: var(--text-lo); font-size: 13px; line-height: 1.6;
}
.vl-zone {
  display: flex; flex-direction: column; gap: 9px;
  border: 1px solid var(--border-subtle); border-radius: var(--r-lg);
  background: rgba(255, 255, 255, 0.012); padding: 10px;
  animation: vl-rise 240ms var(--ease) both;
}
.vl-zone-label { display: flex; align-items: center; gap: 7px; font-family: var(--font-mono); }
.vl-zone-label .tick { width: 3px; height: 12px; border-radius: 2px; background: var(--accent); }
.vl-zone-label .path { font-size: 11px; color: var(--text-mid); }
.vl-zone-label .count {
  font-size: 10px; color: var(--text-lo); background: var(--bg-3);
  border-radius: 999px; padding: 1px 7px;
}
.vl-zone-tiles { display: flex; flex-wrap: wrap; gap: 10px; min-height: 200px; }
```

---

## Task B7 : `Sidebar` + `NewSessionDialog`

**Files:** Create `Sidebar.tsx/.css`, `NewSessionDialog.tsx/.css`.

- [ ] **Step 1** : `src/components/NewSessionDialog.tsx` (input chemin WSL + récents localStorage + nom optionnel)
```tsx
import { useEffect, useState } from "react";
import "./NewSessionDialog.css";

const RECENTS_KEY = "vlaude.recentCwds";
export const loadRecents = (): string[] => {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]"); } catch { return []; }
};
export const pushRecent = (cwd: string) => {
  const next = [cwd, ...loadRecents().filter((c) => c !== cwd)].slice(0, 8);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
};

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (cwd: string, name?: string) => void;
}

export function NewSessionDialog({ open, onClose, onCreate }: Props) {
  const [cwd, setCwd] = useState("");
  const [name, setName] = useState("");
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => { if (open) { setRecents(loadRecents()); setCwd(""); setName(""); } }, [open]);
  if (!open) return null;

  const submit = () => {
    const trimmed = cwd.trim();
    if (!trimmed) return;
    pushRecent(trimmed);
    onCreate(trimmed, name.trim() || undefined);
    onClose();
  };

  return (
    <div className="vl-overlay" onMouseDown={onClose}>
      <div className="vl-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Nouvelle session</h3>
        <label>Dossier WSL</label>
        <input
          className="vl-input" autoFocus placeholder="/home/virgile/dt/threadscrap"
          value={cwd} onChange={(e) => setCwd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {recents.length > 0 && (
          <div className="vl-recents">
            {recents.map((r) => (
              <button key={r} className="vl-chip" onClick={() => setCwd(r)}>{r}</button>
            ))}
          </div>
        )}
        <label>Nom (optionnel)</label>
        <input
          className="vl-input" placeholder="session-N" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <div className="vl-modal-actions">
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" onClick={submit}>Créer</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2** : `src/components/NewSessionDialog.css`
```css
.vl-overlay {
  position: fixed; inset: 0; z-index: 100; display: flex;
  align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45); backdrop-filter: blur(8px);
  animation: vl-rise 160ms var(--ease) both;
}
.vl-modal {
  width: 420px; max-width: 90vw; background: var(--bg-3);
  border: 1px solid var(--border); border-radius: var(--r-xl);
  box-shadow: var(--shadow-modal); padding: 22px; font-family: var(--font-ui);
}
.vl-modal h3 { margin: 0 0 16px; font-size: 16px; color: var(--text-hi); font-weight: 600; }
.vl-modal label { display: block; font-size: 11px; color: var(--text-lo); margin: 12px 0 6px; }
.vl-input {
  width: 100%; background: var(--bg-1); border: 1px solid var(--border);
  border-radius: var(--r-md); padding: 9px 11px; color: var(--text-hi);
  font-family: var(--font-mono); font-size: 12.5px; outline: none;
  transition: border-color 140ms var(--ease);
}
.vl-input:focus { border-color: var(--accent-border); box-shadow: 0 0 0 3px var(--accent-soft); }
.vl-recents { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.vl-chip {
  background: var(--bg-1); border: 1px solid var(--border-subtle);
  border-radius: 999px; padding: 4px 10px; color: var(--text-mid);
  font-family: var(--font-mono); font-size: 11px; cursor: pointer;
  transition: border-color 120ms, color 120ms;
}
.vl-chip:hover { border-color: var(--accent-border); color: var(--text-hi); }
.vl-modal-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 20px; }
.vl-modal-actions button {
  border-radius: var(--r-md); padding: 8px 16px; font-size: 12.5px;
  font-family: var(--font-ui); cursor: pointer; border: 1px solid transparent;
  transition: background 120ms, border-color 120ms;
}
.vl-modal-actions .ghost { background: none; border-color: var(--border); color: var(--text-mid); }
.vl-modal-actions .ghost:hover { color: var(--text-hi); border-color: var(--text-lo); }
.vl-modal-actions .primary { background: var(--accent); color: #1a0f0a; font-weight: 600; }
.vl-modal-actions .primary:hover { filter: brightness(1.07); }
```

- [ ] **Step 3** : `src/components/Sidebar.tsx`
```tsx
import { useSessions } from "../store/sessions";
import { groupByPath } from "../store/grouping";
import "./Sidebar.css";

interface Props {
  onNewSession: () => void;
}

export function Sidebar({ onNewSession }: Props) {
  const sessions = useSessions((s) => s.sessions);
  const focusId = useSessions((s) => s.focusId);
  const setFocus = useSessions((s) => s.setFocus);
  const openInCanvas = useSessions((s) => s.openInCanvas);
  const groups = groupByPath(sessions);

  return (
    <div className="vl-sidebar">
      <div className="vl-sidebar-scroll">
        {groups.length === 0 && <div className="vl-side-empty">Aucune session</div>}
        {groups.map((g) => (
          <div className="vl-side-group" key={g.cwd}>
            <div className="vl-side-grouplabel">{g.label}</div>
            {g.sessions.map((s) => (
              <div
                key={s.id}
                className={`vl-side-row${focusId === s.id ? " focused" : ""}`}
                onClick={() => setFocus(s.id)}
                onDoubleClick={() => openInCanvas(s.id)}
              >
                <span className={`vl-dot ${s.status}`} />
                <span className="vl-side-name">{s.name}</span>
                {s.openInCanvas && <span className="vl-side-open">●</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <button className="vl-new" onClick={onNewSession}>+ Nouvelle session</button>
      <div className="vl-side-future">
        <div className="vl-future-label">À VENIR</div>
        <div className="vl-future-row">⌘ Macros</div>
        <div className="vl-future-row">⚙ Réglages</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4** : `src/components/Sidebar.css`
```css
.vl-sidebar {
  width: 224px; flex: none; height: 100%; background: var(--bg-2);
  border-right: 1px solid var(--border-subtle); display: flex; flex-direction: column;
  font-family: var(--font-ui);
}
.vl-sidebar-scroll { flex: 1; overflow-y: auto; padding: 10px 8px; }
.vl-side-empty { color: var(--text-dim); font-size: 12px; padding: 10px; }
.vl-side-group { margin-bottom: 10px; animation: vl-rise 220ms var(--ease) both; }
.vl-side-grouplabel {
  font-family: var(--font-mono); font-size: 10px; color: var(--text-lo);
  padding: 6px 8px 4px; text-transform: none;
}
.vl-side-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 9px;
  border-radius: var(--r-sm); cursor: pointer; color: var(--text-mid); font-size: 12.5px;
  transition: background 120ms, color 120ms;
}
.vl-side-row:hover { background: rgba(255, 255, 255, 0.04); }
.vl-side-row.focused { background: var(--accent-soft); color: var(--text-hi); }
.vl-side-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vl-side-open { color: var(--accent); font-size: 8px; }
.vl-new {
  margin: 8px; padding: 9px; background: none; color: var(--text-mid);
  border: 1px dashed var(--border); border-radius: var(--r-md);
  font-family: var(--font-ui); font-size: 12px; cursor: pointer;
  transition: border-color 140ms, color 140ms;
}
.vl-new:hover { border-color: var(--accent-border); color: var(--text-hi); }
.vl-side-future { padding: 10px 12px; border-top: 1px solid var(--border-subtle); }
.vl-future-label { font-size: 9.5px; color: var(--text-dim); letter-spacing: 0.05em; margin-bottom: 4px; }
.vl-future-row { font-size: 11px; color: var(--text-lo); padding: 4px 0; }
```

---

## Task B8 : `ConfirmCloseModal` + assemblage `App.tsx`

**Files:** Create `ConfirmCloseModal.tsx/.css`. Rewrite `src/App.tsx`.

- [ ] **Step 1** : `src/components/ConfirmCloseModal.tsx`
```tsx
import "./ConfirmCloseModal.css";

interface Props {
  name: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmCloseModal({ name, onCancel, onConfirm }: Props) {
  if (!name) return null;
  return (
    <div className="vl-overlay" onMouseDown={onCancel}>
      <div className="vl-confirm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vl-confirm-title">Fermer « {name} » ?</div>
        <div className="vl-confirm-body">La session Claude sera terminée. Action irréversible.</div>
        <div className="vl-modal-actions">
          <button className="ghost" onClick={onCancel}>Annuler</button>
          <button className="danger" onClick={onConfirm}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2** : `src/components/ConfirmCloseModal.css`
```css
.vl-confirm {
  width: 340px; background: var(--bg-3); border: 1px solid var(--border);
  border-radius: var(--r-xl); box-shadow: var(--shadow-modal); padding: 20px;
  font-family: var(--font-ui); animation: vl-rise 160ms var(--ease) both;
}
.vl-confirm-title { font-size: 14px; font-weight: 600; color: var(--text-hi); }
.vl-confirm-body { font-size: 12px; color: var(--text-mid); margin-top: 6px; line-height: 1.5; }
.vl-confirm .vl-modal-actions .danger { background: var(--danger); color: #fff; font-weight: 600;
  border-radius: var(--r-md); padding: 8px 16px; font-size: 12.5px; border: none; cursor: pointer; }
.vl-confirm .vl-modal-actions .danger:hover { filter: brightness(1.08); }
```
*(la classe `.vl-modal-actions` et `.ghost` viennent de `NewSessionDialog.css`, déjà chargé globalement)*

- [ ] **Step 3** : Rewrite `src/App.tsx`
```tsx
import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { ConfirmCloseModal } from "./components/ConfirmCloseModal";
import { useSessions } from "./store/sessions";
import "./App.css";

export default function App() {
  const createSession = useSessions((s) => s.createSession);
  const closeSession = useSessions((s) => s.closeSession);
  const sessions = useSessions((s) => s.sessions);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [closeId, setCloseId] = useState<string | null>(null);

  const closeName = closeId ? sessions.find((s) => s.id === closeId)?.name ?? null : null;

  return (
    <div className="vl-app">
      <Sidebar onNewSession={() => setDialogOpen(true)} />
      <Canvas onRequestClose={setCloseId} />
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
    </div>
  );
}
```
Replace `src/App.css` body with:
```css
.vl-app { display: flex; width: 100vw; height: 100vh; background: var(--bg-1); }
```
(remove leftover scaffold CSS in App.css — the unused `.logo/.container/input/button` blocks.)

- [ ] **Step 4 : vérifier build + tests**
```
cmd.exe /c 'C:\Users\VirgileDc\Vlaude\vlenv.bat npm test' 2>&1 | tr -d '\r'
cmd.exe /c 'C:\Users\VirgileDc\Vlaude\vlenv.bat npm run build' 2>&1 | tr -d '\r'
```
Expected : tests verts (grouping + sessions), `tsc`+`vite` OK.

- [ ] **Step 5 : SPIKE visuel (Virgile)** — `npm run tauri dev` : créer 2 sessions dans 2 chemins différents → vérifier groupement sidebar + canvas, double-clic ouvre, plein écran/enlever/fermer+modal marchent, et **enlever de la page NE tue PAS la session** (la rouvrir montre le même claude avec son historique).

---

## ✅ Definition of Done — Plan B
- Créer une session (dialogue dossier WSL + récents) → apparaît groupée par chemin (sidebar + canvas) avec un vrai claude.
- Double-clic sidebar ouvre dans le canvas ; focus au simple-clic.
- 3 actions OK : plein écran (en place), enlever de la page (**PTY conservé**, rouverture = même claude), fermer (modal → `pty_close`).
- `npm test` vert (grouping + sessions store).
- `npm run build` OK.

## 📋 Hors périmètre v1 (différé, à annoncer)
- **Drag pour redimensionner / réordonner** les tuiles (pour rester PTY-safe sans risque, v1 = auto-tiling + plein écran ; le resize fin viendra ensuite via une couche de layout qui préserve le montage des terminaux).
- Persistance des sessions au redémarrage, macros/raccourcis, sélecteur de modèle, browse natif du dossier WSL.

## 🔎 Couverture spec
| Spec | Tâche |
|---|---|
| Sidebar groupée par chemin + zone « à venir » | B7 |
| Canvas zones par chemin | B6 |
| Double-clic ouvre, simple-clic focus | B6/B7 |
| 3 actions + modal | B5/B6/B8 |
| Enlever de la page garde le process | INVARIANT + B5/B6 |
| Création (dossier WSL + récents) | B7 |
| Style Mac/épuré | B1 tokens + tous les .css |
| Groupement (pure, testé) | B2 |
| Store sessions (testé) | B3 |
