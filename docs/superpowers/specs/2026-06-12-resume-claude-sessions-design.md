# Vlaude — Reprise automatique des conversations Claude au restart

- **Date** : 2026-06-12
- **Statut** : validé (brainstorming) → prêt pour le plan d'implémentation
- **Auteur** : Virgile + Claude

---

## 1. Problème & objectif

Quand le PC ou WSL crash (ou que Vlaude est simplement fermé), Vlaude restaure déjà les tuiles dans le bon répertoire, mais chaque `claude` respawné démarre une **conversation vierge** : Virgile doit refaire `/resume` à la main dans chaque tuile pour retrouver la bonne discussion.

**Objectif** : au redémarrage de Vlaude, chaque tuile rouvre **sa** conversation Claude exactement là où elle en était — y compris après un kill brutal (crash PC/WSL, pas de clean exit).

**Critère vérifiable** : créer une tuile → discuter → fermer Vlaude (ou tuer `wsl.exe`) → rouvrir Vlaude → la tuile affiche la même conversation, sans action manuelle. Idem avec 2 tuiles sur le même dossier : chacune retrouve la sienne.

## 2. Faits vérifiés (sémantique du CLI `claude`)

Vérifié empiriquement dans le WSL cible (tests `--print` + inspection `~/.claude/projects/` + doc officielle `code.claude.com/docs/en/sessions.md`) :

- `claude --session-id <uuid>` impose l'ID de session au lancement. Exige un **UUID valide** (sinon exit 1 `Invalid session ID. Must be a valid UUID.`).
- `claude --resume <uuid>` reprend la conversation **sous le même ID** (pas de fork — le fork est opt-in via `--fork-session`). L'UUID stocké reste donc valide à travers N reprises.
- `claude --resume <uuid>` sur un ID sans transcript → exit 1 `No conversation found with session ID: …` (pas de fallback interactif).
- Transcripts : `~/.claude/projects/<cwd-encodé>/<session-id>.jsonl`. L'encodage du cwd est interne à Claude (non documenté pour `.`/`_` → on ne le recalcule pas).
- Un transcript **survit à un kill brutal** du process (crash WSL) et reste reprenable.
- **Hypothèse résiduelle à confirmer en live** (Definition of Done) : la stabilité de l'ID au resume a été vérifiée en `--print` + doc ; à constater une fois en interactif dans une tuile Vlaude.

## 3. Décisions verrouillées (brainstorming du 2026-06-12)

| Sujet | Décision | Raison courte |
|---|---|---|
| Identification de la conversation | **UUID imposé par Vlaude au spawn** (`--session-id` puis `--resume`) | Déterministe, crash-safe, supporte N tuiles sur le même cwd (squads) ; rejeté : découverte par mtime (ambigu multi-tuiles), hook SessionStart (modifie `~/.claude/settings.json`, invasif) |
| Migration des tuiles antérieures à la feature | **Conversation neuve** (UUID généré à l'hydratation) | Une dernière fois `/resume` manuel ; zéro heuristique, zéro risque de mauvais mapping ; rejeté : `--continue` (faux si claude utilisé hors Vlaude dans le dossier) |
| Forme de la commande | **Template shell unique idempotent** (if transcript existe → `--resume`, sinon → `--session-id`) | Même commande à la création et aux relances → aucune machine à états côté TS ; gère aussi le transcript purgé |
| Localisation du transcript | `find` par nom de fichier `<uuid>.jsonl` (maxdepth 2), **pas** de recalcul du chemin encodé | UUID globalement unique → zéro dépendance à l'encodage interne de Claude |

## 4. Conception

### 4.1 Données & persistance — `src/store/sessions.ts`

- `Session` gagne un champ **requis** `claudeSessionId: string`, fixé à la création, immuable.
- Nouveau helper `newUuid()` : `crypto.randomUUID()` si dispo, sinon fallback **UUID v4 valide** construit sur `Math.random`. (Le fallback de `newId()` existant n'est pas un UUID et `claude` rejette les ID non-UUID — c'est pourquoi `newId()` n'est pas réutilisé.)
- `createSession` (sessions.ts:83) pose `claudeSessionId: newUuid()`. Point de création **unique** : les squads passent par lui (`squad.ts:117` père, `squad.ts:140` fils) → tout est couvert.
- `hydrate` (sessions.ts:193) : `claudeSessionId: s.claudeSessionId ?? newUuid()` → migration silencieuse des `layout.json` antérieurs (ces tuiles repartent une fois sur une conversation neuve).
- `PersistedSnapshot` sérialise les `Session` complets → le champ est persisté sans changement de schéma ni bump de version. Sauvegarde continue existante (debounce 500 ms) → l'UUID est sur disque quasi immédiatement après création (fenêtre de perte ≤ 500 ms sur une tuile vieille de quelques secondes : acceptable).

### 4.2 Commande de spawn — `src-tauri/src/pty/wsl.rs` (TDD)

`build_wsl_argv` gagne un paramètre `claude_session_id: Option<&str>`.

Pour `kind=Claude` + `Some(uuid)`, la partie lancement devient (sur une ligne, `<uuid>` et `<uuid>.jsonl` échappés via `single_quote`) :

```sh
cd '<cwd>' && [exports squad &&] \
if [ -n "$(find "$HOME/.claude/projects" -maxdepth 2 -name '<uuid>.jsonl' -print -quit 2>/dev/null)" ]; \
then exec claude --resume '<uuid>'; \
else exec claude --session-id '<uuid>'; fi
```

Propriétés :
- `exec` préservé dans les deux branches → fermer le PTY tue toujours claude (contrat existant).
- Les exports squad précèdent le `if` → valables dans les deux branches.
- `~/.claude/projects` absent (machine vierge) → `find` échoue en silence (`2>/dev/null`) → branche `--session-id`.
- `-print -quit` : stop au premier match, coût négligeable à chaque spawn.
- `(Claude, None)` → `exec claude` inchangé (compat) ; `(Term, _)` → `exec zsh -i` inchangé.
- Le doc-comment existant de `build_wsl_argv` est mis à jour (contrat resume + pourquoi `find`).

### 4.3 Plomberie de l'UUID (front → Rust)

```
SessionTile.tsx:96  prop claudeSessionId={session.claudeSessionId}   (TerminalView kind="claude" SEULEMENT)
  → TerminalView.tsx:77  createPty(…, claudeSessionId)
    → usePty.ts:23  invoke("pty_spawn", { …, claudeSessionId })      (camelCase → snake_case Tauri)
      → lib.rs pty_spawn(…, claude_session_id: Option<String>)
        → manager.rs spawn(…)
          → wsl.rs build_wsl_argv(…, claude_session_id.as_deref())
```

Le second PTY d'une tuile (`id + ":term"`, kind=term) ne reçoit **pas** d'UUID. Aucun changement au Channel binaire / coalescing 16 ms.

### 4.4 Comportements obtenus

| Scénario | Comportement |
|---|---|
| Fermeture Vlaude / crash PC / crash WSL | Au boot, chaque tuile respawne avec `--resume <uuid>` → retrouve sa conversation |
| Tuile jamais utilisée puis restart | Pas de `.jsonl` → `--session-id` → conversation neuve, même UUID, toujours trackée |
| Transcript purgé par Claude (cleanup périodique) | `find` vide → repart proprement en `--session-id`, même UUID |
| 2+ tuiles sur le même dossier (squads) | UUIDs distincts → conversations distinctes, zéro entremêlement |
| claude exited dans la tuile, puis restart app | Transcript intact → resume normal |
| Fermeture volontaire d'une tuile | Comme aujourd'hui (session supprimée ; transcript géré par Claude) |

### 4.5 Limitations actées (hors périmètre)

- **`/resume` manuel dans une tuile** : non suivi. Au restart, la tuile rouvre sa conversation d'origine. (Le suivi exigerait le hook SessionStart, rejeté comme invasif. Devient inutile dès que la feature existe : plus besoin de `/resume` manuel.)
- **Bouton « nouvelle conversation »** : non. `/clear` dans claude suffit.
- **Toggle de désactivation** : non. C'est le comportement attendu par défaut.
- **Bouton `/clear` de la tuile** : si `/clear` change l'ID interne de claude, un restart rouvrirait l'état pré-clear (pas de perte de données ; à constater en live, wrinkle accepté).

## 5. Tests

### 5.1 `cargo test` — `wsl.rs` (TDD, tests d'abord)

- Claude + `Some(uuid)` → argv exact avec le template conditionnel (`find` + `--resume` + `--session-id`).
- Claude + `None` → `cd '<cwd>' && exec claude` inchangé.
- Term + `Some(uuid)` → UUID ignoré, `exec zsh -i`.
- Exports squad + uuid → ordre `cd && export … && if …`.
- Échappement : uuid passé par `single_quote` (idem cwd).
- Tests existants mis à jour pour la nouvelle signature.

### 5.2 `vitest` — `sessions.ts`

- `createSession` pose un `claudeSessionId` au format UUID v4 (regex), y compris via le fallback sans `crypto.randomUUID`.
- `hydrate` préserve un `claudeSessionId` existant ; en génère un pour un snapshot ancien qui n'en a pas.
- Deux sessions créées dans le même cwd → UUIDs distincts.

### 5.3 Observation live (Definition of Done)

1. Créer une tuile → discuter avec claude → fermer Vlaude → rouvrir → **la conversation est là**.
2. Idem après kill brutal de `wsl.exe` (simulation crash).
3. 2 tuiles sur le même dossier → chacune retrouve la sienne.
4. Tuile neuve jamais utilisée → restart → claude démarre normalement (branche `--session-id`).
5. Confirmer en interactif que l'ID reste stable après resume (cf. §2 hypothèse résiduelle).

## 6. Fichiers touchés

| Fichier | Changement |
|---|---|
| `src/store/sessions.ts` | `Session.claudeSessionId`, `newUuid()`, `createSession`, `hydrate` |
| `src/store/sessions.test.ts` | tests §5.2 (fichier existant, tests ajoutés) |
| `src/components/SessionTile.tsx` | prop vers le TerminalView claude |
| `src/terminal/TerminalView.tsx` | prop → `createPty` |
| `src/terminal/usePty.ts` | param + arg `pty_spawn` |
| `src-tauri/src/lib.rs` | param `claude_session_id` de `pty_spawn` |
| `src-tauri/src/pty/manager.rs` | forward vers `build_wsl_argv` |
| `src-tauri/src/pty/wsl.rs` | template conditionnel + tests §5.1 |
