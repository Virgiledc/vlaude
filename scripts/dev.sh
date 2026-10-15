#!/usr/bin/env bash
cd "$(dirname "$0")/.." && exec npm run tauri dev > "${1:-/tmp/vlaude-dev.log}" 2>&1
