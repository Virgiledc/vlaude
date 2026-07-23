# Vlaude — Bouton « reload » : handoff de contexte vers une session vierge

- **Date** : 2026-06-17
- **Statut** : validé (brainstorming) → prêt pour le plan d'implémentation
- **Auteur** : Virgile + Claude

---

## 1. Problème & objectif

Quand le contexte d'une session claude est saturé, la conversation se dégrade (oublis, suggestions déjà rejetées, régressions). La seule sortie aujourd'hui est manuelle : demander un récap, ouvrir une nouvelle tuile, recoller le récap à la main — et le savoir durable de la session est perdu.

**Objectif** : un bouton « reload » sur la tuile qui (a) demande à claude un récap de handoff court et actionnable, (b) persiste le savoir durable dans le vault, (c) repart sur une session claude **vierge** dans la même tuile, (d) y pré-remplit le récap **sans l'envoyer** pour relecture.

**Critère vérifiable** : sur une tuile en plein travail, cliquer « reload » → claude écrit son handoff + ses notes vault → la tuile bascule sur une conversation neuve → le récap apparaît dans l'input, **non soumis** → un appui sur Entrée relance le travail avec le contexte transmis. Si claude ne termine pas, la session d'origine reste **intacte** (aucun clear).

## 2. Faits vérifiés (codebase actuel)

Vérifiés par exploration + lecture directe des fichiers porteurs :

- **La « gomme »** (`SessionTile.tsx`, bouton `title="/clear"`) n'efface pas xterm : elle envoie le texte `/clear\r` au PTY via `sendCommand(id, cmd)` → `pty_write`. C'est une commande claude, pas un `term.clear()`.
- **Injecter un prompt est déjà résolu** : `injection.ts` expose `featurePayload(text)` = `\x15\x1b[200~…\x1b[201~\r` (Ctrl-U + bracketed paste + Entrée) ; `squad.ts` `sendFeature` l'écrit via `pty_write`. Réutilisable tel quel pour soumettre le prompt de récap.
- **Clear = nouvel UUID, vérifié** : `TerminalView` (l.119) a `claudeSessionId` dans les deps de son `useEffect` ; le cleanup (l.108-118) fait `pty.close()` + `term.dispose()`. Changer `claudeSessionId` ⇒ close de l'ancien PTY + re-spawn. La tuile (`id`) ne change pas → layout/registre préservés.
- **Session vierge garantie** : un UUID neuf n'a pas de transcript `<uuid>.jsonl`, donc le template idempotent de `wsl.rs` (`build_wsl_argv`) lance `claude --session-id <neuf>` (et non `--resume`) = contexte vide.
- **« Session prête à recevoir l'input »** est déjà détectable : `readyScan.ts` `createMarkerScanner` repère le `READY_MARKER` = `❯ ` (prompt claude). Aujourd'hui le scanner n'est branché **que** si `squad.injection[id]` existe (`TerminalView` l.71).
- **Pré-remplir sans soumettre** : `getTerm(id)` (`termRegistry.ts`) rend le `Terminal` xterm ; `term.paste(text)` insère dans l'input via bracketed paste **sans `\r`** — exactement le pattern de `useImageDrop` (`term.paste(chemin)`).
- **Pas de détection « claude a fini »** : `setSessionState` (`sessions.ts`) est du dead code (zéro appelant prod). Vlaude ne connaît pas l'état working/waiting → il faut un signal explicite. → choix du signal **fichier** (§3).
- **Pas d'accès vault ni de read-file WSL générique** : commandes exposées = `pty_*`, `wsl_home`, `list_wsl_dirs`, `list_claude_plugins`, `save/load_layout`, `save/load_plugin_favorites`, `squad_cli`. Le helper interne `run_wsl(script)` (`wslfs.rs`) existe → base pour une commande `wsl_read_file`.
- **System-prompt de ces sessions** = `--system-prompt-file "$HOME/dt/c.md"` (system-prompt de l'app chat, pas un contexte « métier vault »). → le prompt injecté **ne doit rien supposer** du system-prompt ni des CLAUDE.md : il est autosuffisant.

**Hypothèses résiduelles à confirmer en live (Definition of Done)** :
- Le paste d'un handoff multi-lignes reste éditable et **non soumis** dans l'input claude (prouvé pour un chemin court via `useImageDrop` ; à constater sur un texte plus long).
- Ces sessions peuvent écrire dans le vault (`/mnt/c/Users/VirgileDc/Documents/virgile`) : FS accessible, outils file présents ; le réindex `qmd` reste optionnel.

## 3. Décisions verrouillées (brainstorming du 2026-06-17)

| Sujet | Décision | Raison courte |
|---|---|---|
| Récupération du récap | **claude écrit un fichier de handoff, Vlaude le lit** | Déterministe ; le code transporte, le LLM juge. Rejeté : capture/parsing du flux terminal (ANSI, spinners, fin de réponse indécidable). |
| Signal de fin | **Fichier sentinelle `.done` écrit en dernier + polling** | Net et déterministe. Rejeté : sentinelle texte dans le flux (faux positif si claude cite le marqueur) ; heuristique de silence (timing fragile). |
| Clear de la session | **Régénération du `claudeSessionId`** (re-mount PTY via deps `useEffect`) | Mécanisme déjà câblé et vérifié. Rejeté : `/clear` (claude garde l'historique interne, ne vide pas vraiment) ; close+create (perd la tuile/layout). |
| Reprise dans la session vierge | **Pré-remplissage non soumis via `term.paste()`** | Filet de sécurité : un mauvais handoff ne part pas seul. Rejeté : auto-envoi (aucun filet) ; pointeur `@fichier` (Virgile veut le texte dans l'input). |
| Détection « session vierge prête » | **`READY_MARKER` + `createMarkerScanner` existants** | Déjà éprouvé par squad. Rejeté : délai fixe (fragile selon la latence de boot). |
| Emplacement du handoff | **`~/.vlaude/handoffs/<claudeSessionId>.md` (+ `.done`)**, hors repo | Pas de pollution git, clé par session. Rejeté : fichier dans le cwd. |
| Contenu vault | **Critères de persistance de Virgile** (trap/archi/mécanisme ; une note = une claim) | Pas de dump. Le prompt injecté rappelle les critères (autosuffisant). |
| Sessions squad | **Hors périmètre** pour cette itération | Elles portent déjà de l'injection ; un reload dessus s'étudie à part. |

## 4. Conception

### 4.1 UI — `src/components/SessionTile.tsx`

Nouveau bouton inséré **juste après** le bouton `/clear`, même pattern (`className="cmd"`, `e.stopPropagation()`, SVG `viewBox="0 0 24 24"` stroke 2 — icône deux flèches circulaires « refresh »). `title="reload — récap → session vierge"`.

`onClick` → `useReload.getState().startReload(session.id)`. État visuel piloté par le store reload : phase active → classe `pending` (animation `vl-breathe` existante) ; échec → classe `failed` (rouge) quelques secondes. Aucune nouvelle règle CSS nécessaire (`.cmd.pending` / `.cmd.failed` existent déjà dans `SessionTile.css`).

### 4.2 Orchestrateur — `src/store/reload.ts` (NOUVEAU)

Store zustand calqué sur `squad.ts` / `injection.ts` (polling périodique, timeouts purs et testables). Machine à états **par session** :

```
idle → recapping → clearing → prefilling → done
                 ↘ error (timeout / fichier manquant / PTY mort)
```

- `startReload(id)` : refuse si déjà actif sur `id`. Calcule `handoffPath`/`donePath` (via `wsl_home` + `claudeSessionId`). Injecte le prompt (§4.3) avec `featurePayload`. Passe en `recapping`, note `startedAt`.
- **poll** (~800 ms) : en `recapping`, lit `donePath` via `wsl_read_file`. Non-null → lit `handoffPath` ; si vide/illisible → `error`. Sinon mémorise le handoff, passe en `clearing` **puis** appelle `respawnSession(id)` (ordre important : l'état `clearing` doit être posé avant le re-mount, cf. §4.5). Timeout (`RECAP_TIMEOUT_MS`, ~180 s) → `error`, **sans clear**.
- `onReady(id)` (appelé par le scanner, §4.5) : en `clearing` → `getTerm(id)?.paste(handoff)` → `prefilling` → `done`. La soumission reste à l'utilisateur.
- État dérivé exposé pour le rendu du bouton.

### 4.3 Prompt injecté (autosuffisant) — template dans `reload.ts`

`handoffPath`/`donePath` sont des chemins **absolus** résolus par Vlaude (pas de `$HOME`/`~` non expansé dans le texte) :

```
Le contexte de cette session est saturé. Avant que je reparte sur une session vierge,
fais exactement ceci, dans cet ordre, sans me poser de question :

1. Écris un handoff de reprise dans {handoffPath} (écrase s'il existe). Court mais
   actionnable — c'est le PROMPT qui démarrera la prochaine session, pas un journal.
   Contenu : objectif en cours, état/avancement réel, fichiers clés touchés (chemin:ligne),
   prochaine étape concrète, pièges/contraintes à ne pas réoublier.

2. Persiste dans le vault Obsidian uniquement le savoir durable, selon tes critères
   habituels (trap résolu, décision d'archi avec tradeoffs, mécanisme du codebase
   découvert, contournement de limitation) — une note = une claim, rien de trivial.
   S'il n'y a rien qui mérite, skip.

3. EN TOUT DERNIER, une fois 1 et 2 faits, écris {donePath} (contenu : ok).
```

### 4.4 Clear = respawn — `src/store/sessions.ts`

Nouvelle action `respawnSession(id)` : régénère `claudeSessionId: newUuid()` pour la seule session ciblée (immutable ailleurs). Aucun autre champ touché. Le re-mount du PTY est un effet de bord du changement de prop (§2). Pas de close/spawn manuel.

### 4.5 Détection « session vierge prête » — `src/terminal/TerminalView.tsx`

La condition de branchement du scanner (l.71) est généralisée : on instancie aussi un `createMarkerScanner` quand `useReload.getState().isClearing(id)` est vrai (en plus du cas squad). Au `READY_MARKER`, le callback route vers le bon store (`squad.markReady` ou `reload.onReady`). Comme `respawnSession` est appelé **après** le passage en `clearing`, le nouveau montage voit l'état `clearing` et branche le scanner.

### 4.6 Lecture de fichier — `src-tauri/src/` (Rust)

Nouvelle commande `wsl_read_file(path: String) -> Result<Option<String>, String>` (dans `wslfs.rs`, enregistrée dans `lib.rs` `invoke_handler`) : via `run_wsl`, `cat` le fichier ; absent → `Ok(None)` ; erreur réelle → `Err`. Générique et réutilisable, sert au poll du `.done` et à la lecture du `.md`.

### 4.7 Comportements & garde-fous

| Scénario | Comportement |
|---|---|
| Nominal | handoff + vault écrits → `.done` → respawn → `❯ ` → récap pré-rempli **non soumis** |
| Timeout (claude ne finit pas) | `error`, session d'origine **intacte**, bouton `failed` |
| `.done` présent mais `.md` vide/illisible | `error`, **pas de clear** |
| Re-clic pendant l'opération | ignoré |
| claude exited / PTY mort pendant le récap | `error`, pas de clear |
| Vlaude fermé en plein milieu | l'opération (état transitoire) n'est pas persistée ; au restart la tuile reprend via resume normal. Le handoff sur disque reste récupérable. |

### 4.8 Hors périmètre (actés)

- **Sessions squad** : non couvertes cette itération.
- **Cleanup des vieux handoffs** : non (YAGNI ; fichiers courts dans `~/.vlaude/handoffs/`).
- **Réindex `qmd` auto** après écriture vault : optionnel ; peut être ajouté au prompt injecté plus tard, non bloquant.
- **Toggle de désactivation** : non.

## 5. Tests

### 5.1 `vitest` — `src/store/reload.ts` (logique pure, TDD)

- Machine à états : `recapping`→`clearing` seulement quand `.done` lu et `.md` non vide ; timeout → `error` sans transition vers `clearing` (donc **aucun** `respawnSession`).
- `startReload` refuse un second déclenchement sur une session déjà active.
- Construction des chemins/prompt : `handoffPath`/`donePath` corrects pour un `claudeSessionId` donné ; le prompt contient les deux chemins.
- `onReady` ne pré-remplit que depuis l'état `clearing`.

### 5.2 `vitest` — `src/store/sessions.ts`

- `respawnSession(id)` change `claudeSessionId` (nouveau UUID v4) de la **seule** session ciblée ; les autres champs et les autres sessions sont inchangés.

### 5.3 `cargo test` — `wsl_read_file`

- Fichier présent → `Ok(Some(contenu))` ; absent → `Ok(None)` ; (selon faisabilité) chemin illisible → `Err`.

### 5.4 Observation live (Definition of Done)

1. Tuile en travail → clic reload → claude écrit handoff + (le cas échéant) note vault → `.done`.
2. La tuile bascule sur une conversation **neuve** (vérifier : claude ne « se souvient » plus du fil précédent).
3. Le récap apparaît dans l'input **non soumis** ; Entrée relance le travail avec le contexte.
4. Cas d'échec : couper claude avant la fin → la session d'origine reste intacte, pas de clear, bouton `failed`.
5. Confirmer l'écriture effective dans le vault (note présente, conforme aux critères).

## 6. Fichiers touchés

| Fichier | Changement |
|---|---|
| `src/components/SessionTile.tsx` | bouton reload (après `/clear`) + états visuels pilotés par reload |
| `src/store/reload.ts` | **NOUVEAU** — orchestrateur (machine à états, poll, prompt, chemins) |
| `src/store/reload.test.ts` | **NOUVEAU** — tests §5.1 |
| `src/store/sessions.ts` | action `respawnSession(id)` |
| `src/store/sessions.test.ts` | test §5.2 (fichier existant) |
| `src/terminal/TerminalView.tsx` | branchement du scanner `READY` aussi en phase `clearing` (généralise l.71) |
| `src-tauri/src/wslfs.rs` | commande `wsl_read_file` (+ tests §5.3) |
| `src-tauri/src/lib.rs` | enregistrement de `wsl_read_file` dans `invoke_handler` |
