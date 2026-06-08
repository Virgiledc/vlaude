import argparse
import fnmatch
import json
import sqlite3
import sys
import time


LEASE_TTL = 900
MEMBER_TTL = 120


class NotAllowed(Exception):
    pass


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
    conn.execute("DELETE FROM message")
    conn.execute("DELETE FROM task")
    conn.execute("DELETE FROM member")
    conn.execute("DELETE FROM squad")
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


def add_member(conn, token, squad_id, role, name, cwd, now):
    conn.execute(
        "INSERT INTO member (token, squad_id, role, name, cwd, status, last_seen) "
        "VALUES (?, ?, ?, ?, ?, 'alive', ?)",
        (token, squad_id, role, name, cwd, now),
    )
    conn.commit()


def resolve(conn, token):
    return conn.execute("SELECT * FROM member WHERE token=?", (token,)).fetchone()


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


def _touch(conn, token, now):
    conn.execute("UPDATE member SET last_seen=?, status='alive' WHERE token=?", (now, token))


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


def submit(conn, token, task_id, now):
    _touch(conn, token, now)
    row = conn.execute("SELECT claimed_by_token, status FROM task WHERE id=?", (task_id,)).fetchone()
    if row is None or row["claimed_by_token"] != token or row["status"] != "claimed":
        conn.commit()
        raise NotAllowed("seul l'owner peut soumettre un lot 'claimed'")
    conn.execute("UPDATE task SET status='submitted' WHERE id=?", (task_id,))
    conn.commit()


def verify(conn, token, task_id, now):
    member = resolve(conn, token)
    if member is None or member["role"] != "pere":
        raise NotAllowed("seul le père peut vérifier un lot")
    _touch(conn, token, now)
    row = conn.execute("SELECT status, squad_id FROM task WHERE id=?", (task_id,)).fetchone()
    if row is None or row["squad_id"] != member["squad_id"] or row["status"] != "submitted":
        conn.commit()
        raise NotAllowed("le lot doit appartenir à ton escouade et être 'submitted'")
    conn.execute("UPDATE task SET status='verified' WHERE id=?", (task_id,))
    conn.commit()


def ping(conn, token, now):
    member = resolve(conn, token)
    if member is None:
        raise NotAllowed("token inconnu")
    _touch(conn, token, now)
    conn.commit()


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


def view(conn, now):
    name_by_token = {r["token"]: r["name"] for r in conn.execute("SELECT token, name FROM member")}
    squads = conn.execute("SELECT squad_id, cwd FROM squad").fetchall()
    members = conn.execute(
        "SELECT name, role, last_seen FROM member ORDER BY role DESC, name"
    ).fetchall()
    tasks = conn.execute(
        "SELECT id, title, status, owned_paths, claimed_by_token FROM task ORDER BY id"
    ).fetchall()
    return {
        "squad": ({"squad_id": squads[0]["squad_id"], "cwd": squads[0]["cwd"]} if squads else None),
        "members": [
            {"name": r["name"], "role": r["role"], "last_seen": r["last_seen"],
             "alive": (now - r["last_seen"]) <= MEMBER_TTL}
            for r in members
        ],
        "tasks": [
            {"id": r["id"], "title": r["title"], "status": r["status"],
             "owned_paths": json.loads(r["owned_paths"]),
             "claimed_by": name_by_token.get(r["claimed_by_token"])}
            for r in tasks
        ],
    }


def _connect(db_path):
    conn = sqlite3.connect(db_path, isolation_level=None, timeout=30)
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
    sp = sub.add_parser("init"); sp.add_argument("--squad-id", required=True); sp.add_argument("--pere-token", required=True); sp.add_argument("--cwd", required=True)
    sp = sub.add_parser("add-member"); sp.add_argument("--member-token", required=True); sp.add_argument("--squad-id", required=True); sp.add_argument("--role", required=True, choices=["pere", "fils"]); sp.add_argument("--name", required=True); sp.add_argument("--cwd", required=True)
    sp = sub.add_parser("view")

    args = p.parse_args(argv)
    conn = _connect(args.db)
    try:
        result = _dispatch(conn, args, now)
        print(json.dumps(result if result is not None else {"result": None}))
        return 0
    except (NotAllowed, sqlite3.OperationalError) as e:
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
    if args.cmd == "init":
        init_db(conn); init_squad(conn, args.squad_id, args.pere_token, args.cwd, now); return {"ok": True, "squad_id": args.squad_id}
    if args.cmd == "add-member":
        add_member(conn, args.member_token, args.squad_id, args.role, args.name, args.cwd, now); return {"ok": True}
    if args.cmd == "view":
        return view(conn, now)
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
