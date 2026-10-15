#!/usr/bin/env bash
set -euo pipefail
out="${1:-/tmp/vlaude-shot.png}"
hyprctl eval 'hl.monitor({ output = "VLTEST", mode = "1920x1200", position = "auto", scale = 1.5 })' >/dev/null
hyprctl eval 'hl.workspace_rule({ workspace = "99", monitor = "VLTEST", default = true })' >/dev/null
hyprctl output create headless VLTEST >/dev/null
trap 'hyprctl output remove VLTEST >/dev/null' EXIT
sleep 0.5
sleep "${SHOT_WAIT:-1}"
hyprctl monitors -j | python3 -c 'import json,sys; [print(m["name"], "ws", m["activeWorkspace"]["name"]) for m in json.load(sys.stdin)]' >&2
grim -o VLTEST "$out"
echo "$out"
