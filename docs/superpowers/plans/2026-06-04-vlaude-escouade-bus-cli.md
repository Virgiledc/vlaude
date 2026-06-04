# Escouade — Bus CLI (Plan 1/3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le **bus** de l'escouade : un outil en ligne de commande, autonome et déterministe, qui héberge le tableau partagé (lots + membres + messages) dans un fichier SQLite, avec identité par token, prise de lot atomique, libération de lot par bail (lease), et détection d'overlap de périmètres.

**Architecture:** Un seul module Python 3 stdlib (`bus/squad.py`) exposant des fonctions pures `(conn, …, now)` testables sans horloge réelle, plus un dispatcher `main(argv)` qui imprime du JSON. État dans SQLite (`BEGIN IMMEDIATE` pour l'atomicité). Aucune dépendance externe. C'est la fondation des plans 2 (intégration Vlaude, lit le même `.db` en read-only) et 3 (skills `squad-pere`/`squad-fils` qui appellent ce CLI).

**Tech Stack:** Python 3 (stdlib : `sqlite3`, `json`, `fnmatch`, `argparse`, `unittest`, `time`, `secrets`). Pas de pip install.

**Décisions gravées (spec §10, 2026-06-04) appliquées ici :** SQLite-sur-FS (#1) ; identité par token résolue côté code (#2) ; overlap = **flag**, pas reject (#4). La libération sur mort de fils (spec §5.7) est implémentée ici en **bail (lease)** côté CLI — conséquence directe de « Vlaude read-only, écrivains côté WSL » : aucun process Vlaude n'écrit le release, c'est le `_reap` du CLI qui le fait à chaque appel. Vlaude (Plan 2) ne fait qu'accélérer le signal, il n'est pas requis pour la correction.

**Convention de test :** les fonctions cœur prennent un paramètre `now` (epoch int) → les tests injectent un temps fixe et n'ont jamais besoin de l'horloge réelle. Le CLI passe `int(time.time())`.

---

## File Structure

- Create: `bus/squad.py` — le module bus (fonctions + `main`). Responsabilité unique : la logique du tableau partagé.
- Create: `bus/test_squad.py` — la suite `unittest`. Chaque test ouvre une DB `:memory:` fraîche via un helper.
- Create: `bus/README.md` — comment lancer le CLI + les tests (court).

Tous les chemins sont relatifs à la racine du repo Vlaude (`/mnt/c/Users/VirgileDc/Vlaude`). Les commandes `Run:` s'exécutent **depuis le dossier `bus/`** (`cd bus` d'abord) sauf indication contraire.

---

## Task 1: Schéma + initialisation de l'escouade

**Files:**
- Create: `bus/squad.py`
- Test: `bus/test_squad.py`

- [ ] **Step 1: Write the failing test**

`bus/test_squad.py` :

```python
import sqlite3
import unittest

import squad


def fresh():
    conn = sqlite3.connect(":memory:", isolation_level=None)
    conn.row_factory = sqlite3.Row
    squad.init_db(conn)
    return conn


class InitSquadTest(unittest.TestCase):
    def test_init_creates_squad_and_pere_member(self):
        conn = fresh()
        squad.init_squad(conn, squad_id="sq1", pere_token="tokP", cwd="/repo", now=100)

        sq = conn.execute("SELECT * FROM squad WHERE squad_id='sq1'").fetchone()
        self.assertEqual(sq["pere_token"], "tokP")
        self.assertEqual(sq["cwd"], "/repo")
        self.assertEqual(sq["created_at"], 100)

        m = conn.execute("SELECT * FROM member WHERE token='tokP'").fetchone()
        self.assertEqual(m["squad_id"], "sq1")
        self.assertEqual(m["role"], "pere")
        self.assertEqual(m["status"], "alive")
        self.assertEqual(m["last_seen"], 100)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'squad'` (ou `AttributeError: module 'squad' has no attribute 'init_db'`).

- [ ] **Step 3: Write minimal implementation**

`bus/squad.py` :

```python
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS squad (
    squad_id   TEXT PRIMARY KEY,
    pere_token TEXT NOT NULL,
    cwd        TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS member (
    token     TEXT PRIMARY KEY,
    squad_id  TEXT NOT NULL,
    role      TEXT NOT NULL,
    name      TEXT NOT NULL,
    cwd       TEXT NOT NULL,
    status    TEXT NOT NULL,
    last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS task (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    squad_id         TEXT NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT NOT NULL,
    owned_paths      TEXT NOT NULL,
    status           TEXT NOT NULL,
    claimed_by_token TEXT,
    claimed_at       INTEGER,
    created_at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS message (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    squad_id   TEXT NOT NULL,
    from_token TEXT,
    to_token   TEXT,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at    INTEGER
);
"""


def init_db(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def init_squad(conn, squad_id, pere_token, cwd, now):
    conn.execute(
        "INSERT INTO squad (squad_id, pere_token, cwd, created_at) VALUES (?, ?, ?, ?)",
        (squad_id, pere_token, cwd, now),
    )
    conn.execute(
        "INSERT INTO member (token, squad_id, role, name, cwd, status, last_seen) "
        "VALUES (?, ?, 'pere', 'pere', ?, 'alive', ?)",
        (pere_token, squad_id, cwd, now),
    )
    conn.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: PASS (1 test OK).

- [ ] **Step 5: Commit**

```bash
git add bus/squad.py bus/test_squad.py
git commit -m "feat(bus): schema + squad init with père member"
```

---

## Task 2: Enregistrer un fils + résolution d'identité par token

**Files:**
- Modify: `bus/squad.py`
- Test: `bus/test_squad.py`

- [ ] **Step 1: Write the failing test**

Ajouter à `bus/test_squad.py` :

```python
class MemberTest(unittest.TestCase):
    def test_add_member_and_resolve(self):
        conn = fresh()
        squad.init_squad(conn, "sq1", "tokP", "/repo", now=100)
        squad.add_member(conn, token="tokF1", squad_id="sq1", role="fils",
                         name="fils-1", cwd="/repo", now=110)

        m = squad.resolve(conn, "tokF1")
        self.assertEqual(m["squad_id"], "sq1")
        self.assertEqual(m["role"], "fils")
        self.assertEqual(m["name"], "fils-1")

    def test_resolve_unknown_token_returns_none(self):
        conn = fresh()
        squad.init_squad(conn, "sq1", "tokP", "/repo", now=100)
        self.assertIsNone(squad.resolve(conn, "ghost"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: FAIL — `AttributeError: module 'squad' has no attribute 'add_member'`.

- [ ] **Step 3: Write minimal implementation**

Ajouter à `bus/squad.py` :

```python
def add_member(conn, token, squad_id, role, name, cwd, now):
    conn.execute(
        "INSERT INTO member (token, squad_id, role, name, cwd, status, last_seen) "
        "VALUES (?, ?, ?, ?, ?, 'alive', ?)",
        (token, squad_id, role, name, cwd, now),
    )
    conn.commit()


def resolve(conn, token):
    return conn.execute("SELECT * FROM member WHERE token=?", (token,)).fetchone()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: PASS (3 tests OK).

- [ ] **Step 5: Commit**

```bash
git add bus/squad.py bus/test_squad.py
git commit -m "feat(bus): add_member + token identity resolution"
```

---

## Task 3: Poster des lots (père uniquement)

**Files:**
- Modify: `bus/squad.py`
- Test: `bus/test_squad.py`

- [ ] **Step 1: Write the failing test**

```python
class PostTasksTest(unittest.TestCase):
    def setUp(self):
        self.conn = fresh()
        squad.init_squad(self.conn, "sq1", "tokP", "/repo", now=100)
        squad.add_member(self.conn, "tokF1", "sq1", "fils", "fils-1", "/repo", now=110)

    def test_pere_posts_tasks(self):
        res = squad.post_tasks(
            self.conn, "tokP",
            tasks=[{"title": "api", "description": "build api", "owned_paths": ["src/api/**"]},
                   {"title": "ui", "description": "build ui", "owned_paths": ["src/ui/**"]}],
            all_files=[], now=120,
        )
        self.assertEqual(len(res["inserted"]), 2)
        self.assertEqual(res["overlaps"], [])
        rows = self.conn.execute("SELECT title, status, owned_paths FROM task ORDER BY id").fetchall()
        self.assertEqual([r["title"] for r in rows], ["api", "ui"])
        self.assertEqual(rows[0]["status"], "todo")
        self.assertEqual(squad.json.loads(rows[0]["owned_paths"]), ["src/api/**"])

    def test_fils_cannot_post(self):
        with self.assertRaises(squad.NotAllowed):
            squad.post_tasks(self.conn, "tokF1",
                             tasks=[{"title": "x", "description": "", "owned_paths": []}],
                             all_files=[], now=120)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: FAIL — `AttributeError: module 'squad' has no attribute 'post_tasks'`.

- [ ] **Step 3: Write minimal implementation**

En haut de `bus/squad.py`, ajouter l'import et l'exception :

```python
import json
import sqlite3


class NotAllowed(Exception):
    pass
```

(Garder l'unique `import sqlite3` — ne pas le dupliquer. Ajouter `import json` au-dessus.)

Puis ajouter la fonction (la détection d'overlap arrive en Task 8 ; ici `overlaps` reste vide) :

```python
def post_tasks(conn, token, tasks, all_files, now):
    member = resolve(conn, token)
    if member is None or member["role"] != "pere":
        raise NotAllowed("seul le père peut poster des lots")
    inserted = []
    for t in tasks:
        cur = conn.execute(
            "INSERT INTO task (squad_id, title, description, owned_paths, status, created_at) "
            "VALUES (?, ?, ?, ?, 'todo', ?)",
            (member["squad_id"], t["title"], t["description"],
             json.dumps(t["owned_paths"]), now),
        )
        inserted.append(cur.lastrowid)
    conn.commit()
    return {"inserted": inserted, "overlaps": []}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: PASS (5 tests OK).

- [ ] **Step 5: Commit**

```bash
git add bus/squad.py bus/test_squad.py
git commit -m "feat(bus): post_tasks (père-only) inserting todo tasks"
```

---

## Task 4: Prise de lot atomique (`claim`)

**Files:**
- Modify: `bus/squad.py`
- Test: `bus/test_squad.py`

- [ ] **Step 1: Write the failing test**

```python
class ClaimTest(unittest.TestCase):
    def setUp(self):
        self.conn = fresh()
        squad.init_squad(self.conn, "sq1", "tokP", "/repo", now=100)
        squad.add_member(self.conn, "tokF1", "sq1", "fils", "fils-1", "/repo", now=110)
        squad.post_tasks(self.conn, "tokP",
                         tasks=[{"title": "a", "description": "", "owned_paths": ["a/**"]},
                                {"title": "b", "description": "", "owned_paths": ["b/**"]}],
                         all_files=[], now=120)

    def test_claim_returns_first_todo_and_marks_claimed(self):
        task = squad.claim(self.conn, "tokF1", now=130)
        self.assertEqual(task["title"], "a")
        self.assertEqual(task["status"], "claimed")
        self.assertEqual(task["claimed_by_token"], "tokF1")
        self.assertEqual(task["claimed_at"], 130)

    def test_second_claim_skips_already_claimed(self):
        first = squad.claim(self.conn, "tokF1", now=130)
        second = squad.claim(self.conn, "tokF1", now=131)
        self.assertEqual(first["title"], "a")
        self.assertEqual(second["title"], "b")

    def test_claim_returns_none_when_no_todo(self):
        squad.claim(self.conn, "tokF1", now=130)
        squad.claim(self.conn, "tokF1", now=131)
        self.assertIsNone(squad.claim(self.conn, "tokF1", now=132))

    def test_unknown_token_cannot_claim(self):
        with self.assertRaises(squad.NotAllowed):
            squad.claim(self.conn, "ghost", now=130)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: FAIL — `AttributeError: module 'squad' has no attribute 'claim'`.

- [ ] **Step 3: Write minimal implementation**

Ajouter à `bus/squad.py`. La transaction `BEGIN IMMEDIATE` garantit qu'aucune autre connexion ne peut prendre le même lot entre la lecture et l'écriture (verrou écrivain SQLite). `_touch` met à jour le `last_seen` du membre (heartbeat implicite à chaque appel). `_reap` est ajouté vide ici, rempli en Task 7.

> **Prérequis non-évident (déjà appliqué dans `fresh()` Task 1 et `_connect` Task 11)** : la connexion DOIT être ouverte avec `isolation_level=None`. Sinon le module `sqlite3` de Python gère des transactions implicites et le `BEGIN IMMEDIATE` explicite peut lever « cannot start a transaction within a transaction » selon la version de Python. `isolation_level=None` = autocommit : seules les transactions explicites (`BEGIN`/`COMMIT`, comme ici dans `claim`) sont transactionnelles ; partout ailleurs chaque écriture s'auto-commit et le `conn.commit()` final est un no-op inoffensif. Seul `claim` a besoin d'atomicité cross-process (plusieurs fils), et il l'a via ce `BEGIN IMMEDIATE`.

```python
def _touch(conn, token, now):
    conn.execute("UPDATE member SET last_seen=?, status='alive' WHERE token=?", (now, token))


def _reap(conn, squad_id, now):
    return []


def claim(conn, token, now):
    member = resolve(conn, token)
    if member is None:
        raise NotAllowed("token inconnu")
    squad_id = member["squad_id"]
    conn.execute("BEGIN IMMEDIATE")
    try:
        _touch(conn, token, now)
        _reap(conn, squad_id, now)
        row = conn.execute(
            "SELECT id FROM task WHERE squad_id=? AND status='todo' ORDER BY id LIMIT 1",
            (squad_id,),
        ).fetchone()
        if row is None:
            conn.commit()
            return None
        conn.execute(
            "UPDATE task SET status='claimed', claimed_by_token=?, claimed_at=? WHERE id=?",
            (token, now, row["id"]),
        )
        task = conn.execute("SELECT * FROM task WHERE id=?", (row["id"],)).fetchone()
        conn.commit()
        return task
    except Exception:
        conn.rollback()
        raise
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: PASS (9 tests OK).

- [ ] **Step 5: Commit**

```bash
git add bus/squad.py bus/test_squad.py
git commit -m "feat(bus): atomic claim (BEGIN IMMEDIATE) with last_seen touch"
```

---

## Task 5: `submit` (le fils signale fini) — seul l'owner peut

**Files:**
- Modify: `bus/squad.py`
- Test: `bus/test_squad.py`

- [ ] **Step 1: Write the failing test**

```python
class SubmitTest(unittest.TestCase):
    def setUp(self):
        self.conn = fresh()
        squad.init_squad(self.conn, "sq1", "tokP", "/repo", now=100)
        squad.add_member(self.conn, "tokF1", "sq1", "fils", "fils-1", "/repo", now=110)
        squad.add_member(self.conn, "tokF2", "sq1", "fils", "fils-2", "/repo", now=110)
        squad.post_tasks(self.conn, "tokP",
                         tasks=[{"title": "a", "description": "", "owned_paths": ["a/**"]}],
                         all_files=[], now=120)
        self.task = squad.claim(self.conn, "tokF1", now=130)

    def test_owner_submits(self):
        squad.submit(self.conn, "tokF1", self.task["id"], now=140)
        row = self.conn.execute("SELECT status FROM task WHERE id=?", (self.task["id"],)).fetchone()
        self.assertEqual(row["status"], "submitted")

    def test_non_owner_cannot_submit(self):
        with self.assertRaises(squad.NotAllowed):
            squad.submit(self.conn, "tokF2", self.task["id"], now=140)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: FAIL — `AttributeError: module 'squad' has no attribute 'submit'`.

- [ ] **Step 3: Write minimal implementation**

```python
def submit(conn, token, task_id, now):
    _touch(conn, token, now)
    row = conn.execute("SELECT claimed_by_token FROM task WHERE id=?", (task_id,)).fetchone()
    if row is None or row["claimed_by_token"] != token:
        conn.commit()
        raise NotAllowed("seul l'owner du lot peut le soumettre")
    conn.execute("UPDATE task SET status='submitted' WHERE id=?", (task_id,))
    conn.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: PASS (11 tests OK).

- [ ] **Step 5: Commit**

```bash
git add bus/squad.py bus/test_squad.py
git commit -m "feat(bus): submit (owner-only) marks task submitted"
```

---

## Task 6: `verify` (père uniquement) — submitted → verified

**Files:**
- Modify: `bus/squad.py`
- Test: `bus/test_squad.py`

- [ ] **Step 1: Write the failing test**

```python
class VerifyTest(unittest.TestCase):
    def setUp(self):
        self.conn = fresh()
        squad.init_squad(self.conn, "sq1", "tokP", "/repo", now=100)
        squad.add_member(self.conn, "tokF1", "sq1", "fils", "fils-1", "/repo", now=110)
        squad.post_tasks(self.conn, "tokP",
                         tasks=[{"title": "a", "description": "", "owned_paths": ["a/**"]}],
                         all_files=[], now=120)
        self.task = squad.claim(self.conn, "tokF1", now=130)

    def test_pere_verifies_submitted_task(self):
        squad.submit(self.conn, "tokF1", self.task["id"], now=140)
        squad.verify(self.conn, "tokP", self.task["id"], now=150)
        row = self.conn.execute("SELECT status FROM task WHERE id=?", (self.task["id"],)).fetchone()
        self.assertEqual(row["status"], "verified")

    def test_cannot_verify_unsubmitted(self):
        with self.assertRaises(squad.NotAllowed):
            squad.verify(self.conn, "tokP", self.task["id"], now=150)

    def test_fils_cannot_verify(self):
        squad.submit(self.conn, "tokF1", self.task["id"], now=140)
        with self.assertRaises(squad.NotAllowed):
            squad.verify(self.conn, "tokF1", self.task["id"], now=150)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: FAIL — `AttributeError: module 'squad' has no attribute 'verify'`.

- [ ] **Step 3: Write minimal implementation**

```python
def verify(conn, token, task_id, now):
    member = resolve(conn, token)
    if member is None or member["role"] != "pere":
        raise NotAllowed("seul le père peut vérifier un lot")
    _touch(conn, token, now)
    row = conn.execute("SELECT status FROM task WHERE id=?", (task_id,)).fetchone()
    if row is None or row["status"] != "submitted":
        conn.commit()
        raise NotAllowed("le lot doit être 'submitted' pour être vérifié")
    conn.execute("UPDATE task SET status='verified' WHERE id=?", (task_id,))
    conn.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: PASS (14 tests OK).

- [ ] **Step 5: Commit**

```bash
git add bus/squad.py bus/test_squad.py
git commit -m "feat(bus): verify (père-only) submitted->verified"
```

---

## Task 7: Reaper par bail (lease) — libère les lots des fils morts

**Files:**
- Modify: `bus/squad.py`
- Test: `bus/test_squad.py`

Un fils mort cesse d'appeler le CLI → son `last_seen` se fige. `_reap` (appelé au début de chaque `claim`) repasse en `todo` tout lot `claimed` dont l'owner n'a pas donné signe de vie depuis `LEASE_TTL`, et poste un message système au père. C'est la version « bail » de la libération-sur-mort (spec §5.7), entièrement côté CLU/WSL, sans écriture Vlaude.

- [ ] **Step 1: Write the failing test**

```python
class ReapTest(unittest.TestCase):
    def setUp(self):
        self.conn = fresh()
        squad.init_squad(self.conn, "sq1", "tokP", "/repo", now=100)
        squad.add_member(self.conn, "tokF1", "sq1", "fils", "fils-1", "/repo", now=110)
        squad.add_member(self.conn, "tokF2", "sq1", "fils", "fils-2", "/repo", now=110)
        squad.post_tasks(self.conn, "tokP",
                         tasks=[{"title": "a", "description": "", "owned_paths": ["a/**"]}],
                         all_files=[], now=120)

    def test_stale_claim_is_released_and_reclaimable(self):
        # fils-1 prend le lot à t=130 puis meurt (n'appelle plus rien)
        squad.claim(self.conn, "tokF1", now=130)
        # fils-2 tente de claim bien plus tard : > LEASE_TTL après le claim de fils-1
        later = 130 + squad.LEASE_TTL + 1
        task = squad.claim(self.conn, "tokF2", now=later)
        self.assertIsNotNone(task)
        self.assertEqual(task["title"], "a")
        self.assertEqual(task["claimed_by_token"], "tokF2")

    def test_fresh_claim_is_not_released(self):
        squad.claim(self.conn, "tokF1", now=130)
        # fils-1 garde son bail à jour (ping) juste avant la tentative de fils-2
        soon = 130 + squad.LEASE_TTL - 1
        squad.ping(self.conn, "tokF1", now=soon)
        task = squad.claim(self.conn, "tokF2", now=soon + 1)
        self.assertIsNone(task)

    def test_reap_notifies_pere(self):
        squad.claim(self.conn, "tokF1", now=130)
        later = 130 + squad.LEASE_TTL + 1
        squad.claim(self.conn, "tokF2", now=later)
        msgs = self.conn.execute(
            "SELECT body FROM message WHERE to_token='tokP'").fetchall()
        self.assertTrue(any("ré-ouvert" in m["body"] for m in msgs))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: FAIL — `AttributeError: module 'squad' has no attribute 'ping'` (et `LEASE_TTL` absent).

- [ ] **Step 3: Write minimal implementation**

En haut de `bus/squad.py`, ajouter la constante :

```python
LEASE_TTL = 900
```

Remplacer le `_reap` stub de la Task 4 par :

```python
def _reap(conn, squad_id, now):
    stale = conn.execute(
        "SELECT t.id, t.claimed_by_token FROM task t "
        "JOIN member m ON m.token = t.claimed_by_token "
        "WHERE t.squad_id=? AND t.status='claimed' AND (? - m.last_seen) > ?",
        (squad_id, now, LEASE_TTL),
    ).fetchall()
    reaped = []
    sq = conn.execute("SELECT pere_token FROM squad WHERE squad_id=?", (squad_id,)).fetchone()
    pere_token = sq["pere_token"] if sq else None
    for row in stale:
        conn.execute(
            "UPDATE task SET status='todo', claimed_by_token=NULL, claimed_at=NULL WHERE id=?",
            (row["id"],),
        )
        if pere_token is not None:
            conn.execute(
                "INSERT INTO message (squad_id, from_token, to_token, body, created_at) "
                "VALUES (?, NULL, ?, ?, ?)",
                (squad_id, pere_token,
                 f"lot #{row['id']} ré-ouvert : owner {row['claimed_by_token']} perdu (bail expiré) — "
                 f"vérifier l'état des fichiers du périmètre.", now),
            )
        reaped.append(row["id"])
    return reaped


def ping(conn, token, now):
    member = resolve(conn, token)
    if member is None:
        raise NotAllowed("token inconnu")
    _touch(conn, token, now)
    conn.commit()
```

> Note : `_reap` tourne **dans** la transaction `BEGIN IMMEDIATE` de `claim` (Task 4) — il ne commit pas lui-même, c'est `claim` qui commit. `ping`, lui, commit (appel autonome).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: PASS (17 tests OK).

- [ ] **Step 5: Commit**

```bash
git add bus/squad.py bus/test_squad.py
git commit -m "feat(bus): lease-based reaper releases dead fils' claims + notifies père"
```

---

## Task 8: Détection d'overlap de périmètres (flag, pas reject)

**Files:**
- Modify: `bus/squad.py`
- Test: `bus/test_squad.py`

Décision #4 : on **signale** les chevauchements, on ne rejette pas. `post_tasks` renvoie `overlaps` = liste de paires de lots dont les périmètres se recoupent (par expansion `fnmatch` contre `all_files`, plus une règle de confinement `**`).

- [ ] **Step 1: Write the failing test**

```python
class OverlapTest(unittest.TestCase):
    def test_expand_matches_files(self):
        files = ["src/api/users.ts", "src/ui/button.ts", "README.md"]
        self.assertEqual(squad.expand("src/api/**", files), {"src/api/users.ts"})
        self.assertEqual(squad.expand("src/**", files), {"src/api/users.ts", "src/ui/button.ts"})

    def test_overlapping_paths_via_files(self):
        files = ["src/api/users.ts"]
        self.assertTrue(squad.paths_overlap(["src/**"], ["src/api/*.ts"], files))
        self.assertFalse(squad.paths_overlap(["src/api/**"], ["src/ui/**"], files))

    def test_double_star_containment_without_files(self):
        # même sans fichiers sur disque, src/** confine src/api/foo.ts
        self.assertTrue(squad.paths_overlap(["src/**"], ["src/api/foo.ts"], []))

    def test_post_tasks_flags_overlap(self):
        conn = fresh()
        squad.init_squad(conn, "sq1", "tokP", "/repo", now=100)
        res = squad.post_tasks(
            conn, "tokP",
            tasks=[{"title": "broad", "description": "", "owned_paths": ["src/**"]},
                   {"title": "narrow", "description": "", "owned_paths": ["src/api/*.ts"]}],
            all_files=["src/api/users.ts"], now=120,
        )
        self.assertEqual(len(res["inserted"]), 2)  # inséré quand même (flag, pas reject)
        self.assertEqual(len(res["overlaps"]), 1)
        pair = res["overlaps"][0]
        self.assertEqual(set(pair["titles"]), {"broad", "narrow"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: FAIL — `AttributeError: module 'squad' has no attribute 'expand'`.

- [ ] **Step 3: Write minimal implementation**

Ajouter l'import `fnmatch` en haut (`import fnmatch`), puis :

```python
def expand(glob, files):
    pattern = glob.replace("/**", "/*")
    return {f for f in files if fnmatch.fnmatch(f, glob) or fnmatch.fnmatch(f, pattern)
            or _contains(glob, f)}


def _contains(glob, path):
    if glob.endswith("/**"):
        prefix = glob[:-3].rstrip("/")
        return path == prefix or path.startswith(prefix + "/")
    return False


def paths_overlap(paths_a, paths_b, files):
    for ga in paths_a:
        for gb in paths_b:
            if _globs_overlap(ga, gb, files):
                return True
    return False


def _globs_overlap(ga, gb, files):
    if ga == gb:
        return True
    if _contains(ga, gb.split("*")[0].rstrip("/")) or _contains(gb, ga.split("*")[0].rstrip("/")):
        return True
    fa = expand(ga, files)
    fb = expand(gb, files)
    return len(fa & fb) > 0
```

Puis modifier `post_tasks` (Task 3) pour calculer les overlaps après insertion. Remplacer le `return {"inserted": inserted, "overlaps": []}` final par :

```python
    overlaps = []
    for i in range(len(tasks)):
        for j in range(i + 1, len(tasks)):
            if paths_overlap(tasks[i]["owned_paths"], tasks[j]["owned_paths"], all_files):
                overlaps.append({
                    "task_ids": [inserted[i], inserted[j]],
                    "titles": [tasks[i]["title"], tasks[j]["title"]],
                })
    conn.commit()
    return {"inserted": inserted, "overlaps": overlaps}
```

> Retirer l'ancien `conn.commit()` / `return` dupliqué de la Task 3 : il ne doit y avoir qu'un seul `conn.commit()` + `return` à la fin de `post_tasks`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: PASS (21 tests OK).

- [ ] **Step 5: Commit**

```bash
git add bus/squad.py bus/test_squad.py
git commit -m "feat(bus): perimeter overlap detection (flag, not reject)"
```

---

## Task 9: Messages (`msg` / `inbox`) — from/to résolus par token

**Files:**
- Modify: `bus/squad.py`
- Test: `bus/test_squad.py`

- [ ] **Step 1: Write the failing test**

```python
class MessageTest(unittest.TestCase):
    def setUp(self):
        self.conn = fresh()
        squad.init_squad(self.conn, "sq1", "tokP", "/repo", now=100)
        squad.add_member(self.conn, "tokF1", "sq1", "fils", "fils-1", "/repo", now=110)
        squad.add_member(self.conn, "tokF2", "sq1", "fils", "fils-2", "/repo", now=110)

    def test_msg_to_by_name_then_inbox_marks_read(self):
        squad.msg(self.conn, "tokF1", to="fils-2", body="signature foo(x:int)", now=120)
        inbox = squad.inbox(self.conn, "tokF2", now=130)
        self.assertEqual(len(inbox), 1)
        self.assertEqual(inbox[0]["body"], "signature foo(x:int)")
        self.assertEqual(inbox[0]["from_name"], "fils-1")
        # relire : déjà lu, vide
        self.assertEqual(squad.inbox(self.conn, "tokF2", now=131), [])

    def test_from_is_token_resolved_not_payload(self):
        # même si l'appelant ment, from = celui du token tokF1
        squad.msg(self.conn, "tokF1", to="fils-2", body="x", now=120)
        row = self.conn.execute("SELECT from_token FROM message").fetchone()
        self.assertEqual(row["from_token"], "tokF1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: FAIL — `AttributeError: module 'squad' has no attribute 'msg'`.

- [ ] **Step 3: Write minimal implementation**

```python
def _token_for_name(conn, squad_id, name):
    row = conn.execute(
        "SELECT token FROM member WHERE squad_id=? AND name=?", (squad_id, name)
    ).fetchone()
    return row["token"] if row else None


def msg(conn, token, to, body, now):
    sender = resolve(conn, token)
    if sender is None:
        raise NotAllowed("token inconnu")
    _touch(conn, token, now)
    to_token = to if resolve(conn, to) else _token_for_name(conn, sender["squad_id"], to)
    if to_token is None:
        conn.commit()
        raise NotAllowed(f"destinataire inconnu: {to}")
    conn.execute(
        "INSERT INTO message (squad_id, from_token, to_token, body, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (sender["squad_id"], token, to_token, body, now),
    )
    conn.commit()


def inbox(conn, token, now):
    member = resolve(conn, token)
    if member is None:
        raise NotAllowed("token inconnu")
    _touch(conn, token, now)
    rows = conn.execute(
        "SELECT m.id, m.body, m.from_token, f.name AS from_name "
        "FROM message m LEFT JOIN member f ON f.token = m.from_token "
        "WHERE m.to_token=? AND m.read_at IS NULL ORDER BY m.id",
        (token,),
    ).fetchall()
    out = [{"id": r["id"], "body": r["body"], "from_token": r["from_token"],
            "from_name": r["from_name"]} for r in rows]
    conn.execute("UPDATE message SET read_at=? WHERE to_token=? AND read_at IS NULL", (now, token))
    conn.commit()
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: PASS (23 tests OK).

- [ ] **Step 5: Commit**

```bash
git add bus/squad.py bus/test_squad.py
git commit -m "feat(bus): msg/inbox with code-resolved from/to identity"
```

---

## Task 10: `members` + statut alive/gone dérivé du bail

**Files:**
- Modify: `bus/squad.py`
- Test: `bus/test_squad.py`

- [ ] **Step 1: Write the failing test**

```python
class MembersTest(unittest.TestCase):
    def setUp(self):
        self.conn = fresh()
        squad.init_squad(self.conn, "sq1", "tokP", "/repo", now=100)
        squad.add_member(self.conn, "tokF1", "sq1", "fils", "fils-1", "/repo", now=110)

    def test_members_lists_role_and_liveness(self):
        # fils-1 vu récemment, père vu à t=100
        out = squad.members(self.conn, "tokP", now=120)
        by_name = {m["name"]: m for m in out}
        self.assertEqual(by_name["pere"]["role"], "pere")
        self.assertTrue(by_name["fils-1"]["alive"])

    def test_member_goes_stale_past_member_ttl(self):
        out = squad.members(self.conn, "tokP", now=110 + squad.MEMBER_TTL + 1)
        by_name = {m["name"]: m for m in out}
        self.assertFalse(by_name["fils-1"]["alive"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: FAIL — `AttributeError: module 'squad' has no attribute 'members'` (et `MEMBER_TTL` absent).

- [ ] **Step 3: Write minimal implementation**

Ajouter la constante près de `LEASE_TTL` :

```python
MEMBER_TTL = 120
```

Puis :

```python
def members(conn, token, now):
    member = resolve(conn, token)
    if member is None:
        raise NotAllowed("token inconnu")
    _touch(conn, token, now)
    rows = conn.execute(
        "SELECT name, role, last_seen FROM member WHERE squad_id=? ORDER BY role DESC, name",
        (member["squad_id"],),
    ).fetchall()
    conn.commit()
    return [{"name": r["name"], "role": r["role"],
             "alive": (now - r["last_seen"]) <= MEMBER_TTL} for r in rows]
```

> Note : `members` met d'abord à jour le `last_seen` de l'appelant (`_touch`), donc l'appelant est toujours `alive` dans sa propre vue — comportement voulu.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: PASS (25 tests OK).

- [ ] **Step 5: Commit**

```bash
git add bus/squad.py bus/test_squad.py
git commit -m "feat(bus): members listing with lease-derived liveness"
```

---

## Task 11: Dispatcher CLI (`main`) — sortie JSON

**Files:**
- Modify: `bus/squad.py`
- Test: `bus/test_squad.py`

Le CLI ouvre la DB (chemin via `--db`), résout l'identité via `--token`, passe `now = int(time.time())`, exécute la commande, imprime du JSON sur stdout. Les tests appellent `main(argv, now=…)` avec un `now` injecté et capturent la sortie.

- [ ] **Step 1: Write the failing test**

```python
import io
import json as _json
import os
import tempfile
from contextlib import redirect_stdout


class CliTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.db = os.path.join(self.dir, "squad.db")
        # init via API directe pour préparer le terrain
        conn = sqlite3.connect(self.db, isolation_level=None)
        conn.row_factory = sqlite3.Row
        squad.init_db(conn)
        squad.init_squad(conn, "sq1", "tokP", "/repo", now=100)
        squad.add_member(conn, "tokF1", "sq1", "fils", "fils-1", "/repo", now=100)
        conn.close()

    def run_cli(self, args, now):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = squad.main(["--db", self.db] + args, now=now)
        return code, _json.loads(buf.getvalue())

    def test_cli_post_then_claim(self):
        code, out = self.run_cli(
            ["post-tasks", "--token", "tokP", "--json",
             _json.dumps([{"title": "a", "description": "d", "owned_paths": ["a/**"]}])],
            now=120)
        self.assertEqual(code, 0)
        self.assertEqual(len(out["inserted"]), 1)

        code, out = self.run_cli(["claim", "--token", "tokF1"], now=130)
        self.assertEqual(code, 0)
        self.assertEqual(out["title"], "a")

    def test_cli_bad_token_exits_nonzero(self):
        code, out = self.run_cli(["claim", "--token", "ghost"], now=130)
        self.assertEqual(code, 1)
        self.assertIn("error", out)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: FAIL — `AttributeError: module 'squad' has no attribute 'main'`.

- [ ] **Step 3: Write minimal implementation**

Ajouter en haut : `import argparse`, `import sys`, `import time`. Puis, en bas de `bus/squad.py` :

```python
def _connect(db_path):
    conn = sqlite3.connect(db_path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    return conn


def main(argv=None, now=None):
    argv = sys.argv[1:] if argv is None else argv
    now = int(time.time()) if now is None else now
    p = argparse.ArgumentParser(prog="squad")
    p.add_argument("--db", required=True)
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("post-tasks"); sp.add_argument("--token", required=True); sp.add_argument("--json", required=True)
    sp = sub.add_parser("claim"); sp.add_argument("--token", required=True)
    sp = sub.add_parser("submit"); sp.add_argument("--token", required=True); sp.add_argument("--task", type=int, required=True)
    sp = sub.add_parser("verify"); sp.add_argument("--token", required=True); sp.add_argument("--task", type=int, required=True)
    sp = sub.add_parser("msg"); sp.add_argument("--token", required=True); sp.add_argument("--to", required=True); sp.add_argument("--body", required=True)
    sp = sub.add_parser("inbox"); sp.add_argument("--token", required=True)
    sp = sub.add_parser("members"); sp.add_argument("--token", required=True)
    sp = sub.add_parser("list"); sp.add_argument("--token", required=True)
    sp = sub.add_parser("ping"); sp.add_argument("--token", required=True)

    args = p.parse_args(argv)
    conn = _connect(args.db)
    try:
        result = _dispatch(conn, args, now)
        print(json.dumps(result if result is not None else {"result": None}))
        return 0
    except NotAllowed as e:
        print(json.dumps({"error": str(e)}))
        return 1
    finally:
        conn.close()


def list_tasks(conn, token):
    member = resolve(conn, token)
    if member is None:
        raise NotAllowed("token inconnu")
    rows = conn.execute(
        "SELECT id, title, status, owned_paths, claimed_by_token FROM task "
        "WHERE squad_id=? ORDER BY id", (member["squad_id"],)).fetchall()
    return [dict(r) for r in rows]


def _dispatch(conn, args, now):
    if args.cmd == "post-tasks":
        return post_tasks(conn, args.token, json.loads(args.json), all_files=_repo_files(conn, args.token), now=now)
    if args.cmd == "claim":
        t = claim(conn, args.token, now)
        return dict(t) if t is not None else {"result": "no-task"}
    if args.cmd == "submit":
        submit(conn, args.token, args.task, now); return {"ok": True}
    if args.cmd == "verify":
        verify(conn, args.token, args.task, now); return {"ok": True}
    if args.cmd == "msg":
        msg(conn, args.token, args.to, args.body, now); return {"ok": True}
    if args.cmd == "inbox":
        return inbox(conn, args.token, now)
    if args.cmd == "members":
        return members(conn, args.token, now)
    if args.cmd == "list":
        return list_tasks(conn, args.token)
    if args.cmd == "ping":
        ping(conn, args.token, now); return {"ok": True}
    raise NotAllowed(f"commande inconnue: {args.cmd}")


def _repo_files(conn, token):
    member = resolve(conn, token)
    if member is None:
        return []
    import subprocess
    try:
        out = subprocess.run(["git", "-C", member["cwd"], "ls-files"],
                             capture_output=True, text=True, timeout=10)
        return [l for l in out.stdout.splitlines() if l]
    except Exception:
        return []


if __name__ == "__main__":
    sys.exit(main())
```

> Note : `_dispatch` retourne un objet `dict` pour `claim` (jamais une `sqlite3.Row` brute, qui ne sérialise pas en JSON). `_repo_files` utilise `git ls-files` pour l'expansion des globs (best-effort ; `[]` si pas un repo git — l'overlap retombe alors sur la règle `**`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bus && python3 -m unittest test_squad -v`
Expected: PASS (27 tests OK).

- [ ] **Step 5: Commit**

```bash
git add bus/squad.py bus/test_squad.py
git commit -m "feat(bus): CLI dispatcher with JSON output + list_tasks"
```

---

## Task 12: README du bus + démo manuelle bout-en-bout

**Files:**
- Create: `bus/README.md`

- [ ] **Step 1: Écrire le README**

`bus/README.md` :

````markdown
# Squad bus (sidecar)

Tableau partagé d'une escouade Vlaude. SQLite + Python 3 stdlib. Zéro dépendance.

## Tests
```bash
cd bus && python3 -m unittest -v
```

## CLI
Toutes les commandes : `python3 squad.py --db <chemin.db> <commande> --token <tok> [...]`.
L'identité de l'appelant est **toujours** résolue à partir de `--token` (jamais d'un champ du payload).

Commandes : `post-tasks --json <json>` (père) · `claim` · `submit --task <id>` ·
`verify --task <id>` (père) · `msg --to <nom|token> --body <txt>` · `inbox` · `members` · `list` · `ping`.

## Démo manuelle (2 « terminaux »)
```bash
DB=/tmp/demo-squad.db
python3 - "$DB" <<'PY'
import sys, sqlite3, squad
c = sqlite3.connect(sys.argv[1]); c.row_factory = sqlite3.Row
squad.init_db(c); squad.init_squad(c, "sq1", "tokP", ".", now=0)
squad.add_member(c, "tokF1", "sq1", "fils", "fils-1", ".", now=0)
PY
python3 squad.py --db "$DB" post-tasks --token tokP --json '[{"title":"a","description":"d","owned_paths":["a/**"]}]'
python3 squad.py --db "$DB" claim --token tokF1
python3 squad.py --db "$DB" submit --token tokF1 --task 1
python3 squad.py --db "$DB" verify --token tokP --task 1
python3 squad.py --db "$DB" list --token tokP
```
````

- [ ] **Step 2: Lancer la démo pour vérifier le bout-en-bout réel**

Run: `cd bus && bash -c 'sed -n "/^```bash/,/^```/p" README.md | sed "1d;\$d" > /tmp/demo.sh && bash /tmp/demo.sh'`
Expected: la dernière commande (`list`) imprime un JSON où le lot #1 a `"status": "verified"`.

> Si tu préfères, copie-colle simplement le bloc « Démo manuelle » dans un shell depuis `bus/`. Le but est de voir le cycle `post → claim → submit → verify` aboutir à `verified` sur un vrai fichier `.db`.

- [ ] **Step 3: Commit**

```bash
git add bus/README.md
git commit -m "docs(bus): README + end-to-end manual demo"
```

---

## Self-Review (effectué)

**Couverture spec (Phase 1, partie bus) :** modèle de données §5.4 → Tasks 1-3,9 ; identité par token §5.5 → Tasks 2,9,11 (résolution code-side, `from` non falsifiable) ; `claim` atomique §5.4 → Task 4 ; `submit`/`verify` §5.11 → Tasks 5,6 ; release par bail §5.7 → Task 7 ; disjonction §5.6 (flag, décision #4) → Task 8 ; scoping `squad_id` §5.8 → présent dans toutes les requêtes (dérivé du token) ; messages → Task 9 ; membres alive/gone → Task 10 ; CLI → Tasks 11,12.

**Hors-scope de ce plan (→ Plan 2/3, explicite) :** geste de lien + panneau + store (TS/React) ; lecture read-only du `.db` par Vlaude (Rust/rusqlite) + `member_gone` accéléré ; écriture des fichiers skill + injection `pty_write` du token et du slash-command ; contrainte même-cwd à l'enrôlement ; check `git status` de sortie-de-périmètre au submit (nécessite Vlaude/contexte repo réel) ; détecteur d'état « prêt ».

**Cohérence des noms :** `init_db`, `init_squad`, `add_member`, `resolve`, `post_tasks`, `claim`, `submit`, `verify`, `_reap`, `ping`, `paths_overlap`/`expand`/`_contains`/`_globs_overlap`, `msg`, `inbox`, `members`, `list_tasks`, `main`/`_dispatch`/`_connect`/`_repo_files`. Constantes `LEASE_TTL`, `MEMBER_TTL`. Exception `NotAllowed`. Signatures `(conn, …, now)` homogènes. Vérifié cohérent entre tasks.

**Pas de placeholder :** chaque step porte le code réel.

---

## Corrections post-review (appliquées dans le repo — source de vérité = `bus/`)

La passe de review qualité (spec ✅ + qualité, avec boucle de fix) a durci 3 points au-delà des tasks ci-dessus. Le code dans `bus/` les inclut ; les blocs de tasks ci-dessus reflètent l'état pré-review.

1. **`verify` — scoping escouade (Important).** `verify` exige désormais `task.squad_id == member.squad_id` (sinon `NotAllowed`). Sans ça, un père d'une autre escouade pouvait passer `verified` un lot étranger — contredisait le scoping promis (spec §5.5). Le `SELECT` ramène `status, squad_id`.
2. **`submit` — garde de statut (Important).** `submit` exige `status == 'claimed'` (en plus de l'owner-check). Sans ça, un re-`submit` d'un lot déjà `verified` le faisait régresser silencieusement en `submitted`. Le `SELECT` ramène `claimed_by_token, status`.
3. **`claim` — robustesse verrou (Minor).** `_connect` ouvre la connexion avec `timeout=30` ; `main` attrape `(NotAllowed, sqlite3.OperationalError)` → JSON `{"error": …}` + exit 1, au lieu d'un traceback brut sur `database is locked`. (Tradeoff connu : `OperationalError` englobe aussi un SQL malformé — acceptable car le SQL du module est statique.)

**Tests ajoutés** (verrouillent 1 et 2, prouvés rouges sans le fix par mutation) : `CrossSquadTest`, `SubmitGuardTest`, `ClaimAtomicityTest` (atomicité multi-threads sur DB disque). **Total : 31 tests, tous verts.**

