# Escouade Voie A — enrôlement au spawn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finir l'escouade père/fils jusqu'à un `.exe` testable où Virgile crée une escouade, lance un père + des fils **déjà enrôlés** (token posé dans l'env au spawn), et voit le **tableau live** (membres alive/gone + lots todo/claimed/submitted/verified) dans un panneau monté dans l'app.

**Architecture :** le **bus SQLite** (existant, 31 tests) gagne 3 commandes CLI (`init`, `add-member`, `view` read-only). Le **Rust** pose les `VLAUDE_SQUAD_*` dans l'argv WSL au spawn, expose `squad_cli` (lance le bus via `wsl.exe` et renvoie le JSON) et `install_squad_assets` (copie `squad.py` + skills côté WSL). Le **front** poll `view` (~700 ms) → `SquadState`, branche `SquadPanel`, et ajoute une UI minimale « créer escouade / ajouter un fils ». Liens **volatiles** (pas de persistance, spec §10.3).

**Tech Stack :** Tauri 2 (Rust + WebView2), Python 3 stdlib (bus), React 19 + TS + zustand, tests `cargo test` / `python -m unittest` / `vitest`.

---

## Décisions actées (réf. spec `2026-06-04-vlaude-escouade-pere-fils-design.md`)

1. **Transport** : SQLite-sur-FS, `<cwd>/.vlaude/squad.db` (§10.1). Pas de réseau, pas de SQLite cross-frontière.
2. **Lecture par Vlaude** : via `wsl.exe → python3 squad.py view` (réutilise le pont WSL), **pas** d'ouverture SQLite côté Windows. La commande `view` est **read-only pure** (ni `_touch`, ni `commit` d'écriture) → ne fausse pas `alive`, ne consomme pas les messages.
3. **Identité** : token opaque dans l'env au spawn (§10.2). Généré côté Rust (`uuid`/random), jamais dans la prose LLM.
4. **MVP du panneau** : **membres + lots seulement**. Pas le journal des messages (l'`inbox` consomme — hors-scope V1, à rouvrir avec une vraie commande `feed` read-only plus tard).
5. **Injection du rôle** : **semi-manuelle**. Vlaude `pty_write` `/squad-pere`/`/squad-fils` sur action explicite (bouton tuile), pas d'auto (détecteur d'état « prêt » §5.9 hors-scope).
6. **Liens volatiles** : l'état escouade n'entre pas dans le snapshot ; re-dérivé du bus au reload (§10.3). Le store ne fait que **miroiter** `view`.
7. **Assets en prod** : `squad.py` + skills **bundlés** dans le `.exe` (Tauri resources) et installés au démarrage dans `~/.vlaude/squad.py` et `~/.claude/skills/squad-*`. `VLAUDE_SQUAD_PY = ~/.vlaude/squad.py`.

## Phase 0 — Dé-risquage (FAIT, spike 2026-06-04)

- ✅ Bus complet `init→add_member→post→claim→submit→verify→members→list` exécuté avec les vraies fonctions.
- ✅ `zsh -ic 'export VLAUDE_SQUAD_*=… && exec env'` → les vars atteignent le programme exec'd (fondation Voie A).
- ✅ `python3 squad.py members/list` → JSON propre sur stdout (chemin de `squad_cli`).
- ✅ `~/.claude/skills/` héberge déjà `graphify`, `adversarial`, … (invocables `/x`) → `/squad-pere` chargeable. Skills copiées.
- ⏳ **Seul reste à confirmer en live (Virgile, dans l'.exe)** : taper `/squad-pere` dans un claude **spawné après** l'install charge bien le rôle.

---

## File Structure

| Fichier | Action | Responsabilité |
|---|---|---|
| `bus/squad.py` | Modify | +`view()` + sous-commandes CLI `init` / `add-member` / `view` |
| `bus/test_squad.py` | Modify | +tests des 3 commandes (dont `view` read-only n'altère rien) |
| `src-tauri/src/pty/wsl.rs` | Modify | `build_wsl_argv(..., env)` insère `export K='V' &&` avant `exec` |
| `src-tauri/src/pty/manager.rs` | Modify | `spawn(..., env)` propage |
| `src-tauri/src/squad.rs` | Create | `squad_cli` (pont bus) + `install_squad_assets` + génération token |
| `src-tauri/src/lib.rs` | Modify | `pty_spawn(..., env)`, register `squad_cli`/`install_squad_assets`, appel install au setup |
| `src-tauri/tauri.conf.json` | Modify | `bundle.resources` : `bus/squad.py`, `skills/**` |
| `src/terminal/usePty.ts` | Modify | `createPty(..., env?)` → passe `env` à `pty_spawn` |
| `src/store/squad.ts` | Create | store zustand : `createSquad`/`addFils`/`startPoll`, mapping `view`→`SquadState` |
| `src/components/SquadPanel.tsx` | Modify | retirer `MOCK`, gérer l'état vide/null |
| `src/components/SquadBar.tsx` (+ `.css`) | Create | UI : « Nouvelle escouade » + « Ajouter un fils » (frontend-design d'abord) |
| `src/App.tsx` | Modify | monte `SquadBar` + `SquadPanel` quand une escouade est active |

---

## Phase 1 — Bus : commandes `init`, `add-member`, `view` (TDD)

### Task 1.1 — `view()` read-only + tests

**Files:** Modify `bus/squad.py`, `bus/test_squad.py`

- [ ] **Step 1 — test (échoue)** dans `test_squad.py` :

```python
class ViewTest(unittest.TestCase):
    def test_view_is_readonly_and_resolves_names(self):
        db = _tmp_db()
        c = squad._connect(db); squad.init_db(c)
        squad.init_squad(c, "sq1", "tokP", "/r", 100)
        squad.add_member(c, "tokF1", "sq1", "fils", "fils-1", "/r", 100)
        squad.post_tasks(c, "tokP", [{"title":"API","description":"d","owned_paths":["src/**"]}], [], 100)
        squad.claim(c, "tokF1", 100)
        before = c.execute("SELECT last_seen FROM member WHERE token='tokP'").fetchone()[0]
        v = squad.view(c, 100)
        after = c.execute("SELECT last_seen FROM member WHERE token='tokP'").fetchone()[0]
        assert before == after                         # view ne _touch PAS
        assert v["tasks"][0]["claimed_by"] == "fils-1"  # token -> name
        assert v["tasks"][0]["owned_paths"] == ["src/**"]
        assert {m["name"] for m in v["members"]} == {"pere", "fils-1"}
```

- [ ] **Step 2 — run, attendu FAIL** : `python3 -m unittest bus.test_squad.ViewTest -v` → `AttributeError: module 'squad' has no attribute 'view'`
- [ ] **Step 3 — implémenter `view`** dans `squad.py` (après `members`) :

```python
def view(conn, now):
    name_by_token = {r["token"]: r["name"] for r in conn.execute("SELECT token, name FROM member")}
    squads = conn.execute("SELECT squad_id, cwd FROM squad").fetchall()
    members = conn.execute("SELECT name, role, last_seen FROM member ORDER BY role DESC, name").fetchall()
    tasks = conn.execute("SELECT id, title, status, owned_paths, claimed_by_token FROM task ORDER BY id").fetchall()
    return {
        "squad": ({"squad_id": squads[0]["squad_id"], "cwd": squads[0]["cwd"]} if squads else None),
        "members": [{"name": r["name"], "role": r["role"], "alive": (now - r["last_seen"]) <= MEMBER_TTL} for r in members],
        "tasks": [{"id": r["id"], "title": r["title"], "status": r["status"],
                   "owned_paths": json.loads(r["owned_paths"]),
                   "claimed_by": name_by_token.get(r["claimed_by_token"])} for r in tasks],
    }
```

- [ ] **Step 4 — run, attendu PASS**
- [ ] **Step 5 — commit** : `feat(bus): view() read-only (members+tasks, token->name) for the live panel`

### Task 1.2 — CLI `init` / `add-member` / `view`

**Files:** Modify `bus/squad.py` (parsers + `_dispatch`), `bus/test_squad.py`

- [ ] **Step 1 — test (échoue)** :

```python
class CliLifecycleTest(unittest.TestCase):
    def test_init_add_member_view_via_cli(self):
        db = _tmp_db()
        squad.main(["--db", db, "init", "--squad-id", "sq1", "--pere-token", "tokP", "--cwd", "/r"], now=100)
        squad.main(["--db", db, "add-member", "--member-token", "tokF1", "--squad-id", "sq1",
                    "--role", "fils", "--name", "fils-1", "--cwd", "/r"], now=100)
        c = squad._connect(db)
        assert squad.resolve(c, "tokP")["role"] == "pere"
        assert squad.resolve(c, "tokF1")["name"] == "fils-1"
```

- [ ] **Step 2 — run, attendu FAIL** : `invalid choice: 'init'`
- [ ] **Step 3 — ajouter les parsers** (dans `main`, après le parser `ping`) :

```python
    sp = sub.add_parser("init"); sp.add_argument("--squad-id", required=True); sp.add_argument("--pere-token", required=True); sp.add_argument("--cwd", required=True)
    sp = sub.add_parser("add-member"); sp.add_argument("--member-token", required=True); sp.add_argument("--squad-id", required=True); sp.add_argument("--role", required=True, choices=["pere", "fils"]); sp.add_argument("--name", required=True); sp.add_argument("--cwd", required=True)
    sp = sub.add_parser("view")
```

  …et le dispatch (dans `_dispatch`, avant le `raise` final) :

```python
    if args.cmd == "init":
        init_db(conn); init_squad(conn, args.squad_id, args.pere_token, args.cwd, now); return {"ok": True, "squad_id": args.squad_id}
    if args.cmd == "add-member":
        add_member(conn, args.member_token, args.squad_id, args.role, args.name, args.cwd, now); return {"ok": True}
    if args.cmd == "view":
        return view(conn, now)
```

- [ ] **Step 4 — run, attendu PASS** + relancer toute la suite (`python3 -m unittest discover -s bus` → 34 tests OK)
- [ ] **Step 5 — commit** : `feat(bus): CLI init / add-member / view (squad lifecycle from Vlaude)`

---

## Phase 2 — Rust : env au spawn + pont bus + install assets

### Task 2.1 — `build_wsl_argv(..., env)` (TDD)

**Files:** Modify `src-tauri/src/pty/wsl.rs`

- [ ] **Step 1 — test (échoue)** : ajouter

```rust
#[test]
fn injects_env_exports_before_exec() {
    let env = vec![("VLAUDE_SQUAD_TOKEN".to_string(), "ab'c".to_string())];
    let argv = build_wsl_argv(None, "/r", SessionKind::Claude, &env);
    assert_eq!(argv.last().unwrap(), "cd '/r' && export VLAUDE_SQUAD_TOKEN='ab'\\''c' && exec claude");
}
```

  …et **mettre à jour les 4 tests existants** pour passer `&[]` en 4ᵉ argument (sinon ils ne compilent plus).

- [ ] **Step 2 — run, attendu FAIL (compilation)** : `cargo test --manifest-path src-tauri/Cargo.toml build_wsl`
- [ ] **Step 3 — implémenter** :

```rust
pub fn build_wsl_argv(distro: Option<&str>, cwd: &str, kind: SessionKind, env: &[(String, String)]) -> Vec<String> {
    let program = match kind { SessionKind::Claude => "claude", SessionKind::Term => "zsh -i" };
    let exports: String = env.iter().map(|(k, v)| format!("export {}={} && ", k, single_quote(v))).collect();
    let inner = format!("cd {} && {}exec {}", single_quote(cwd), exports, program);
    let mut argv = Vec::new();
    if let Some(d) = distro { argv.push("-d".into()); argv.push(d.into()); }
    argv.push("--".into()); argv.push("zsh".into()); argv.push("-ic".into()); argv.push(inner);
    argv
}
```

- [ ] **Step 4 — run, attendu PASS**
- [ ] **Step 5 — propager** : `manager.rs` `spawn(..., env: Vec<(String,String)>)` → passe `&env` à `build_wsl_argv` ; `lib.rs` `pty_spawn(..., env: Option<Vec<(String,String)>>)` → `state.spawn(..., env.unwrap_or_default(), ...)`. **Commit** : `feat(pty): inject env vars at spawn (squad enrolment)`

### Task 2.2 — `squad.rs` : `squad_cli` + `install_squad_assets` + token

**Files:** Create `src-tauri/src/squad.rs`, Modify `src-tauri/src/lib.rs`, `tauri.conf.json`

- [ ] **Step 1 — `squad_cli`** : commande qui lance le bus dans WSL et renvoie stdout (JSON). Spéc :

```rust
// db = format!("{}/.vlaude/squad.db", cwd) cote WSL ; squad_py = ~/.vlaude/squad.py
#[tauri::command]
fn squad_cli(cwd: String, args: Vec<String>) -> Result<String, String> {
    // wsl.exe -- zsh -ic "mkdir -p '<cwd>/.vlaude'; python3 \"$HOME/.vlaude/squad.py\" --db '<cwd>/.vlaude/squad.db' <args…>"
    // std::process::Command::new("wsl.exe"), capture stdout, map_err -> String, trim.
}
```

  Vérif manuelle (dev) : `squad_cli(cwd, ["view"])` sur une db créée renvoie le même JSON que le spike.

- [ ] **Step 2 — `install_squad_assets`** : copie `squad.py` + `skills/squad-*` depuis les resources Tauri (`app.path().resolve("bus/squad.py", Resource)`) vers `~/.vlaude/squad.py` et `~/.claude/skills/squad-*` **côté WSL** (via `wsl.exe cp` ou écriture du contenu). Appelée dans `.setup(...)`. En **dev**, fallback : pointer `VLAUDE_SQUAD_PY` sur `/mnt/c/Users/VirgileDc/Vlaude/bus/squad.py`.
- [ ] **Step 3 — `gen_token`** : `#[tauri::command] fn squad_gen_token() -> String` (16 octets hex via `getrandom`/`uuid`). Ajouter la dép si absente.
- [ ] **Step 4** — `tauri.conf.json` → `bundle.resources: ["../bus/squad.py", "../skills/**/*"]`. Register les commandes dans `generate_handler!`. `cargo check` vert.
- [ ] **Step 5 — commit** : `feat(squad): squad_cli bridge + asset install + token gen`

---

## Phase 3 — Front : store + panneau + UI (frontend-design AVANT de coder l'UI)

> ⚠️ **Avant Task 3.2/3.3 (toute pièce visible), invoquer le skill `frontend-design`** (règle projet + spec §6/§176).

### Task 3.1 — `src/store/squad.ts` (mapping `view`→`SquadState`, poll)

**Files:** Create `src/store/squad.ts`, Test `src/store/squad.test.ts`

- [ ] **Step 1 — test (échoue)** : `mapView(viewJson)` → `SquadState` (members, tasks avec `ownedPaths`/`claimedBy`/`status`, `overlaps: []`, `messages: []`). Cas vide → `null`.
- [ ] **Step 2 — run FAIL**
- [ ] **Step 3 — implémenter** le store : état `{ active: {squadId, cwd, pereToken, db} | null, state: SquadState | null }`, `mapView`, `startPoll(cwd)` (setInterval ~700 ms → `invoke("squad_cli", {cwd, args:["view"]})` → `mapView`), `stopPoll`, `createSquad(cwd)` (gen token → `squad_cli init` → set active → startPoll), `addFils(cwd, name)` (gen token → `squad_cli add-member` → renvoie le token pour le spawn).
- [ ] **Step 4 — run PASS** (`vitest run src/store/squad.test.ts`)
- [ ] **Step 5 — commit** : `feat(store): squad store — view polling + lifecycle actions`

### Task 3.2 — Brancher `SquadPanel` + monter dans `App`

**Files:** Modify `src/components/SquadPanel.tsx`, `src/App.tsx`

- [ ] Retirer `MOCK_SQUAD`/`SquadPanelPreview` du chemin de prod ; `SquadPanel` rendu avec `squad` issu du store ; si `state === null` → placeholder « aucune escouade ». Monter dans `App.tsx` derrière `useSquad((s)=>s.active)`. Vérif : `tsc` + `vitest` verts ; en `tauri dev`, le panneau affiche l'état d'une db pilotée à la main. **Commit** : `feat(ui): wire SquadPanel to live bus state`

### Task 3.3 — `SquadBar` : créer escouade / ajouter un fils

**Files:** Create `src/components/SquadBar.tsx` (+`.css`), Modify `src/App.tsx`, `src/store/sessions.ts` (si besoin pour spawn enrôlé)

- [ ] **« Nouvelle escouade »** : `createSquad(cwd)` sur le cwd du terminal focus, puis `pty_write("/squad-pere\r")` (bouton « démarrer le rôle » sur la tuile père — injection semi-manuelle, décision #5).
- [ ] **« Ajouter un fils »** : crée une **nouvelle session** dont le spawn passe `env = { VLAUDE_SQUAD_PY, VLAUDE_SQUAD_DB, VLAUDE_SQUAD_TOKEN }` (token de `addFils`) via `createPty(..., env)` → bouton « démarrer le rôle » `pty_write("/squad-fils\r")`.
- [ ] Vérif : `tsc` + `vitest` verts. **Commit** : `feat(ui): SquadBar — create squad + enrol fils at spawn`

---

## Phase 4 — Intégration & build `.exe`

- [ ] **Smoke test `tauri dev`** : créer escouade (père) → ajouter 1 fils → dans le père taper la feature + `squad post-tasks` → dans le fils `squad claim`/code/`submit` → père `squad verify`. **Le panneau passe le lot todo→claimed→submitted→verified et montre les 2 membres alive.** (Critère de succès Voie A.)
- [ ] Vérifier l'install des assets dans une build (les resources sont résolues hors du repo).
- [ ] **Build** : `npm run tauri build` (côté Windows) → `.exe`. Lancer le `.exe`, refaire le smoke test. Confirmer `/squad-pere` charge la skill (point ⏳ de Phase 0).
- [ ] **Commit** : `chore(squad): bundle bus+skills as resources; voie A end-to-end` + mettre à jour la section « État / en cours » du `CLAUDE.md`.

---

## Self-review (couverture spec)

- §5.4 modèle/ops ✅ (bus existant + `view`). §5.5 token-identité ✅ (env au spawn, gen Rust). §10.1 SQLite-FS ✅. §10.2 token env ✅. §10.3 volatile ✅ (store miroir, pas de persist). §5.11 submitted/verified ✅ (panneau). §6 panneau ✅ ; **frontend-design** porté en garde Phase 3.
- **Hors-scope V1 assumé (≠ trous)** : geste drag dynamique (Voie B), messages dans le panneau (inbox consomme), `member_gone`/reaper Vlaude (le bail 900 s du bus couvre déjà la libération), détecteur d'état « prêt » §5.9 (injection rôle semi-manuelle). Le reaper par bail existant suffit au MVP.
- **Risque résiduel** : verrou SQLite WSL↔Windows — éliminé ici car **tous les accès passent par WSL** (`squad_cli` lance python *dans* WSL), Vlaude n'ouvre jamais le `.db` côté Windows.
