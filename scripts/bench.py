#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
TICK = os.sysconf("SC_CLK_TCK")
CLASS = "vlaude-bench"


def hypr(*args):
    return subprocess.run(["hyprctl", *args], capture_output=True, text=True).stdout


def children(pid):
    out = []
    for p in Path("/proc").iterdir():
        if not p.name.isdigit():
            continue
        try:
            ppid = int((p / "stat").read_text().rsplit(")", 1)[1].split()[1])
        except (OSError, IndexError):
            continue
        if ppid == pid:
            out.append(int(p.name))
    return out


def comm(pid):
    try:
        return Path(f"/proc/{pid}/comm").read_text().strip()
    except OSError:
        return ""


def ticks(pid):
    try:
        f = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return int(f[11]) + int(f[12])
    except OSError:
        return 0


def switches(pid):
    total = 0
    for t in Path(f"/proc/{pid}/task").glob("*"):
        try:
            for l in (t / "status").read_text().splitlines():
                if l.startswith(("voluntary_ctxt_switches", "nonvoluntary_ctxt_switches")):
                    total += int(l.split()[1])
        except OSError:
            pass
    return total


def thread_ticks(pid):
    out = {}
    for t in Path(f"/proc/{pid}/task").glob("*"):
        try:
            f = (t / "stat").read_text()
            name = f[f.index("(") + 1:f.rindex(")")]
            rest = f.rsplit(")", 1)[1].split()
            out[t.name] = (name, int(rest[11]) + int(rest[12]))
        except (OSError, ValueError):
            pass
    return out


def top_threads(before, after, duration, k=4):
    agg = {}
    for tid, (name, t1) in after.items():
        t0 = before.get(tid, (name, t1))[1] if tid in before else 0
        agg[name] = agg.get(name, 0) + t1 - t0
    best = sorted(agg.items(), key=lambda x: -x[1])[:k]
    return {n: round(v * 100 / TICK / duration, 1) for n, v in best if v}


def pss_mb(pid):
    try:
        for l in Path(f"/proc/{pid}/smaps_rollup").read_text().splitlines():
            if l.startswith("Pss:"):
                return round(int(l.split()[1]) / 1024, 1)
    except OSError:
        pass
    return 0.0


def app_procs(main):
    procs = {"main": main}
    for c in children(main):
        name = comm(c)
        if name.startswith("WebKitWebProc"):
            procs["web"] = c
        elif name.startswith("WebKitNetwork"):
            procs["net"] = c
    return procs


def agents(root):
    out = []
    for p in Path("/proc").iterdir():
        if p.name.isdigit():
            try:
                if str(root / "bin" / "claude") in (p / "cmdline").read_text().replace("\0", " "):
                    out.append(int(p.name))
            except OSError:
                pass
    return out


def layout(n):
    ids = [str(uuid.uuid4()) for _ in range(n)]
    sessions = [{"id": i, "name": f"bench-{k + 1}", "cwd": "/tmp", "workspaceId": "ws-1", "order": k,
                 "state": "idle", "openInCanvas": True, "claudeSessionId": str(uuid.uuid4()), "kind": "claude"}
                for k, i in enumerate(ids)]
    items = [{"i": i, "x": (k % 2) * 6, "y": (k // 2) * 6, "w": 6, "h": 6} for k, i in enumerate(ids)]
    return {"workspaces": [{"id": "ws-1", "name": "Bench"}], "activeWorkspaceId": "ws-1", "sessions": sessions,
            "counter": n, "workspaceCounter": 1, "layouts": {"ws-1": items}, "sidebarWidth": 200}


def run(binary, mode, n, warmup, duration, root, shot=""):
    home = root / "home"
    if home.exists():
        shutil.rmtree(home / ".local" / "share" / "com.vlaude.app", ignore_errors=True)
    data = home / ".local" / "share" / "com.vlaude.app"
    data.mkdir(parents=True, exist_ok=True)
    (data / "layout.json").write_text(json.dumps(layout(n)))
    bindir = root / "bin"
    bindir.mkdir(exist_ok=True)
    agent = bindir / "claude"
    shutil.copy(HERE / "bench_agent.py", agent)
    agent.chmod(0o755)
    exe = root / CLASS
    shutil.copy(binary, exe)
    counters = root / "counters"
    shutil.rmtree(counters, ignore_errors=True)
    counters.mkdir()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("VLAUDE_", "CLAUDE"))}
    env.update(HOME=str(home), XDG_DATA_HOME=str(home / ".local/share"), XDG_CONFIG_HOME=str(home / ".config"),
               XDG_CACHE_HOME=str(home / ".cache"), XDG_STATE_HOME=str(home / ".local/state"),
               PATH=f"{bindir}:{env['PATH']}", VL_BENCH_MODE=mode, VL_BENCH_COUNTERS=str(counters))
    for k, v in json.loads(os.environ.get("VL_BENCH_ENV", "{}")).items():
        env[k] = v
    unit = f"{CLASS}-{uuid.uuid4().hex[:8]}"
    props = [f"--setenv={k}={v}" for k, v in env.items()]
    t0 = time.monotonic()
    subprocess.run(["systemd-run", "--user", "--quiet", "--collect", f"--unit={unit}",
                    f"--property=StandardError=file:{root / 'stderr.log'}", *props, str(exe)], check=True)
    main_pid = 0
    try:
        while len(agents(root)) < n:
            if not main_pid:
                main_pid = int(subprocess.run(["systemctl", "--user", "show", "-P", "MainPID", unit],
                                              capture_output=True, text=True).stdout.strip() or 0)
            if time.monotonic() - t0 > 30:
                raise RuntimeError(f"agents {len(agents(root))}/{n}, MainPID {main_pid}")
            time.sleep(0.05)
        startup = time.monotonic() - t0
        time.sleep(warmup)
        if shot:
            subprocess.run(["grim", "-o", "VLTEST", shot], check=True)
        procs = app_procs(main_pid)
        before = {k: (ticks(p), switches(p)) for k, p in procs.items()}
        threads0 = {k: thread_ticks(p) for k, p in procs.items()}
        bytes0 = sum(int(f.read_text() or 0) for f in counters.iterdir())
        time.sleep(duration)
        threads1 = {k: thread_ticks(p) for k, p in procs.items()}
        after = {k: (ticks(p), switches(p)) for k, p in procs.items()}
        bytes1 = sum(int(f.read_text() or 0) for f in counters.iterdir())
        res = {"mode": mode, "tiles": n, "startup_s": round(startup, 2)}
        for k in procs:
            res[f"cpu_{k}"] = round((after[k][0] - before[k][0]) * 100 / TICK / duration, 1)
            res[f"wake_{k}"] = round((after[k][1] - before[k][1]) / duration)
            res[f"pss_{k}"] = pss_mb(procs[k])
            if k != "net":
                res[f"threads_{k}"] = top_threads(threads0[k], threads1[k], duration)
        res["cpu_total"] = round(sum(res[f"cpu_{k}"] for k in procs), 1)
        res["kb_s"] = round((bytes1 - bytes0) / 1024 / duration, 1)
        clients = json.loads(hypr("clients", "-j"))
        mine = [c for c in clients if c["pid"] == main_pid]
        res["window"] = f'{mine[0]["class"]} ws {mine[0]["workspace"]["name"]}' if mine else "absent"
        return res
    finally:
        subprocess.run(["systemctl", "--user", "stop", unit], capture_output=True)
        for p in agents(root):
            try:
                os.kill(p, signal.SIGKILL)
            except OSError:
                pass

def main():
    ap = argparse.ArgumentParser(description="banc CPU / réveils / mémoire d'une instance Vlaude isolée")
    ap.add_argument("binary")
    ap.add_argument("--modes", default="idle,work,flood")
    ap.add_argument("--tiles", type=int, default=6)
    ap.add_argument("--warmup", type=float, default=6)
    ap.add_argument("--duration", type=float, default=20)
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--root", default="/tmp/vlaude-bench")
    ap.add_argument("--label", default="")
    ap.add_argument("--hz", type=int, default=144)
    ap.add_argument("--shot", default="", help="capture grim de l'écran headless après le warmup")
    a = ap.parse_args()
    root = Path(a.root)
    root.mkdir(parents=True, exist_ok=True)
    hypr("eval", f'hl.monitor({{ output = "VLTEST", mode = "1920x1200@{a.hz}", position = "auto", scale = 1.25 }})')
    hypr("eval", 'hl.workspace_rule({ workspace = "99", monitor = "VLTEST", default = true })')
    hypr("eval", f'hl.window_rule({{ match = {{ class = "{CLASS}" }}, workspace = "99 silent" }})')
    hypr("output", "create", "headless", "VLTEST")
    try:
        time.sleep(0.5)
        for _ in range(a.repeat):
            for mode in a.modes.split(","):
                res = run(Path(a.binary).resolve(), mode, a.tiles, a.warmup, a.duration, root, a.shot.replace("{mode}", mode))
                res["label"] = a.label
                print(json.dumps(res, ensure_ascii=False), flush=True)
    finally:
        hypr("output", "remove", "VLTEST")


if __name__ == "__main__":
    sys.exit(main())
