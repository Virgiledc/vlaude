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
│   └─ wslfs.rs          → helpers WSL (home, list/index dirs, lecture fichier)
└─ Frontend (src/)
    ├─ terminal/TerminalView.tsx → 1 xterm par session (WebGL), I/O, resize
    ├─ terminal/usePty.ts        → pont JS↔Rust (Channel Uint8Array)
    ├─ terminal/agentState.ts    → état d'agent (working/blocked/idle) lu sur titre OSC + bas d'écran (TDD)
    ├─ store/sessions.ts (zustand) → sessions, workspaces, focusId, fullscreenId, layouts
    ├─ store/{grouping,persistence,wslfs}.ts
    └─ components/ Sidebar · Canvas · WorkspaceTabs · SessionTile · NewSessionDialog · ConfirmCloseModal · SquadPanel
```
**Pont PTY (pièce porteuse)** : `wsl.exe -- bash -lic "cd <cwd> && exec claude"` → un reader thread accumule les octets ANSI dans un **Coalescer** → un ticker **flush toutes les ~16 ms** vers le front via un **Tauri Channel binaire**. **JAMAIS** emit-par-chunk / JSON-par-octet (sature le CPU en multi-session). Détails : `docs/superpowers/specs/2026-06-02-vlaude-design.md`.

## Commandes Tauri (Rust ↔ front)
`pty_spawn` · `pty_write` · `pty_resize` · `pty_close` (PTY) — `wsl_home` · `wsl_read_file` · `list_wsl_dirs` · `index_wsl_dirs` (WSL) — `save_layout` · `load_layout` — `squad_cli`.

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
- **Messages entre tuiles `vlaude send`** (28/09) — *implémenté, en attente de validation live*. CLI WSL `~/.local/bin/vlaude` (source `bus/vlaude.py`, installé au démarrage avec le skill `skills/vlaude` dans `~/.claude/skills` + `~/.agents/skills`). Flux : le front publie les tuiles vivantes dans `%USERPROFILE%\.vlaude\bus\tiles.json` (`src/store/bus.ts`) → `vlaude send <nom> "msg"` dépose `out/*.json` {to: id, text} → `src-tauri/src/bus.rs` sonde `out/` toutes les 300 ms et écrit dans le PTY cible (Ctrl-U + bracketed paste, puis `\r` 150 ms après). Env par PTY : `VLAUDE_BUS` (Rust), `VLAUDE_TILE_ID` (front, tuiles agent). Pas d'escouade : Virgile n'en veut pas pour ça. **Hypothèses** : codex soumet bien un paste suivi d'un `\r` séparé, et lit `~/.agents/skills`.
- **Instances multiples** (27/09) — sélecteur « Instances » 1–6 dans `NewSessionDialog` (mode session) → `createSessions(cwd, count, name, kind)` : N sessions même dossier/workspace/agent, noms suffixés `-1..-N` si un nom est donné.
- **Refonte herdr-like + état des agents** (25/09) — *implémenté, en attente de validation live*. Panneau plugins supprimé (front + commandes Rust). Chaque `TerminalView` d'agent sonde toutes les 500 ms le titre OSC (`onTitleChange`) + l'écran courant → `detectAgentState` (règles simplifiées des manifests herdr `src/detect/manifests/{claude,codex}.toml`) → `applyDetected` → `SessionState` `working` / `attention` (bloqué : permission, question) / `waiting` (tour fini pas encore vu) / `idle` / `exited`. « Vu » = focus de la tuile (`setFocus`/`revealSession`). Sidebar = tous les workspaces, clic → `revealSession` (bascule workspace, rouvre, focus, `scrollIntoView` + focus xterm). **Limites** : `omp` n'a que le spinner braille du titre (hypothèse non vérifiée), pas de « bloqué » ; une session retirée du canvas est affichée « En pause » (son PTY est fermé au démontage). **Trap** : avant, `setSessionState` n'était jamais appelé et les classes `.vl-dot.running/.idle` ne matchaient aucun état → la pastille n'a jamais rien affiché.
- **Resume conversations au restart** — *implémenté, fix `--exec` du 10/09 en attente de validation live*. Chaque `Session` porte un `claudeSessionId` (UUID imposé) ; spawn idempotent dans `wsl.rs` : transcript présent → `claude --resume <uuid>`, sinon `claude --session-id <uuid>` avec filet (pin en erreur en <30 s → `--resume`). **Trap résolu** : `wsl.exe -- …` fait passer la commande par le shell Linux par défaut, qui expanse `$HOME`, `$(find …)`, `$?` et `$rc` AVANT le `zsh -ic` interne → find vide + `rc` vide → « Session ID already in use » + `zsh:[:1: unknown condition: -ne` dans chaque tuile. Ce n'était pas un problème de cold boot. Fix : `wsl.exe --exec zsh -ic …` (la chaîne arrive intacte). Spec : `docs/superpowers/specs/2026-06-12-resume-claude-sessions-design.md`. Checklist live en 5 points dans le plan (`docs/superpowers/plans/2026-06-12-resume-claude-sessions.md`, Task 4).
- **Input image (drag-drop)** — *implémenté, en attente de validation live*. Fichiers : `src/terminal/{useImageDrop,termRegistry,winToWsl}.ts` + register dans `TerminalView`, hook monté dans `App`. Flux : `onDragDropEvent` (Tauri) → session `focusId` → chemin Windows→WSL → `term.paste(chemin)` (bracketed paste). **Hypothèse à confirmer en live** : `claude` attache une image sur un *paste* de chemin (pas sur un chemin tapé). À suivre : Ctrl+V presse-papier + halo visuel (skill `frontend-design`).

- **Sessions `codex`** (13/09) — *implémenté, en attente de validation live*. 3e `SessionLaunchKind` (`codex`) → `wsl.rs` fait `exec codex` (PATH nvm via `zsh -ic`). Badge `CODEX` tuile + sidebar. **Pas de resume au restart** : `codex` n'a pas d'équivalent `--session-id` (id imposé), seulement `codex resume <uuid|nom>` ; l'uuid n'est connu qu'après lancement (`~/.codex/sessions/**/rollout-*-<uuid>.jsonl`, meta `cwd`). `resume --last` filtre par cwd → ambigu avec plusieurs tuiles même dossier. À décider si besoin.

- **Sessions `omp`** (22/09) — *implémenté, en attente de validation live*. 4e `SessionLaunchKind` (`omp`, https://omp.sh, installé dans WSL via `curl -fsSL https://omp.sh/install.sh | sh -s -- --binary` → `~/.local/bin/omp`). `wsl.rs` fait `exec omp`. Badge `OMP`. **Pas de resume au restart** : omp n'a que `--resume <id-prefix>` sur ses propres ids, pas de `--session-id` imposé (même limite que codex).

## Gotchas / traps
- **xterm.js ne gère PAS nativement** le drop de fichier ni le coller d'image (un vrai terminal insère le chemin tout seul, pas xterm) → intercepter et `term.paste()` le chemin WSL.
- **Routage du drop** : router par `focusId` (store), **pas** par hit-test de position (DPI fractionnaire 125/150 % + barre de titre native = coordonnées décalées).
- **ConPTY corrompt le rendu après resize** (bug Claude Code #14599) → propager SIGWINCH proprement, prévoir un redraw/`Ctrl-L`.
- **Copie codex cassée par WSLg** (29/09) : codex capture la souris et copie lui-même (sélection au relâché / Ctrl+C) via `arboard` → presse-papier X11/Wayland de WSLg, qui ne remonte pas à Windows (`msrdc.exe` crash-loop dans `/mnt/wslg/stderr.log`) → « Copy failed · try again » après le timeout 5 s. Fix : `wsl.rs` lance codex avec `unset DISPLAY WAYLAND_DISPLAY` → arboard échoue vite → fallback codex `powershell.exe Set-Clipboard`. Effet de bord : les commandes lancées par l'agent codex n'ont plus de `DISPLAY` (GUI Linux headed).
- **Copie codex = Markdown, collage clic droit mort** (29/09, *en attente de validation live*) : en mode par défaut codex possède l'écran (`?1049h`) et capture la souris (`?1000/1002/1003/1006h`) → sa copie de sélection met du **Markdown** (backticks autour du code inline, `- ` des listes) et le clic droit Vlaude sort tôt (`mouseTrackingMode !== "none"`). Fix : `wsl.rs` ajoute `-c tui.fullscreen_transcript=false` → plus de capture souris ni d'alt-screen (vérifié par sonde PTY), `?2004h` gardé → xterm gère sélection/Ctrl+C/Ctrl+V/clic droit comme pour claude. Perdu : scroll/recherche intégrés de codex ; l'historique passe dans le scrollback xterm (1000 lignes par défaut).

## Docs de référence
`docs/superpowers/specs/` (design) · `docs/superpowers/plans/` (plans). Spec principale : `docs/superpowers/specs/2026-06-02-vlaude-design.md`.
