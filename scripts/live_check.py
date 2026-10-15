#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

CLASS = "vlaude-live"


def hypr(*args):
    return subprocess.run(["hyprctl", *args], capture_output=True, text=True).stdout


def wait_for(pred, timeout, step=0.1):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        v = pred()
        if v:
            return v
        time.sleep(step)
    return None


def answered(path, word):
    if not path:
        return False
    for raw in path.read_text().splitlines():
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        if d.get("type") == "assistant" and word in json.dumps(d.get("message", {}).get("content", ""), ensure_ascii=False):
            return True
    return False


def shot(path):
    subprocess.run(["grim", "-o", "VLTEST", str(path)], check=True)
    return str(path)


def main():
    ap = argparse.ArgumentParser(description="vraie tuile claude dans une instance Vlaude isolée : vlaude send puis réponse")
    ap.add_argument("binary")
    ap.add_argument("--cwd", default=str(Path.home() / "dt"))
    ap.add_argument("--root", default="/tmp/vlaude-live")
    ap.add_argument("--message", default="Réponds uniquement par le mot PONG, sans rien d'autre.")
    a = ap.parse_args()
    root = Path(a.root)
    shutil.rmtree(root, ignore_errors=True)
    home = root / "home"
    data = home / ".local/share/com.vlaude.app"
    data.mkdir(parents=True)
    real = Path.home()
    (home / ".claude").symlink_to(real / ".claude")
    (home / ".claude.json").symlink_to(real / ".claude.json")
    sid, csid = str(uuid.uuid4()), str(uuid.uuid4())
    (data / "layout.json").write_text(json.dumps({
        "workspaces": [{"id": "ws-1", "name": "Live"}], "activeWorkspaceId": "ws-1",
        "sessions": [{"id": sid, "name": "live", "cwd": a.cwd, "workspaceId": "ws-1", "order": 0, "state": "idle",
                      "openInCanvas": True, "claudeSessionId": csid, "kind": "claude"}],
        "counter": 1, "workspaceCounter": 1, "layouts": {"ws-1": [{"i": sid, "x": 0, "y": 0, "w": 12, "h": 14}]},
        "sidebarWidth": 200}))
    exe = root / CLASS
    shutil.copy(a.binary, exe)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("VLAUDE_", "CLAUDE"))}
    env.update(HOME=str(home), XDG_DATA_HOME=str(home / ".local/share"), XDG_CONFIG_HOME=str(home / ".config"),
               XDG_CACHE_HOME=str(home / ".cache"), XDG_STATE_HOME=str(home / ".local/state"))
    unit = f"{CLASS}-{uuid.uuid4().hex[:8]}"
    hypr("eval", 'hl.monitor({ output = "VLTEST", mode = "1920x1200@60", position = "auto", scale = 1.25 })')
    hypr("eval", 'hl.workspace_rule({ workspace = "99", monitor = "VLTEST", default = true })')
    hypr("eval", f'hl.window_rule({{ match = {{ class = "{CLASS}" }}, workspace = "99 silent" }})')
    hypr("output", "create", "headless", "VLTEST")
    res = {}
    try:
        subprocess.run(["systemd-run", "--user", "--quiet", "--collect", f"--unit={unit}",
                        f"--property=StandardError=file:{root / 'stderr.log'}",
                        *[f"--setenv={k}={v}" for k, v in env.items()], str(exe)], check=True)
        bus = home / ".vlaude/bus"
        tiles = wait_for(lambda: (bus / "tiles.json").exists() and json.loads((bus / "tiles.json").read_text()), 20)
        res["tile_publiee"] = bool(tiles)
        cli = home / ".local/bin/vlaude"
        res["cli_installe"] = bool(wait_for(cli.exists, 10))
        transcript = lambda: next(iter(real.glob(f".claude/projects/*/{csid}.jsonl")), None)
        time.sleep(8)
        res["capture_avant"] = shot(root / "avant.png")
        t0 = time.monotonic()
        subprocess.run([sys.executable, str(cli), "send", "live", a.message], env={**env, "HOME": str(home), "VLAUDE_BUS": str(bus)}, check=True)
        out = bus / "out"
        delivered = wait_for(lambda: not any(out.glob("*.json")), 5, 0.005)
        res["livraison_ms"] = round((time.monotonic() - t0) * 1000) if delivered else None
        pong = wait_for(lambda: answered(transcript(), "PONG"), 90, 0.5)
        res["pong"] = bool(pong)
        res["reponse_s"] = round(time.monotonic() - t0, 1)
        time.sleep(1.5)
        res["capture_apres"] = shot(root / "apres.png")
        res["transcript"] = str(transcript())
    finally:
        subprocess.run(["systemctl", "--user", "stop", unit], capture_output=True)
        hypr("output", "remove", "VLTEST")
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
