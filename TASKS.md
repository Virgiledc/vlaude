# Vlaude → Linux (Omarchy) + refonte UI Lumon

## Port Linux (Rust)
- [x] pty : lancer `bash -ic` en natif (plus de wsl.exe), TERM/COLORTERM
- [x] files.rs : home / read_file / list_dirs / index_dirs en natif
- [x] bus : dossier `~/.vlaude/bus`, install vlaude CLI + skills en natif
- [x] squad : `squad_cli` + install assets en natif
- [x] codex : contournement WSLg (`unset DISPLAY WAYLAND_DISPLAY`) retiré
- [x] `cargo test` vert (22)

## Build Linux
- [x] `npm ci` + `cargo build` OK
- [x] `npm run tauri dev` démarre sous Hyprland
- [x] binaire release + entrée lanceur `~/.local/share/applications/vlaude.desktop`

## Refonte UI (Omarchy + Lumon)
- [x] skill frontend-design, direction : tuiles = fenêtres Hyprland, inversion = « t'attend »
- [x] couleurs lues depuis le thème Omarchy courant, repli Lumon
- [x] police JetBrainsMono Nerd Font
- [x] Sidebar (workspaces intégrés, onglets supprimés), SessionTile, Canvas, NewSessionDialog, ConfirmCloseModal, SquadPanel
- [x] thème xterm aligné sur la palette, suivi en direct
- [x] raccourcis Ctrl+1…9, Ctrl+Maj+N ; décorations GTK retirées

## Vérification
- [x] `npx tsc --noEmit` + `npx vitest run` verts (159)
- [x] tuiles `claude` + `codex` qui répondent (captures grim)
- [x] `vlaude list` / `vlaude send` → claude répond PONG
- [x] reprise de conversation après relance du binaire release
- [ ] À l'écran par Virgile : dialogue Nouvelle session, escouade, drag-drop image, omp, Ctrl+1…9, Ctrl+Maj+N
- [x] CLAUDE.md mis à jour (Linux)

## Optimisation Linux (Windows abandonné, 15/10)
- [x] banc isolé `scripts/bench.py` (HOME, bus et layout à part, écran headless, `systemd-run`)
- [x] mesure de référence (repos 1,7 % / travail 35 % / flot 70 % CPU, 6 tuiles)
- [x] PTY : un seul flusher réveillé par les données (plus de tic 16 ms par tuile), premier octet tout de suite, tic 33 ms
- [x] un seul canal pour toutes les tuiles, un message par tic (`pty/frame.rs` ↔ `terminal/ptyStream.ts`)
- [x] variables WebKit / GTK / EGL mesurées : aucune gardée (DMABUF off = 126 %)
- [x] profil release (LTO, codegen-units, strip) mesuré : binaire 15,5 → 8,6 Mo mais CPU identique et build 15 s → 2 min 18 : non gardé
- [x] retirer le code Windows : `winToWsl`, `.bat`, `windows_subsystem`, noms `wsl_*`
- [x] bus `vlaude send` : inotify au lieu de sonder toutes les 300 ms (repli sondage)
- [x] fond de fenêtre GTK sans peinture (profil eu-stack : `pixman_fill` = moitié du thread GTK)
- [x] mesure après : repos 1,8 → 1,2 % (réveils 451 → 72/s), travail 34 → 21 %, flot 67 → 28 % ; `tsc`, vitest 156, `cargo test` 27, vraie tuile claude + `vlaude send` (118 ms) → PONG, captures base/après identiques
- [ ] À l'écran par Virgile : relancer Vlaude, vérifier frappe, défilement, drag-drop
- [x] CLAUDE.md à jour
