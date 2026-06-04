# Squad bus (sidecar)

Tableau partagé d'une escouade Vlaude. SQLite + Python 3 stdlib. Zéro dépendance.

## Tests
```bash
cd bus && python3 -m unittest -v
```

## CLI
Toutes les commandes : `python3 squad.py --db <chemin.db> <commande> --token <tok> [...]`.
L'identité de l'appelant est **toujours** résolue à partir de `--token` (jamais d'un champ du payload).

Commandes : `post-tasks --json <json>` (père) · `claim` · `submit --task <id>` ·
`verify --task <id>` (père) · `msg --to <nom|token> --body <txt>` · `inbox` · `members` · `list` · `ping`.

Détection d'overlap : best-effort (basée sur `git ls-files`) ; dégradée hors d'un repo git ou sur des wildcards en milieu de chemin (faux négatifs possibles, jamais de faux positif bloquant).

## Démo manuelle
```bash
DB=/tmp/demo-squad.db
python3 - "$DB" <<'PY'
import sys, sqlite3, squad
c = sqlite3.connect(sys.argv[1], isolation_level=None); c.row_factory = sqlite3.Row
squad.init_db(c); squad.init_squad(c, "sq1", "tokP", ".", now=0)
squad.add_member(c, "tokF1", "sq1", "fils", "fils-1", ".", now=0)
PY
python3 squad.py --db "$DB" post-tasks --token tokP --json '[{"title":"a","description":"d","owned_paths":["a/**"]}]'
python3 squad.py --db "$DB" claim --token tokF1
python3 squad.py --db "$DB" submit --token tokF1 --task 1
python3 squad.py --db "$DB" verify --token tokP --task 1
python3 squad.py --db "$DB" list --token tokP
```
