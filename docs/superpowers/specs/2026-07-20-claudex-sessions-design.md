# Sessions claudex (Claude Code → GPT via CLIProxyAPI) — design

Date : 2026-07-20
Statut : validé par Virgile (approche A)

## But

Pouvoir ouvrir dans Vlaude des sessions **claudex** — le CLI `claude` branché sur GPT (gpt-5.6-sol) via CLIProxyAPI — à côté des sessions claude classiques, choisies par session dans `NewSessionDialog`, identifiables par un badge, et resumées avec le bon type au restart.

## Contexte

- Aujourd'hui `wsl.rs` câble en dur `exec claude` (avec `--system-prompt-file "$HOME/dt/c.md"` et resume/session-id par uuid).
- `claudex` existe chez Virgile comme **fonction zsh** (`~/.zshrc`) : env vars `ANTHROPIC_BASE_URL=http://127.0.0.1:8317`, `ANTHROPIC_AUTH_TOKEN=$(< ~/.cli-proxy-api/local.key)`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS=372000`, `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1`, `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=3`, `ENABLE_TOOL_SEARCH=false`, puis `claude --model gpt-5.6-sol "$@"`.
- Une fonction zsh ne peut pas être `exec`-ée → il faut un binaire.

## Décision (approche A)

**Script wrapper exécutable `~/.local/bin/claudex`** (hors repo Vlaude, setup une fois) :
mêmes env vars que la fonction, puis `exec claude --model gpt-5.6-sol "$@"`.
La fonction `claudex()` de `~/.zshrc` est supprimée — le script dans le PATH la remplace, l'usage terminal reste identique. **Une seule source de vérité** pour la config proxy, modifiable sans rebuild de Vlaude.

Alternatives rejetées :
- Appeler la fonction zsh sans `exec` : process claude non-exec (zsh parent), fermeture de tuile dépendante de SIGHUP.
- Config portée par Vlaude (exports dans `wsl.rs`) : duplique clé/modèle/fenêtre dans le Rust → rebuild à chaque changement.

## Changements

### Rust — `src-tauri/src/pty/wsl.rs`
- `SessionKind` gagne la variante `Claudex` (serde `"claudex"`).
- `build_wsl_argv` : les branches `Claudex` sont **identiques** aux branches `Claude` (resume si transcript `<uuid>.jsonl` présent, sinon `--session-id` ; `--system-prompt-file` conservé), seul le nom du binaire change : `claudex` au lieu de `claude`.
- TDD : tests miroirs des tests claude existants (spawn simple, resume/pin, exports env).

### Front — `src/store/sessions.ts`
- Le `kind` de session accepte `'claudex'`, persisté comme les autres champs → un restart resume une session claudex **avec claudex**.

### Front — `src/components/NewSessionDialog`
- Toggle claude / claudex (défaut : claude). Skill `frontend-design` obligatoire à l'implémentation.

### Front — badge
- Marqueur discret « GPT » sur `SessionTile` et la sidebar quand `kind === 'claudex'`. Discret : pas de redesign des tuiles.

## Hors périmètre

Squads (père/fils restent claude), réglage global, champ commande custom libre, gestion spéciale des erreurs proxy.

## Comportement en erreur

Proxy CLIProxyAPI down ou token Codex révoqué (401 connu) → le CLI affiche son erreur dans la tuile, comme n'importe quelle erreur claude. Aucun traitement Vlaude.

## Vérification (Definition of Done)

1. `npx vitest run` et `cargo test` verts (one-shots WSL→Windows habituels).
2. Live : ouvrir une session claudex → REPL répond, modèle gpt-5.6-sol confirmé (`/status` ou statusline).
3. Live : fermer/rouvrir Vlaude → la session claudex resume en claudex (badge présent, même conversation).
4. Live : une session claude classique à côté fonctionne toujours (non-régression).
5. Terminal zsh : `claudex` (le script) fonctionne toujours hors Vlaude.
