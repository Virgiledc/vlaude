#!/usr/bin/env python3
import json
import sys

verbose = "-v" in sys.argv
for path in [a for a in sys.argv[1:] if a != "-v"]:
    for raw in open(path):
        try:
            r = json.loads(raw)
        except ValueError:
            print(raw.rstrip())
            continue
        print(f'{r["label"]:<16} {r["mode"]:<6} total {r["cpu_total"]:5.1f}  main {r["cpu_main"]:5.1f}  web {r["cpu_web"]:5.1f}'
              f'  réveils {r["wake_main"]:>5}/{r["wake_web"]:<5}  pss {r["pss_main"]:5.1f}/{r["pss_web"]:5.1f}'
              f'  démarrage {r["startup_s"]:.2f}s  {r["kb_s"]:7.1f} ko/s')
        if verbose:
            print(f'{"":<24}main {r.get("threads_main")}  web {r.get("threads_web")}')
