# Vlaude — Coller propre + raccourcis Ctrl+C / Ctrl+V (terminal)

Date : 2026-06-04 · Statut : design validé, implémentation à venir (vérif live requise).

## Problème
Coller dans une tuile shell (`kind=term`) affiche `^[[200~` littéral au lieu d'insérer le texte
(`[` → glob zsh → `bad pattern`). Et le copier/coller ne se comporte pas comme un terminal standard
(Windows Terminal / VS Code) : Ctrl+C/Ctrl+V attendus.

## Cause racine (vérifiée par élimination)
- **zsh disculpé** : binding `bracketed-paste` présent pour tout `TERM` (xterm-256color, dumb, vt100,
  linux, unset…), en simple ET double charge `zsh -ic 'exec zsh -i'`. `.zshrc` vanilla (oh-my-zsh `plugins=(git)`).
- **Rust disculpé** : `pty_write` écrit atomiquement (`write_all`+`flush`), zéro transfo.
- **xterm correct** : wrappe le paste car il a bien vu le `\e[?2004h` de zsh.
- **ConPTY coupable** : corrompt les marqueurs `\e[200~`/`\e[201~` sur le chemin d'ENTRÉE (terminal→WSL),
  donc zsh ne reçoit jamais un `^[[200~` propre à stripper. Même bug que WezTerm avec le même crate
  `portable-pty` (#3510) ; Microsoft classe sa part « Resolution-External ».

## Fix natif écarté
- `windowsPty` (xterm) = scrollback/reflow uniquement, rien à voir avec le paste.
- `portable-pty` déjà en 0.9.0 (courant), aucun fix connu du bracketed-paste-input ConPTY.
- Faire survivre le bracketed paste à ConPTY = ce que WezTerm ne fait qu'en *bypassant* ConPTY.
  Effort élevé, chances faibles → écarté.

## Décision : fix app-level, scopé par type de tuile

### Partie 1 — Coller propre
`src/terminal/TerminalView.tsx`, options du `Terminal` : `ignoreBracketedPasteMode: kind === "term"`.
- `term` → `true` : xterm n'ajoute plus les marqueurs → texte brut → `^[[200~` mort.
- `claude` → `false` (défaut) : bracketed paste gardé (input image `term.paste()`, rétention multi-lignes).

### Partie 2 — Raccourcis (parité terminal standard)
`term.attachCustomKeyEventHandler(...)` :
- **Ctrl+C** (sans Shift/Alt) : sélection → copie + vide la sélection, on ne transmet pas ; sinon → `\x03` (SIGINT).
- **Ctrl+V** (sans Shift/Alt) : lit le presse-papier → `term.paste(texte)`.
- **Ctrl+Shift+C / Ctrl+Shift+V** : inchangés.
- Presse-papier : `navigator.clipboard` si utilisable dans la WebView Tauri, sinon `@tauri-apps/plugin-clipboard-manager`.

## Definition of Done (vérif live, pas « ça devrait marcher »)
Tuile shell : coller branche → propre, pas de `^[[200~` · Ctrl+C avec sélection → copie · Ctrl+C sans
sélection pendant qu'une commande tourne → l'interrompt · Ctrl+V → colle. Tuile claude : claude tourne,
comportement de coller inchangé.

Référence cause racine : `projects/vlaude/conpty-corrompt-bracketed-paste-input-pas-zsh` (vault).
