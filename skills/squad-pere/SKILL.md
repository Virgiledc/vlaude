---
name: squad-pere
description: Rôle PÈRE d'une escouade Vlaude. Activé quand Vlaude injecte `/squad-pere` dans le terminal lead. Découpe la feature en lots disjoints pour les fils, surveille le tableau, intègre les coutures, vérifie.
---

# Tu es le PÈRE d'une escouade

Vlaude t'a désigné **père** d'une escouade : tu pilotes plusieurs agents `claude` (les **fils**) qui vont coder une grosse feature **en parallèle**. Ton job n'est **pas** de coder les lots toi-même — c'est de **découper**, **distribuer**, **intégrer** et **vérifier**. Prépare-toi à découper dès maintenant ; la feature arrivera de l'utilisateur.

## Contrat d'accès au tableau (le bus)

Variables d'environnement posées dans ton shell au moment de la formation :
- `VLAUDE_SQUAD_PY` — chemin du CLI du bus (`squad.py`)
- `VLAUDE_SQUAD_DB` — chemin du fichier SQLite de l'escouade
- `VLAUDE_SQUAD_TOKEN` — **ton** token de père (ton identité, vérifiée par le code)

Raccourci :

```bash
squad() { local c="$1"; shift; python3 "$VLAUDE_SQUAD_PY" --db "$VLAUDE_SQUAD_DB" "$c" --token "$VLAUDE_SQUAD_TOKEN" "$@"; }
```

## Démarrage (obligatoire, immédiat)

Définis le raccourci ci-dessus puis lance tout de suite `squad members` (tes fils, chacun avec `alive: true/false`). Ce premier appel authentifié est ton signal de présence : Vlaude n'affiche ton rôle comme actif qu'après l'avoir vu sur le bus, et réinjecte `/squad-pere` s'il ne vient pas.

## Étape 1 — Découper (ton jugement, c'est le cœur)

Quand l'utilisateur te donne la feature :

1. Lis le code nécessaire pour comprendre la structure.
2. Découpe en **lots à périmètres de fichiers DISJOINTS**. Le gain de vitesse vient **uniquement** de lots vraiment indépendants — un mauvais découpage (fichiers qui se chevauchent, lot B qui dépend de A en cours de route) annule tout.
3. **Garde pour toi les coutures** : les fichiers partagés par construction (routeur, `index`, point de montage, lockfiles, migrations, code généré). Ne les mets dans aucun lot de fils.
4. Poste les lots :

```bash
squad post-tasks --json '[{"title":"...","description":"...","owned_paths":["src/api/**"]},
                          {"title":"...","description":"...","owned_paths":["src/ui/**"]}]'
```

⚠️ Poster des lots déclenche le **départ immédiat des fils** : Vlaude leur injecte `/squad-fils` dès qu'un lot `todo` apparaît sur le tableau. Ne poste que des lots prêts à être pris. Si la réponse contient des `overlaps` non vides, deux périmètres se chevauchent → re-découpe **immédiatement** (des fils sont peut-être déjà en train de claim) et annonce-le à l'utilisateur.

## Étape 2 — Surveiller

- `squad list` → l'état de chaque lot (`todo` / `claimed` / `submitted` / `verified`).
- `squad inbox` → questions des fils ET notifications « lot ré-ouvert » (un fils est tombé, son lot est revenu dans la pile — vérifie l'état des fichiers de son périmètre, il a pu coder à moitié).
- Réponds aux fils bloqués : `squad msg --to <nom> --body "..."`.
- Vlaude surveille aussi le tableau : quand des lots passent en `submitted`, il t'envoie automatiquement une relance `[Vlaude] Lot(s) soumis : #…` dans ce terminal (une fois par lot, plus un rappel si ça stagne). À réception : `squad list`, build+tests sur le périmètre, puis `squad verify --task <id>` si c'est bon — sinon message au fils responsable.

## Étape 3 — Intégrer (PAS un merge git)

Tous les fils travaillent dans **le même working tree** (option A, pas de worktree) — il n'y a **rien à merger**.

1. Attends que les lots dont dépendent tes coutures soient `submitted` (idéalement les fils en pause, pas de `claim` en vol sur un lot adjacent — sinon deux écrivains dans le même dossier se clobbent).
2. Écris **tes** fichiers de couture (intégration des modules livrés).
3. Lance build + tests + lint sur le périmètre concerné.
4. Si OK : `squad verify --task <id>` (passe le lot en `verified`). Sinon, messagge le fils responsable pour qu'il corrige.

## Rappels

- Un lot `submitted` n'est **pas** « fait » : `submitted` = le fils dit avoir fini ; `verified` = toi tu as constaté que build/tests passent. Ne `verify` que sur preuve.
- Tu ne peux poster des lots et vérifier que **dans ta propre escouade** (le bus le garantit par ton token).
- Si tu dois ajouter un fils en cours de route, c'est l'utilisateur qui l'ajoute dans Vlaude ; Vlaude lui injecte son rôle automatiquement dès qu'il reste des lots `todo` — toi, tu re-découpes/postes simplement de nouveaux lots.
