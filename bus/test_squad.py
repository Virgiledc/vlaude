import io
import json as _json
import os
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stdout

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

    def test_init_replaces_previous_squad(self):
        conn = fresh()
        squad.init_squad(conn, "sq1", "tokP1", "/r", now=100)
        squad.add_member(conn, "tokF1", "sq1", "fils", "fils-1", "/r", now=100)
        squad.post_tasks(conn, "tokP1",
                         tasks=[{"title": "Old", "description": "d", "owned_paths": ["a/**"]}],
                         all_files=[], now=100)
        squad.init_squad(conn, "sq2", "tokP2", "/r", now=200)
        v = squad.view(conn, now=200)
        self.assertEqual(v["squad"]["squad_id"], "sq2")
        self.assertEqual([m["name"] for m in v["members"]], ["pere"])
        self.assertEqual(v["tasks"], [])
        self.assertIsNone(squad.resolve(conn, "tokP1"))


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
        squad.claim(self.conn, "tokF1", now=130)
        later = 130 + squad.LEASE_TTL + 1
        task = squad.claim(self.conn, "tokF2", now=later)
        self.assertIsNotNone(task)
        self.assertEqual(task["title"], "a")
        self.assertEqual(task["claimed_by_token"], "tokF2")

    def test_fresh_claim_is_not_released(self):
        squad.claim(self.conn, "tokF1", now=130)
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
        self.assertEqual(len(res["inserted"]), 2)
        self.assertEqual(len(res["overlaps"]), 1)
        pair = res["overlaps"][0]
        self.assertEqual(set(pair["titles"]), {"broad", "narrow"})


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
        self.assertEqual(squad.inbox(self.conn, "tokF2", now=131), [])

    def test_from_is_token_resolved_not_payload(self):
        squad.msg(self.conn, "tokF1", to="fils-2", body="x", now=120)
        row = self.conn.execute("SELECT from_token FROM message").fetchone()
        self.assertEqual(row["from_token"], "tokF1")


class MembersTest(unittest.TestCase):
    def setUp(self):
        self.conn = fresh()
        squad.init_squad(self.conn, "sq1", "tokP", "/repo", now=100)
        squad.add_member(self.conn, "tokF1", "sq1", "fils", "fils-1", "/repo", now=110)

    def test_members_lists_role_and_liveness(self):
        out = squad.members(self.conn, "tokP", now=120)
        by_name = {m["name"]: m for m in out}
        self.assertEqual(by_name["pere"]["role"], "pere")
        self.assertTrue(by_name["fils-1"]["alive"])

    def test_member_goes_stale_past_member_ttl(self):
        out = squad.members(self.conn, "tokP", now=110 + squad.MEMBER_TTL + 1)
        by_name = {m["name"]: m for m in out}
        self.assertFalse(by_name["fils-1"]["alive"])


class CliTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.db = os.path.join(self.dir, "squad.db")
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


class CrossSquadTest(unittest.TestCase):
    def setUp(self):
        self.conn_a = fresh()
        squad.init_squad(self.conn_a, "sqA", "tokPA", "/repoA", now=100)
        squad.add_member(self.conn_a, "tokFA", "sqA", "fils", "fils-a", "/repoA", now=100)
        self.conn_b = fresh()
        squad.init_squad(self.conn_b, "sqB", "tokPB", "/repoB", now=100)
        squad.post_tasks(self.conn_a, "tokPA",
                         tasks=[{"title": "a", "description": "", "owned_paths": ["a/**"]}],
                         all_files=[], now=120)
        self.task = squad.claim(self.conn_a, "tokFA", now=130)
        squad.submit(self.conn_a, "tokFA", self.task["id"], now=140)

    def test_pere_of_other_squad_cannot_verify(self):
        with self.assertRaises(squad.NotAllowed):
            squad.verify(self.conn_a, "tokPB", self.task["id"], now=150)
        squad.verify(self.conn_a, "tokPA", self.task["id"], now=151)
        row = self.conn_a.execute("SELECT status FROM task WHERE id=?", (self.task["id"],)).fetchone()
        self.assertEqual(row["status"], "verified")


class SubmitGuardTest(unittest.TestCase):
    def setUp(self):
        self.conn = fresh()
        squad.init_squad(self.conn, "sq1", "tokP", "/repo", now=100)
        squad.add_member(self.conn, "tokF1", "sq1", "fils", "fils-1", "/repo", now=110)
        squad.post_tasks(self.conn, "tokP",
                         tasks=[{"title": "a", "description": "", "owned_paths": ["a/**"]}],
                         all_files=[], now=120)
        self.task = squad.claim(self.conn, "tokF1", now=130)

    def test_double_submit_rejected(self):
        squad.submit(self.conn, "tokF1", self.task["id"], now=140)
        with self.assertRaises(squad.NotAllowed):
            squad.submit(self.conn, "tokF1", self.task["id"], now=141)

    def test_submit_after_verify_rejected(self):
        squad.submit(self.conn, "tokF1", self.task["id"], now=140)
        squad.verify(self.conn, "tokP", self.task["id"], now=150)
        with self.assertRaises(squad.NotAllowed):
            squad.submit(self.conn, "tokF1", self.task["id"], now=160)


class ClaimAtomicityTest(unittest.TestCase):
    def test_concurrent_threads_never_double_claim(self):
        import threading
        d = tempfile.mkdtemp()
        db = os.path.join(d, "squad.db")
        c0 = sqlite3.connect(db, isolation_level=None); c0.row_factory = sqlite3.Row
        squad.init_db(c0)
        squad.init_squad(c0, "sq1", "tokP", "/repo", now=0)
        N = 12
        for i in range(N):
            squad.add_member(c0, f"tokF{i}", "sq1", "fils", f"fils-{i}", "/repo", now=0)
        squad.post_tasks(c0, "tokP",
                         tasks=[{"title": f"t{i}", "description": "", "owned_paths": [f"{i}/**"]}
                                for i in range(N)], all_files=[], now=0)
        c0.close()

        results = []
        lock = threading.Lock()
        barrier = threading.Barrier(N)

        def worker(idx):
            conn = sqlite3.connect(db, isolation_level=None, timeout=30); conn.row_factory = sqlite3.Row
            barrier.wait()
            t = squad.claim(conn, f"tokF{idx}", now=10)
            conn.close()
            with lock:
                results.append(t["id"] if t else None)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
        for th in threads: th.start()
        for th in threads: th.join()
        ids = [r for r in results if r is not None]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(ids), N)


class ViewTest(unittest.TestCase):
    def test_view_is_readonly_resolves_names_and_derives_liveness(self):
        conn = fresh()
        squad.init_squad(conn, "sq1", "tokP", "/r", now=100)
        squad.add_member(conn, "tokF1", "sq1", "fils", "fils-1", "/r", now=100)
        squad.post_tasks(conn, "tokP",
                         tasks=[{"title": "API", "description": "d", "owned_paths": ["src/**"]}],
                         all_files=[], now=100)
        squad.claim(conn, "tokF1", now=100)

        v = squad.view(conn, now=999)
        last_seen = conn.execute("SELECT last_seen FROM member WHERE token='tokF1'").fetchone()[0]
        self.assertEqual(last_seen, 100)

        self.assertEqual(v["squad"]["squad_id"], "sq1")
        self.assertEqual({m["name"] for m in v["members"]}, {"pere", "fils-1"})
        f1 = next(m for m in v["members"] if m["name"] == "fils-1")
        self.assertFalse(f1["alive"])
        self.assertEqual(f1["last_seen"], 100)
        t = v["tasks"][0]
        self.assertEqual(t["status"], "claimed")
        self.assertEqual(t["claimed_by"], "fils-1")
        self.assertEqual(t["owned_paths"], ["src/**"])


class CliLifecycleTest(unittest.TestCase):
    def run_cli(self, db, args, now):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = squad.main(["--db", db] + args, now=now)
        return code, _json.loads(buf.getvalue())

    def test_init_add_member_view_via_cli(self):
        db = os.path.join(tempfile.mkdtemp(), "squad.db")

        code, out = self.run_cli(db, ["init", "--squad-id", "sq1", "--pere-token", "tokP", "--cwd", "/r"], now=100)
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])

        code, _ = self.run_cli(db, ["add-member", "--member-token", "tokF1", "--squad-id", "sq1",
                                    "--role", "fils", "--name", "fils-1", "--cwd", "/r"], now=100)
        self.assertEqual(code, 0)

        code, out = self.run_cli(db, ["view"], now=100)
        self.assertEqual(code, 0)
        self.assertEqual(out["squad"]["squad_id"], "sq1")
        self.assertEqual({m["name"] for m in out["members"]}, {"pere", "fils-1"})


if __name__ == "__main__":
    unittest.main()
