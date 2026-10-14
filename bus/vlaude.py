#!/usr/bin/env python3
import json
import os
import shlex
import sys
import time
import uuid
from typing import NoReturn

USAGE = """usage:
  vlaude list                       tuiles Vlaude ouvertes
  vlaude send <tuile> <message>     écrit le message dans le terminal de la tuile
  vlaude send <tuile> -             message lu sur stdin
"""


def die(msg) -> NoReturn:
    print(msg, file=sys.stderr)
    sys.exit(1)


def bus_dir():
    b = os.environ.get("VLAUDE_BUS")
    if not b:
        die("vlaude: VLAUDE_BUS absent, à lancer depuis une tuile Vlaude")
    return b


def load_tiles(b):
    try:
        with open(os.path.join(b, "tiles.json"), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        die("vlaude: aucune tuile publiée, Vlaude est-il lancé ?")


def whoami(tiles):
    tid = os.environ.get("VLAUDE_TILE_ID")
    return next((t for t in tiles if t["id"] == tid), None)


def cmd_list(tiles):
    me = whoami(tiles)
    for t in tiles:
        mark = "  <- toi" if me and t["id"] == me["id"] else ""
        print(f'{t["name"]}\t{t["kind"]}\t{t["state"]}\t{t["cwd"]}{mark}')


def resolve(tiles, name):
    hits = (
        [t for t in tiles if t["name"] == name]
        or [t for t in tiles if t["name"].lower() == name.lower()]
        or [t for t in tiles if t["id"] == name]
    )
    if len(hits) == 1:
        return hits[0]
    names = ", ".join(t["name"] for t in tiles) or "aucune"
    if not hits:
        die(f"vlaude: tuile inconnue '{name}'. Tuiles ouvertes : {names}")
    die(f"vlaude: nom ambigu '{name}' ({len(hits)} tuiles). Tuiles ouvertes : {names}")


def cmd_send(b, tiles, name, body):
    target = resolve(tiles, name)
    me = whoami(tiles)
    if me and me["id"] == target["id"]:
        die("vlaude: une tuile ne peut pas s'écrire à elle-même")
    body = body.strip()
    if not body:
        die("vlaude: message vide")
    sender = me["name"] if me else "terminal"
    text = f"[Message Vlaude de {sender}]\n{body}"
    if me:
        text += f"\n\n(Pour répondre : vlaude send {shlex.quote(sender)} \"ta réponse\")"
    out = os.path.join(b, "out")
    os.makedirs(out, exist_ok=True)
    stem = f"{time.time_ns()}-{uuid.uuid4().hex[:8]}"
    tmp = os.path.join(out, stem + ".tmp")
    final = os.path.join(out, stem + ".json")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"to": target["id"], "text": text}, f, ensure_ascii=False)
    os.replace(tmp, final)
    deadline = time.time() + 3
    while os.path.exists(final) and time.time() < deadline:
        time.sleep(0.1)
    if os.path.exists(final):
        try:
            os.remove(final)
        except FileNotFoundError:
            print(f"remis à {target['name']} ({target['kind']}, {target['state']})")
            return
        die(f"vlaude: message non remis à {target['name']} (pas de réponse de Vlaude en 3 s), rien n'a été envoyé")
    print(f"remis à {target['name']} ({target['kind']}, {target['state']})")


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(USAGE, end="")
        return
    b = bus_dir()
    tiles = load_tiles(b)
    if argv[0] == "list":
        cmd_list(tiles)
    elif argv[0] == "send" and len(argv) >= 3:
        body = sys.stdin.read() if argv[2:] == ["-"] else " ".join(argv[2:])
        cmd_send(b, tiles, argv[1], body)
    else:
        die(USAGE)


if __name__ == "__main__":
    main(sys.argv[1:])
