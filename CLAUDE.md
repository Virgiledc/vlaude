# Vlaude — guide projet

**Vlaude** = appli desktop **Linux (Omarchy / Hyprland)**, **Tauri 2**, qui **wrappe le vrai CLI `claude`** (et `codex`, `omp`, `claudex`) : un gestionnaire de tuiles pour **multi-gérer plusieurs agents** côte à côte. Chaque session = une instance **interactive** lancée en natif via `bash -ic`, reliée à l'app par un **pont PTY** (`portable-pty`). Le terminal affiché = **xterm.js** dans la WebView (WebKitGTK).

## ⚠️ OÙ EST LE CODE (à lire en premier)
- **Code = `~/Vlaude`** (`/home/virgile/Vlaude`), suivi par git. C'est LÀ qu'on édite.
- `~/dt/Vlaude` ne contient **que les docs/brainstorm d'origine**, pas le code.
- Historique : jusqu'au 14/10/2026 l'app tournait sous Windows + WSL (`wsl.exe`, ConPTY). Port Linux natif le 15/10 (commit de sauvegarde `bbd81da` juste avant).

## Stack
- **Tauri 2** (Rust + WebKitGTK 4.1). Rust : `portable-pty 0.9`, `tauri-plugin-opener`, `tauri-plugin-clipboard-manager`.
- **Frontend** : React 19 + TypeScript + Vite 7, **xterm.js v6** (addon-fit, addon-webgl), **zustand**, **react-grid-layout** (canvas), **dnd-kit**, **framer-motion**. Police : **JetBrainsMono Nerd Font** (police système d'Omarchy, pas de webfont).
- Tests : **vitest** + `cargo test`.

## Architecture
```
binaire Linux (Tauri 2, 1 fenêtre sans décorations : Hyprland gère le cadre)
├─ Rust (src-tauri/src/)
│   ├─ lib.rs            → commands Tauri + state PtyManager
│   ├─ pty/manager.rs    → cycle de vie PTY (`bash -ic …`, TERM=xterm-256color), un thread reader par session, un seul flusher pour toutes
│   ├─ pty/coalesce.rs   → Coalescer d'octets + délai de flush (TDD)
│   ├─ pty/frame.rs      → trame binaire multi-sessions [u16 len id][id][u32 len][octets] (TDD)
│   ├─ pty/shell.rs      → build argv `bash -ic` par type d'agent (TDD)
│   ├─ files.rs          → home, lecture fichier, liste/index de dossiers (natif)
│   ├─ theme.rs          → lit le thème Omarchy actif (TDD des parseurs)
│   ├─ bus.rs / squad.rs → bus `vlaude send`, escouade
└─ Frontend (src/)
    ├─ terminal/TerminalView.tsx → 1 xterm par session (WebGL), I/O, resize, thème xterm suivi en direct
    ├─ terminal/usePty.ts        → pont JS↔Rust (spawn/write/resize/close)
    ├─ terminal/ptyStream.ts     → canal unique `pty_attach`, décode les trames et distribue aux terminaux (TDD)
    ├─ terminal/agentState.ts    → état d'agent (working/attention/waiting/idle/exited) lu sur titre OSC + bas d'écran (TDD)
    ├─ store/sessions.ts (zustand) → sessions, workspaces, focusId, fullscreenId, layouts
    ├─ store/theme.ts            → thème Omarchy → variables CSS `--c-*` + thème xterm (TDD)
    ├─ store/{grouping,persistence,wslfs,bus,squad,reload,…}.ts
    └─ components/ Sidebar (workspaces + sessions) · Canvas · SessionTile · NewSessionDialog · ConfirmCloseModal · SquadPanel · KindLabel
```
**Pont PTY (pièce porteuse)** : `bash -ic "cd <cwd> && exec claude"` → un reader thread par session accumule les octets ANSI dans un **Coalescer** → **un seul flusher** pour toutes les sessions : il dort tant que rien n'arrive, envoie tout de suite après un silence (écho de frappe immédiat), sinon au plus une fois toutes les **33 ms**, et regroupe toutes les sessions dans **une seule trame binaire** sur **un seul Tauri Channel** (`pty_attach`). **JAMAIS** emit-par-chunk / JSON-par-octet / un tic par session (sature le CPU en multi-session). Détails : `docs/superpowers/specs/2026-06-02-vlaude-design.md`.

## Commandes Tauri (Rust ↔ front)
`pty_attach` · `pty_spawn` · `pty_write` · `pty_resize` · `pty_close` (PTY) — `home_dir` · `read_file` · `list_dirs` · `index_dirs` (fichiers, `files.rs` ↔ `src/store/files.ts`) — `save_layout` · `load_layout` — `squad_cli` — `bus_publish_tiles` — `omarchy_theme`.

## Design (refonte Omarchy + Lumon, 15/10)
- **Les tuiles imitent les fenêtres Hyprland** de Virgile : coins carrés, bordure 2 px (`--win-inactive` / `--win-active` + lueur), écart 10 px (= `gaps_in 5` ×2 et `gaps_out 10`).
- **Couleurs = thème Omarchy actif**, lu dans `~/.local/state/omarchy/current/theme/{colors.toml,kitty.conf}` (producteur : `omarchy-theme-set`). Relu au focus de la fenêtre → changer de thème dans Omarchy recolore Vlaude au retour. Repli codé en dur : Lumon. Toutes les couleurs passent par `--c-*` (`src/theme.css`) ; ne jamais coder une couleur en dur.
- **« Ça t'attend » = inversion** (fond clair, texte foncé) : barre de tuile en `attention`, bouton « N t'attend(ent) ». Lumon n'a ni rouge ni orange : l'urgence passe par la luminance, pas la teinte.
- Workspaces dans la barre latérale (plus d'onglets) : numéro = raccourci **Ctrl+1…9**, double-clic = renommer, × au survol = fermer. **Ctrl+Maj+N** = nouvelle session. Ctrl+E plein écran, Ctrl+T terminal, inchangés.
- Boutons de tuile visibles seulement au survol ou sur la tuile active.

## Lancer / dev / build (Linux)
- **Dev** : `npm run tauri dev` (ou `scripts/dev.sh [log]`). Virgile le lance lui-même (GUI longue durée).
- Typecheck : `npx tsc --noEmit` · Tests : `npx vitest run` + `cargo test --manifest-path src-tauri/Cargo.toml`.
- **Mesurer** (Linux, sans gêner Virgile) : `python3 scripts/bench.py <binaire> [--modes idle,work,flood] [--tiles 6]` lance une instance isolée (HOME, bus et layout à part, écran headless `VLTEST`, `systemd-run` pour échapper à la règle Hyprland qui renvoie une fenêtre sur le workspace de son parent) avec de faux agents (`scripts/bench_agent.py`) et sort CPU / réveils / PSS par processus et par thread ; `scripts/bench_table.py <jsonl> [-v]` les met en tableau. `scripts/profile_main.py <binaire>` échantillonne les piles du thread GTK (`eu-stack` ; le lanceur fait `prctl(PR_SET_PTRACER_ANY)` car `ptrace_scope=1`). `scripts/live_check.py <binaire>` : vraie tuile `claude` isolée, `vlaude send` puis attente de PONG, captures `grim`.
- **Build** : `npm run tauri build -- --no-bundle` → `src-tauri/target/release/vlaude`. Lanceur Omarchy : `~/.local/share/applications/vlaude.desktop` pointe sur ce binaire (Super+Espace → « Vlaude »).
- **Capture d'écran sans gêner Virgile** : lancer Vlaude avec la règle `hl.window_rule({ match = { class = "vlaude" }, workspace = "99 silent" })` (via `hyprctl eval`), puis `scripts/shot.sh <out.png>` : crée un écran headless `VLTEST`, y affiche le workspace 99, `grim`, puis retire l'écran. Les règles `eval` sautent à chaque reload Hyprland (changement de thème, édition de `~/.config/hypr/*`) ; finir par `hyprctl reload` pour ne pas laisser la règle 99 (sinon le Vlaude de Virgile s'ouvre caché).
- **Saisie clavier / fermeture dans l'instance cachée** (validé le 16/10 sur la confirmation de fermeture) : Hyprland est en config Lua, `hyprctl dispatch closewindow class:…` échoue. Cibler par adresse (`hyprctl clients -j`) : `hyprctl dispatch 'hl.dsp.window.close({ window = "address:0x…" })'` et `hyprctl dispatch 'hl.dsp.send_shortcut({ mods = "", key = "Escape", window = "address:0x…" })'`. Effet sur le focus de Virgile non mesuré ; `send_shortcut` peut laisser une touche bloquée en répétition (cf. `/usr/share/omarchy/default/hypr/bindings/clipboard.lua`).

## Conventions (non négociables)
- **Aucun commentaire dans le code** (ni `//`, ni docstrings). Le « pourquoi » va dans `docs/`.
- **TDD pour la logique pure** (`shell.rs`, `coalesce.rs`, `theme.rs`, `theme.ts`, `grouping`, `sessions`…) → vitest / `cargo test`. PTY/xterm = intégration → vérifié **par observation** (lancer + constater).
- **Modifs chirurgicales** : chaque ligne trace à la demande. Pas de refactor opportuniste.
- **Ne JAMAIS committer sans le feu vert explicite de Virgile.**
- Le **canal binaire unique + flusher unique (33 ms)** est porteur → ne jamais régresser vers de l'emit par chunk ni vers un tic par session.
- **Fenêtre GTK sans fond** (`skip_window_background` dans `lib.rs`, CSS `window { background: none; }`) : sinon GTK3 repeint au CPU tout le fond de la fenêtre à chaque image de la WebView (`pixman_fill`, la moitié du thread GTK). Ne pas retirer.

## Vérification (Definition of Done)
Rien n'est « fait » sans **preuve concrète** : vrai terminal `claude` qui répond, binaire release qui démarre, multi-session fluide observée. Pas de « ça devrait marcher ».

## État / en cours
- **Optimisation Linux** (15/10) — *mesurée, vraie tuile validée en instance isolée* ; Windows abandonné (code WSL retiré). 6 tuiles, `scripts/bench.py` : repos 1,8 → 1,2 % CPU (réveils 451 → 72/s), agents qui travaillent 34 → 21 %, sortie massive 67 → 28 %. Trois causes : un tic de 16 ms par session (→ flusher unique réveillé par les données), un message IPC par session et par tic (→ trame unique), GTK3 qui repeignait au CPU le fond de toute la fenêtre à chaque image (→ `background: none`). Essayés sans gain : `GDK_GL=always`, Skia CPU, EGL Mesa forcé, LTO ; `WEBKIT_DISABLE_DMABUF_RENDERER=1` = 126 %. Vlaude ne réveille pas le GPU NVIDIA (rendu sur l'Intel, `renderD129`). `GDK_SCALE=2` vient d'Omarchy (`monitors.lua`) pour l'écran à 1,25 : GTK3 ne sait pas le fractionnaire. **Pas vu à l'écran par Virgile** : frappe, défilement, drag-drop sur le nouveau binaire.
- **Port Linux + refonte Omarchy/Lumon** (15/10) — *validé en live* : tuiles `claude` (×2) et `codex` lancées en natif, détection d'état (barre inversée sur le prompt de confiance), `vlaude send`, reprise de conversation après relance du binaire release, thème lu depuis Omarchy. **Pas vérifié à l'écran** : dialogue « Nouvelle session » (testable désormais via `send_shortcut`, voir « Saisie clavier » plus haut), panneau escouade, drag-drop d'image, tuile `omp`, raccourcis Ctrl+1…9 / Ctrl+Maj+N.
- **Messages entre tuiles `vlaude send`** (28/09) — *validé en live sous Linux le 15/10* (`vlaude send dt …` → claude répond). CLI `~/.local/bin/vlaude` (source `bus/vlaude.py`, installé au démarrage avec le skill `skills/vlaude` dans `~/.claude/skills` + `~/.agents/skills`). Flux : le front publie les tuiles vivantes dans `~/.vlaude/bus/tiles.json` (`src/store/bus.ts`) → `vlaude send <nom> "msg"` dépose `out/*.json` {to: id, text} → `src-tauri/src/bus.rs` est réveillé par inotify (`MOVED_TO`, repli sondage 300 ms si inotify échoue) et écrit dans le PTY cible (Ctrl-U + bracketed paste, puis `\r` 150 ms après). Env par PTY : `VLAUDE_BUS` (Rust), `VLAUDE_TILE_ID` (front, tuiles agent). Pas d'escouade : Virgile n'en veut pas pour ça. **Hypothèses** : codex soumet bien un paste suivi d'un `\r` séparé, et lit `~/.agents/skills`.
- **Instances multiples** (27/09) — sélecteur « Instances » 1–6 dans `NewSessionDialog` (mode session) → `createSessions(cwd, count, name, kind)` : N sessions même dossier/workspace/agent, noms suffixés `-1..-N` si un nom est donné.
- **Refonte herdr-like + état des agents** (25/09) — *implémenté, en attente de validation live*. Panneau plugins supprimé (front + commandes Rust). Chaque `TerminalView` d'agent sonde toutes les 500 ms le titre OSC (`onTitleChange`) + l'écran courant → `detectAgentState` (règles simplifiées des manifests herdr `src/detect/manifests/{claude,codex}.toml`) → `applyDetected` → `SessionState` `working` / `attention` (bloqué : permission, question) / `waiting` (tour fini pas encore vu) / `idle` / `exited`. « Vu » = focus de la tuile (`setFocus`/`revealSession`). Sidebar = tous les workspaces, clic → `revealSession` (bascule workspace, rouvre, focus, `scrollIntoView` + focus xterm). **Limites** : `omp` n'a que le spinner braille du titre (hypothèse non vérifiée), pas de « bloqué » ; une session retirée du canvas est affichée « En pause » (son PTY est fermé au démontage). **Trap** : avant, `setSessionState` n'était jamais appelé et les classes `.vl-dot.running/.idle` ne matchaient aucun état → la pastille n'a jamais rien affiché.
- **Resume conversations au restart** — *validé en live sous Linux le 15/10* (relance du binaire → la conversation de la tuile reprend). Chaque `Session` porte un `claudeSessionId` (UUID imposé) ; spawn idempotent dans `shell.rs` : transcript présent → `claude --resume <uuid>`, sinon `claude --session-id <uuid>` avec filet (pin en erreur en <30 s → `--resume`). **Trap résolu (historique WSL)** : `wsl.exe -- …` fait passer la commande par le shell Linux par défaut, qui expanse `$HOME`, `$(find …)`, `$?` et `$rc` AVANT le `zsh -ic` interne → find vide + `rc` vide → « Session ID already in use » + `zsh:[:1: unknown condition: -ne` dans chaque tuile. Ce n'était pas un problème de cold boot. Fix : `wsl.exe --exec zsh -ic …` (la chaîne arrive intacte). Spec : `docs/superpowers/specs/2026-06-12-resume-claude-sessions-design.md`. Checklist live en 5 points dans le plan (`docs/superpowers/plans/2026-06-12-resume-claude-sessions.md`, Task 4).
- **Input image (drag-drop)** — *implémenté, en attente de validation live*. Fichiers : `src/terminal/{useImageDrop,termRegistry,winToWsl}.ts` + register dans `TerminalView`, hook monté dans `App`. Flux : `onDragDropEvent` (Tauri) → session `focusId` → chemin (inchangé sous Linux, `winToWslPath` est neutre) → `term.paste(chemin)` (bracketed paste). **Hypothèse à confirmer en live** : `claude` attache une image sur un *paste* de chemin (pas sur un chemin tapé). À suivre : Ctrl+V presse-papier + halo visuel (skill `frontend-design`).

- **Sessions `codex`** (13/09) — *implémenté, en attente de validation live*. 3e `SessionLaunchKind` (`codex`) → `shell.rs` fait `exec codex` (PATH via `bash -ic`). Libellé `codex` tuile + sidebar (`KindLabel`). **Pas de resume au restart** : `codex` n'a pas d'équivalent `--session-id` (id imposé), seulement `codex resume <uuid|nom>` ; l'uuid n'est connu qu'après lancement (`~/.codex/sessions/**/rollout-*-<uuid>.jsonl`, meta `cwd`). `resume --last` filtre par cwd → ambigu avec plusieurs tuiles même dossier. À décider si besoin.

- **Sessions `omp`** (22/09) — *implémenté, en attente de validation live*. 4e `SessionLaunchKind` (`omp`, https://omp.sh, installé via `curl -fsSL https://omp.sh/install.sh | sh -s -- --binary` → `~/.local/bin/omp`). `shell.rs` fait `exec omp`. Libellé `omp`. **Pas de resume au restart** : omp n'a que `--resume <id-prefix>` sur ses propres ids, pas de `--session-id` imposé (même limite que codex).

## Gotchas / traps
- **xterm.js ne gère PAS nativement** le drop de fichier ni le coller d'image (un vrai terminal insère le chemin tout seul, pas xterm) → intercepter et `term.paste()` le chemin.
- **Routage du drop** : router par `focusId` (store), **pas** par hit-test de position (DPI fractionnaire 125/150 % + barre de titre native = coordonnées décalées).
- **Copie codex sous WSLg (historique)** : sous Windows, codex était lancé avec `unset DISPLAY WAYLAND_DISPLAY` pour forcer le repli `powershell.exe Set-Clipboard`. **Retiré au port Linux** : codex garde `DISPLAY`/`WAYLAND_DISPLAY` et utilise le presse-papier Wayland natif.
- **`exec claude` contourne la fonction bash `claude()`** de `~/.bashrc` (qui ajoute `--plugin-dir atelier` dans Vleague/rpgfit/jv/atelier) : `exec` lance le binaire, pas la fonction. Les tuiles Vlaude n'ont donc pas le plugin atelier. Même comportement qu'avant sous WSL ; à changer seulement si Virgile le demande.
- **HMR Vite peut réinitialiser le store** (dev seulement) : modifier un module importé par `sessions.ts` recrée le store vide sans recharger le layout ; `layout.json` sur disque reste intact. Relancer l'app.
- **Copie codex = Markdown, collage clic droit mort** (29/09, *en attente de validation live*) : en mode par défaut codex possède l'écran (`?1049h`) et capture la souris (`?1000/1002/1003/1006h`) → sa copie de sélection met du **Markdown** (backticks autour du code inline, `- ` des listes) et le clic droit Vlaude sort tôt (`mouseTrackingMode !== "none"`). Fix : `shell.rs` ajoute `-c tui.fullscreen_transcript=false` → plus de capture souris ni d'alt-screen (vérifié par sonde PTY), `?2004h` gardé → xterm gère sélection/Ctrl+C/Ctrl+V/clic droit comme pour claude. Perdu : scroll/recherche intégrés de codex ; l'historique passe dans le scrollback xterm (1000 lignes par défaut).

## Docs de référence
`docs/superpowers/specs/` (design) · `docs/superpowers/plans/` (plans). Spec principale : `docs/superpowers/specs/2026-06-02-vlaude-design.md`.
