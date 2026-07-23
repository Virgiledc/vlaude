# Vlaude — guide projet

**Vlaude** = appli desktop Windows (un seul `.exe`, **Tauri 2**) qui **wrappe le vrai CLI `claude`** : un gestionnaire de fenêtres « style Mac » pour **multi-gérer plusieurs agents Claude** en tuiles. Chaque session = une instance **interactive** de `claude` qui tourne **dans WSL**, reliée à l'app par un **pont PTY** (`wsl.exe` + ConPTY + `portable-pty`). Le terminal affiché = **xterm.js** dans la WebView.

## ⚠️ OÙ EST LE CODE (à lire en premier)
- **Code = `C:\Users\VirgileDc\Vlaude`  ==  `/mnt/c/Users/VirgileDc/Vlaude` (côté WSL).** C'est LÀ qu'on édite.
- `~/dt/Vlaude` (`/home/virgile/dt/Vlaude`) ne contient **que les docs/brainstorm d'origine**, pas le code. Ne pas y chercher le code.
- Projet **suivi par git** côté Windows (`.git` à la racine du code).

## Stack
- **Tauri 2** (Rust + WebView2). Rust : `portable-pty 0.9`, `tauri-plugin-opener`.
- **Frontend** : React 19 + TypeScript + Vite 7, **xterm.js v6** (addon-fit, addon-webgl), **zustand**, **react-grid-layout** (canvas), **dnd-kit**, **framer-motion**, fonts Geist.
- Tests : **vitest**.

## Architecture
```
.exe Windows (Tauri 2, 1 fenêtre)
├─ Rust (src-tauri/src/)
│   ├─ lib.rs            → commands Tauri + state PtyManager
│   ├─ pty/manager.rs    → cycle de vie PTY, threads reader/ticker, Channel binaire
│   ├─ pty/coalesce.rs   → Coalescer d'octets (TDD)
│   ├─ pty/wsl.rs        → build argv `wsl.exe` (TDD)
│   └─ wslfs.rs          → helpers WSL (home, list dirs, enum plugins ~/.claude)
└─ Frontend (src/)
    ├─ terminal/TerminalView.tsx → 1 xterm par session (WebGL), I/O, resize
    ├─ terminal/usePty.ts        → pont JS↔Rust (Channel Uint8Array)
    ├─ store/sessions.ts (zustand) → sessions, workspaces, focusId, fullscreenId, layouts
    ├─ store/{grouping,persistence,plugins,wslfs}.ts
    └─ components/ Sidebar · Canvas · WorkspaceTabs · SessionTile · NewSessionDialog · ConfirmCloseModal · PluginsPanel
```
**Pont PTY (pièce porteuse)** : `wsl.exe -- bash -lic "cd <cwd> && exec claude"` → un reader thread accumule les octets ANSI dans un **Coalescer** → un ticker **flush toutes les ~16 ms** vers le front via un **Tauri Channel binaire**. **JAMAIS** emit-par-chunk / JSON-par-octet (sature le CPU en multi-session). Détails : `docs/superpowers/specs/2026-06-02-vlaude-design.md`.

## Commandes Tauri (Rust ↔ front)
`pty_spawn` · `pty_write` · `pty_resize` · `pty_close` (PTY) — `wsl_home` · `list_wsl_dirs` · `list_claude_plugins` (WSL/plugins).

## Lancer / dev / build  (⚠️ tout côté WINDOWS — MSVC + WebView2 + wsl.exe requis)
- **Dev** : `npm run tauri dev` depuis un **terminal Windows** (ou `Vlaude-dev.bat` à la racine). Virgile le lance lui-même (GUI longue durée).
- **One-shots depuis WSL** : `cmd.exe /c 'cd /d C:\Users\VirgileDc\Vlaude && <cmd>'`.
  - Typecheck : `npx tsc --noEmit` · Tests : `npx vitest run` · Build `.exe` : `npm run tauri build`.
- **Gotcha cmd.exe** : il refuse de démarrer dans le dossier UNC `\\wsl.localhost\...` (warning « chemins UNC non supportés »), il retombe sur `C:\Windows`. Le `cd /d C:\...` à l'intérieur du `/c '...'` corrige tout → **ignorer le warning**.

## Conventions (non négociables)
- **Aucun commentaire dans le code** (ni `//`, ni docstrings). Le « pourquoi » va dans `docs/`.
- **TDD pour la logique pure** (`wsl.rs`, `coalesce.rs`, `grouping`, `sessions`, `winToWsl`…) → vitest / `cargo test`. PTY/xterm = intégration → vérifié **par observation** (lancer + constater).
- **Modifs chirurgicales** : chaque ligne trace à la demande. Pas de refactor opportuniste.
- **Ne JAMAIS committer sans le feu vert explicite de Virgile.**
- Le **Channel binaire + coalescing 16 ms** est porteur → ne jamais régresser vers de l'emit par chunk.

## Vérification (Definition of Done)
Rien n'est « fait » sans **preuve concrète** : vrai terminal `claude` qui répond, build `.exe` qui démarre, multi-session fluide observée. Pas de « ça devrait marcher ».

## État / en cours
- **Resume conversations au restart** — *implémenté (suites vertes), en attente de validation live*. Chaque `Session` porte un `claudeSessionId` (UUID imposé) ; spawn idempotent dans `wsl.rs` : transcript présent → `claude --resume <uuid>`, sinon `claude --session-id <uuid>`. Spec : `docs/superpowers/specs/2026-06-12-resume-claude-sessions-design.md`. Checklist live en 5 points dans le plan (`docs/superpowers/plans/2026-06-12-resume-claude-sessions.md`, Task 4).
- **Input image (drag-drop)** — *implémenté, en attente de validation live*. Fichiers : `src/terminal/{useImageDrop,termRegistry,winToWsl}.ts` + register dans `TerminalView`, hook monté dans `App`. Flux : `onDragDropEvent` (Tauri) → session `focusId` → chemin Windows→WSL → `term.paste(chemin)` (bracketed paste). **Hypothèse à confirmer en live** : `claude` attache une image sur un *paste* de chemin (pas sur un chemin tapé). À suivre : Ctrl+V presse-papier + halo visuel (skill `frontend-design`).

## Gotchas / traps
- **xterm.js ne gère PAS nativement** le drop de fichier ni le coller d'image (un vrai terminal insère le chemin tout seul, pas xterm) → intercepter et `term.paste()` le chemin WSL.
- **Routage du drop** : router par `focusId` (store), **pas** par hit-test de position (DPI fractionnaire 125/150 % + barre de titre native = coordonnées décalées).
- **ConPTY corrompt le rendu après resize** (bug Claude Code #14599) → propager SIGWINCH proprement, prévoir un redraw/`Ctrl-L`.

## Docs de référence
`docs/superpowers/specs/` (design) · `docs/superpowers/plans/` (plans). Spec principale : `docs/superpowers/specs/2026-06-02-vlaude-design.md`.
