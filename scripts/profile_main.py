#!/usr/bin/env python3
import argparse
import collections
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bench import CLASS, agents, app_procs, hypr, layout

PTRACER_ANY = "import ctypes,os,sys; ctypes.CDLL(None).prctl(0x59616d61, ctypes.c_ulong(-1), 0, 0, 0); os.execv(sys.argv[1], sys.argv[1:])"


def stacks(pid, tid):
    out = subprocess.run(["eu-stack", "-p", str(pid)], capture_output=True, text=True).stdout
    frames, current = [], None
    for line in out.splitlines():
        m = re.match(r"TID (\d+):", line)
        if m:
            current = int(m.group(1))
            continue
        if current == tid:
            m = re.match(r"#\d+\s+0x[0-9a-f]+\s*(.*)", line.strip())
            if m:
                frames.append(m.group(1).strip() or "??")
    return frames


def main():
    ap = argparse.ArgumentParser(description="échantillonne les piles du thread GTK d'une instance de banc")
    ap.add_argument("binary")
    ap.add_argument("--mode", default="work")
    ap.add_argument("--tiles", type=int, default=6)
    ap.add_argument("--samples", type=int, default=150)
    ap.add_argument("--interval", type=float, default=0.05)
    ap.add_argument("--root", default="/tmp/vlaude-bench")
    ap.add_argument("--show", default="", help="affiche les piles complètes contenant ce symbole")
    a = ap.parse_args()
    root = Path(a.root)
    home = root / "home"
    shutil.rmtree(home / ".local/share/com.vlaude.app", ignore_errors=True)
    data = home / ".local/share/com.vlaude.app"
    data.mkdir(parents=True, exist_ok=True)
    (data / "layout.json").write_text(json.dumps(layout(a.tiles)))
    bindir = root / "bin"
    bindir.mkdir(parents=True, exist_ok=True)
    shutil.copy(Path(__file__).resolve().parent / "bench_agent.py", bindir / "claude")
    (bindir / "claude").chmod(0o755)
    exe = root / CLASS
    shutil.copy(a.binary, exe)
    counters = root / "counters"
    shutil.rmtree(counters, ignore_errors=True)
    counters.mkdir()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("VLAUDE_", "CLAUDE"))}
    env.update(HOME=str(home), XDG_DATA_HOME=str(home / ".local/share"), XDG_CONFIG_HOME=str(home / ".config"),
               XDG_CACHE_HOME=str(home / ".cache"), XDG_STATE_HOME=str(home / ".local/state"),
               PATH=f"{bindir}:{env['PATH']}", VL_BENCH_MODE=a.mode, VL_BENCH_COUNTERS=str(counters))
    unit = f"{CLASS}-{uuid.uuid4().hex[:8]}"
    hypr("eval", 'hl.monitor({ output = "VLTEST", mode = "1920x1200@60", position = "auto", scale = 1.25 })')
    hypr("eval", 'hl.workspace_rule({ workspace = "99", monitor = "VLTEST", default = true })')
    hypr("eval", f'hl.window_rule({{ match = {{ class = "{CLASS}" }}, workspace = "99 silent" }})')
    hypr("output", "create", "headless", "VLTEST")
    try:
        subprocess.run(["systemd-run", "--user", "--quiet", "--collect", f"--unit={unit}",
                        *[f"--setenv={k}={v}" for k, v in env.items()], sys.executable, "-c", PTRACER_ANY, str(exe)],
                       check=True)
        t0 = time.monotonic()
        while len(agents(root)) < a.tiles and time.monotonic() - t0 < 30:
            time.sleep(0.1)
        time.sleep(5)
        main_pid = int(subprocess.run(["systemctl", "--user", "show", "-P", "MainPID", unit],
                                      capture_output=True, text=True).stdout.strip())
        leaf, inclusive, n, shown = collections.Counter(), collections.Counter(), 0, collections.Counter()
        for _ in range(a.samples):
            fr = stacks(main_pid, main_pid)
            if fr:
                n += 1
                leaf[fr[0]] += 1
                for f in set(fr):
                    inclusive[f] += 1
                if a.show and any(a.show in f for f in fr):
                    shown[" <- ".join(f.split("::h")[0][:70] for f in fr[:24])] += 1
            time.sleep(a.interval)
        print(f"{n} échantillons du thread principal (pid {main_pid}, procs {app_procs(main_pid)})")
        for st, c in shown.most_common(4):
            print(f"== pile x{c}: {st}")
        print("== feuilles")
        for f, c in leaf.most_common(15):
            print(f"{c * 100 // max(n, 1):3d}%  {f[:150]}")
        print("== inclusif")
        for f, c in inclusive.most_common(45):
            print(f"{c * 100 // max(n, 1):3d}%  {f[:150]}")
    finally:
        subprocess.run(["systemctl", "--user", "stop", unit], capture_output=True)
        hypr("output", "remove", "VLTEST")


if __name__ == "__main__":
    main()
