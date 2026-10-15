#!/usr/bin/env python3
import os
import signal
import sys
import time

MODE = os.environ.get("VL_BENCH_MODE", "idle")
COUNTERS = os.environ.get("VL_BENCH_COUNTERS", "")
SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
WORDS = ("refactor", "pty", "coalesce", "channel", "xterm", "render", "webgl", "atlas", "tile", "agent")

out = sys.stdout.buffer
written = 0
last_dump = time.monotonic()


def emit(s):
    global written, last_dump
    b = s.encode()
    out.write(b)
    out.flush()
    written += len(b)
    now = time.monotonic()
    if COUNTERS and now - last_dump >= 1:
        last_dump = now
        with open(os.path.join(COUNTERS, str(os.getpid())), "w") as f:
            f.write(str(written))


def line(i):
    w = " ".join(WORDS[(i * 7 + k) % len(WORDS)] for k in range(14))
    return f"\x1b[38;5;{110 + i % 6}m●\x1b[0m {i:06d} \x1b[1m{w[:40]}\x1b[0m{w[40:]}\r\n"


def status(i):
    return (f"\x1b[38;5;117m{SPIN[i % len(SPIN)]}\x1b[0m Working… ({i // 12}s · ↓ {i * 37 % 9000} tokens · esc to interrupt)\r\n"
            "\x1b[2m────────────────────────────────────────\x1b[0m\r\n"
            "> \x1b[7m \x1b[0m")


def idle():
    emit("\x1b]0;✳ Claude Code\x07\x1b[2J\x1b[H")
    for i in range(12):
        emit(line(i))
    emit("\r\n╭──────────────────────────────╮\r\n│ > Try \"refactor pty\"          │\r\n╰──────────────────────────────╯\r\n  ? for shortcuts")
    while True:
        signal.pause()


def work():
    emit("\x1b[2J\x1b[H\r\n\r\n")
    i = 0
    while True:
        emit(f"\x1b]0;{SPIN[i % len(SPIN)]} Claude Code\x07\x1b[2F\x1b[J" + line(i) + status(i))
        i += 1
        time.sleep(0.08)


def flood():
    i = 0
    while True:
        chunk = "".join(line(i + k) for k in range(64))
        emit(chunk)
        i += 64
        time.sleep(0.02)


signal.signal(signal.SIGHUP, lambda *_: os._exit(0))
{"idle": idle, "work": work, "flood": flood}[MODE]()
