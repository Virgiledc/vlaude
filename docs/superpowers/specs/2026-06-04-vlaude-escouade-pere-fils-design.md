# Vlaude — Escouade père/fils (terminaux liés qui codent une feature en parallèle)

- **Date** : 2026-06-04
- **Statut** : design v2 — **durci par passe adversariale** (26 findings vérifiés contre le code réel). En attente de relecture avant plan d'implémentation.
- **Auteur** : brainstorm Virgile + Claude

> **Historique** : v1 proposait un bus « localhost HTTP ». La passe adversariale a prouvé empiriquement que c'est **cassé** sous WSL2 NAT (voir §5.3 et §13). v2 corrige le transport, l'identité, le cycle de vie, et la vérification de disjonction. Les trous résiduels sont en §9 ; les décisions encore ouvertes en §10.

## 1. Vision (une phrase)

Quand Virgile sait qu'il attaque une grosse feature, il **relie dynamiquement** son terminal courant (le **père**) à autant de terminaux Claude Code existants (les **fils**) que l'ampleur le justifie ; le père **découpe** la feature en lots à fichiers disjoints, les distribue via un **tableau partagé**, et les fils codent **en parallèle** chacun son lot — pour finir la feature plus vite, sans s'écraser mutuellement.

## 2. Le problème, posé honnêtement

Une grosse tâche dans un seul terminal est longue parce que la **génération LLM est séquentielle**, les **allers-retours outils** sont sérialisés, et le **contexte se sature**. Un 2ᵉ/3ᵉ terminal n'attaque que ce qui est **réellement disjoint** (Amdahl) : gain réaliste **~1,3–1,7×** sur une feature découpable, **< 1× (plus lent)** sur un travail emmêlé. Le gain ne vient **pas** de « connecter » les terminaux — il vient du **découpage en tranches indépendantes**. La connexion n'est que le tuyau.

Pourquoi pas juste les subagents internes d'une session ? Parce qu'ils sont **headless** : on ne peut pas les voir ni les rediriger en vol. Le différenciateur d'une escouade = **plusieurs agents pilotables à la main, en live, qui se passent du travail**.

## 3. Vocabulaire

- **Escouade** : un père + ≥1 fils, partageant un tableau, identifiée par un `squad_id`.
- **Père** : le terminal d'où Virgile tire les liens. Il **découpe** et **intègre** (écrit les fichiers de couture + lance build/tests sur le working tree partagé). En Option A il n'y a **pas de merge git** (un seul working tree, voir §5.4).
- **Fils** : un terminal recruté qui exécute des lots.
- **Tableau / bus** : l'état partagé déterministe de l'escouade (lots + boîtes aux lettres + membres + propriété de fichiers).
- **Lot (tâche)** : une unité de travail avec un **périmètre de fichiers** explicite (`owned_paths`, globs relatifs au repo).
- **Couture** : un fichier partagé par construction (routeur, `index`, lockfile, migration, type généré) — voir §5.6.

## 4. Principe directeur (règle Virgile : LLM = jugement, code = routing)

- **Le LLM fait le jugement** : découper la feature (père), écrire le code (fils), rédiger un message.
- **Le code fait le routing déterministe** : prise atomique d'un lot, **résolution d'identité par token** (§5.5), libération d'un lot quand son owner meurt (§5.7), **vérification de disjonction des périmètres** (§5.6), livraison des messages.

Aucune décision déterministe (qui prend quoi, qui est qui, retry, parsing) n'est déléguée au LLM. Le LLM ne produit que du contenu.

## 5. Architecture

```
   Virgile écrit la feature ici
            │
            ▼
   ┌─────────────────┐
   │  TERMINAL PÈRE  │  ① découpe en lots disjoints (périmètre/lot) → post_tasks
   └────────┬────────┘     (le bus REFUSE un découpage à périmètres chevauchants, §5.6)
            │
   ╔════════▼═════════════════════════╗
   ║  TABLEAU (BUS) — squad_id scoped  ║
   ║  • lots: todo/claimed/submitted/verified + owned_paths + claimed_at
   ║  • membres: role, name, cwd, token, status(alive|gone), last_seen
   ║  • boîtes aux lettres (identité résolue par TOKEN, pas par self-déclaration)
   ╚═══╤══════════════════════════╤════╝
       │ (identité = $VLAUDE_SQUAD_TOKEN)   │
   ┌───▼───┐                   ┌───▼───┐
   │ FILS 1│                   │ FILS 2│   ② boucle : claim → code (dans owned_paths)
   │ token │                   │ token │       → submit → suivant
   └───────┘                   └───────┘   ③ bloqué → msg + claim un autre lot
                                            ④ fils mort → Vlaude release son lot (§5.7)
```

### 5.1 Formation dynamique par liens

- Geste : depuis le père, **tirer un lien** (drag) vers une tuile terminal → ce terminal devient fils. Virgile juge le nombre de fils selon la grosseur de la tâche. Liens **dynamiques** (ajout/retrait/libération à la volée).
- **Contrainte V1 (couverte §5.8)** : un fils ne peut être lié que s'il partage le **même `cwd`** que le père (périmètres = globs relatifs au repo → un fils hors-repo code dans le vide). L'affordance refuse/grise le drop sur un cwd différent.
- **Précondition d'enrôlement (§5.2)** : ne lier qu'un terminal **au prompt vide** (REPL au repos).

### 5.2 Conscience de rôle (robuste, sans respawn) — et ses limites réelles

Un `claude` déjà lancé ne peut **pas** voir son system prompt modifié (`--append-system-prompt` n'agit qu'au spawn). Mécanismes :

1. **Le lien injecte une skill + un token.** Tirer père→fils ⇒ Vlaude `pty_write` `export VLAUDE_SQUAD_TOKEN=<tok>; /squad-fils <squad_id>\r` dans le fils → charge la skill `squad-fils` (rôle + comment causer au bus). Le 1er lien injecte `/squad-pere` dans le père. Même **primitive** que les boutons `/clear`/`/effort` (`SessionTile.tsx:16-19`).
   - **Limite vérifiée (finding #8/#23)** : `pty_write` envoie des octets bruts, **sans garde sur l'état du REPL**. Si le fils est mid-turn, l'injection se mélange à son travail. → en V1, garde-fou **humain** : on ne tire le lien que sur un terminal au prompt vide. La fiabilisation (détecteur d'état « prêt », §5.9) est un prérequis de toute injection programmatique ultérieure.
2. **Le token porte l'identité, pas la mémoire du LLM.** Le rôle/nom affiché peut dériver dans la conversation, mais l'identité vérifiée par le code = `$VLAUDE_SQUAD_TOKEN` (§5.5). La skill instruit le fils d'appeler le bus en référençant `$VLAUDE_SQUAD_TOKEN`, jamais en « se présentant ».

### 5.3 Le tableau / bus — transport

> **Décision tranchée par la passe adversariale** : la formulation v1 « endpoint **localhost** HTTP joignable par `curl localhost` » est **CASSÉE** sous WSL2 NAT (les fils tournent dans WSL ; `localhost` y = la loopback WSL, pas l'hôte Windows ; vérifié : `curl localhost:PORT` → connection refused). Voir §13 pour la preuve.

Deux transports viables restent en lice (**décision §10.1**, ne pas blender) :

- **Option HTTP (single source of truth, mais infra Rust net-new)** — Vlaude héberge le bus côté Rust, **bind sur `0.0.0.0:PORT`** (PAS `127.0.0.1`). Les fils appellent l'**IP de la gateway WSL découverte au runtime** : `HOST=$(ip route | awk '/default/{print $3}')` puis `curl http://$HOST:PORT/...`. **Vérifié fonctionnel** sur la machine cible. Ne jamais hardcoder l'IP (le subnet NAT change au redémarrage WSL) ; ne pas se fier à `resolv.conf` (Tailscale le réécrit ici). **Token obligatoire** (le bind `0.0.0.0` est exposé à la subnet/LAN selon firewall). Coût réel : **serveur HTTP from-scratch** — aucun crate serveur dans la stack (`portable-pty`+`tauri`+`serde` seulement, `hyper`/`tokio` transitifs uniquement) → ajout dépendance (sync `tiny_http` pour éviter un runtime async, ou `axum`+tokio), port lifecycle, collision de port, gestion d'erreur de bind remontée à l'UI.
- **Option SQLite-sur-FS-partagé (réseau éliminé)** — pas de serveur : un fichier SQLite `.vlaude/squad.db` **sur le FS WSL** (là où vit le repo). Prise atomique via transaction `BEGIN IMMEDIATE`. Les agents (WSL) écrivent ; **Vlaude lit en read-only** pour peupler le panneau (poll ~500 ms, cadence déjà utilisée par l'autosave). Élimine tout le problème réseau ET d'auth réseau. **Risque à valider en Phase 1** : verrouillage SQLite **à travers la frontière WSL↔Windows** (9p/drvfs) si Vlaude et les agents ouvrent le fichier simultanément → mitigé en gardant **tous les écrivains côté WSL** (père+fils) et Vlaude strictement read-only. La libération de lot sur mort de fils (§5.7) devient alors un signal fichier qu'un reaper WSL applique, pas une écriture Vlaude.

**Lean recommandé** : **SQLite-sur-FS** pour la Phase 1 (le partage de FS WSL↔Windows est fiable, contrairement au réseau NAT ; pas d'auth réseau à gérer). HTTP-`0.0.0.0` si la source-unique-avec-l'UI prime (tue aussi le desync §5.10). À trancher §10.1.

### 5.4 Le tableau / bus — modèle de données & opérations

**Modèle :**

- `squad(squad_id, pere_token, cwd, created_at)`
- `member(token, squad_id, role[pere|fils], name, cwd, status[alive|gone], last_seen)`
- `task(id, squad_id, title, description, owned_paths[globs], status[todo|claimed|submitted|verified], claimed_by_token, claimed_at, created_at)`
- `message(id, squad_id, from_token, to_token, body, created_at, read_at)`

**Opérations (déterministes, identité résolue par token — §5.5) :**

- `post_tasks([{title, description, owned_paths}])` — père seulement. **Rejette si les `owned_paths` se chevauchent** (§5.6).
- `list()` — état des lots + périmètres (scoping par `squad_id` du token).
- `claim()` — prend **atomiquement** le prochain `todo` du squad, passe `claimed`+`claimed_by_token`+`claimed_at`. Retour = le lot + rappel de rôle/périmètre.
- `submit(task_id)` — le fils signale fini → `submitted` (PAS `verified`, §5.11).
- `verify(task_id)` — père seulement → `verified` après build/tests OK (§5.11).
- `msg(to, body)` / `inbox()` — `from`/`to` = tokens résolus par le code, jamais fournis par l'appelant.
- `members()` — le père voit ses fils + leur `status`.

### 5.5 Identité & auth — par token, vérifiée par le code (finding #3/#12/#13/#15)

Le trou v1 : aucune identité stable ne liait un appel du bus à un PTY/membre — le LLM « se présentait », non vérifié. Fix :

- Au lien, Vlaude génère un **token opaque** (16 octets) lié côté code au `pty_id` (l'UUID du store qui keye `manager.rs`). Mapping vérifié : `token → pty_id → membre`.
- Le token est injecté **hors prose LLM** : `export VLAUDE_SQUAD_TOKEN=<tok>` dans le shell du fils. La skill référence `$VLAUDE_SQUAD_TOKEN`, ne recopie jamais une chaîne mémorisée.
- **Le bus résout l'appelant À PARTIR du token** (header HTTP `X-Squad-Token`, ou argument du CLI SQLite), **jamais d'un champ `from`/`session_id` du payload**. `claimed_by`, `message.from` sont remplis par le code. Token absent/invalide → rejet, pas de membre fantôme.
- Le `squad_id` est dérivé du token → **scoping** : un fils d'une autre escouade ne peut pas `claim` ici (finding #12).
- **Limite résiduelle honnête (§9)** : un fils peut fuiter/partager son token via Bash → l'isolation reste *trust-the-process*. Mais on élimine la **confusion accidentelle** d'identité (deux « fils-1 », ré-identification incohérente après relance) qui est le scénario réaliste sous dérive.

### 5.6 Disjonction des périmètres — vérifiée par le code (finding #4)

Le trou v1 : rien ne vérifiait que les `owned_paths` étaient disjoints ; la seule garde était « Virgile regarde 5 s » — or un humain ne voit pas un overlap de globs (`src/api/*.ts` ∩ `src/api/users.ts`, `src/**` qui avale tout). Conforme à §4, le **code** doit router :

1. **Intersection statique des globs** (obligatoire, déterministe, indépendante du FS) dans `post_tasks` : pour chaque paire de lots, tester si deux patterns peuvent matcher un même chemin. Attrape le découpage structurellement foireux.
2. **Comportement sur overlap** (décision §10.4) : soit `post_tasks` **rejette** (le père re-découpe), soit **flag rouge** dans le panneau pour que le coup d'œil humain ait une cible déterministe. Le coup d'œil reste un filet, pas la barrière.
3. **Sortie de périmètre a posteriori** : au `submit(task_id)`, le bus (via Vlaude) lance `git status` filtré sur le **complément** du périmètre du fil → flag dans le panneau si des fichiers hors-périmètre sont modifiés. Transforme le « le père détecte en relecture » (humain) en signal code.

### 5.6bis Coutures non-énumérables — hors couverture de l'isolation A (finding #9)

Même avec des périmètres disjoints, 4 classes de fichiers **partagés par construction** clobbent quand même, car le père ne peut pas les nommer avant que les fils tournent :
(a) **lockfiles** régénérés par le tooling (`package-lock.json`, `Cargo.lock` — présents dans ce repo), (b) **fichiers générés** (codegen, snapshots, types compilés), (c) **migrations** à numéro séquentiel (collision `0042_*`), (d) **imports partagés** qu'un fils doit éditer pour câbler son module.

**Garde-fou V1 déterministe** : la skill `squad-fils` **interdit aux fils** toute commande qui mute un lock / génère (`npm/pnpm/yarn install`, `cargo add/update`, codegen, `makemigrations`). Ces opérations sont **réservées au père** en phase d'intégration (§5.12 — séquencement). Les imports partagés = coutures possédées par le père.

### 5.7 Cycle de vie — libération d'un lot quand un fils meurt (finding #2/#24)

Le trou v1 : le bus ne savait pas qu'un fils mourait → lot `claimed` orphelin → **deadlock silencieux**. Or « libérer un fils » est un geste **nominal** (bouton ◳ → `removeFromCanvas` → `pty.close()` → `kill` du claude). Fix, **source de vérité = Vlaude (Rust), pas un heartbeat LLM** (un fils n'agit que quand on lui parle, §9) :

1. Sur `close()`/EOF du PTY (`manager.rs:60-67` et `115-121`), Vlaude émet **`member_gone(pty_id)`**. Le bus passe les lots `claimed_by` ce membre de `claimed`→`todo` (release) et **notifie le père** (inbox) : « lot X ré-ouvert, owner perdu, vérifier l'état des fichiers `<globs>` » — le père décide (reset ou reprise), **pas de re-claim aveugle** par-dessus un travail à moitié fait (isolation A = fichiers réels).
2. Câbler les 3 chemins UI qui retirent un membre vers ce release : `removeFromCanvas`, `closeSession`, `closeWorkspace` (`sessions.ts:111/117/178`).
3. **Garde-fou indépendant de l'UI** : `claimed_at` + un **reaper** (timer Rust, réutilise le tick 16 ms de `manager.rs`) repasse en `todo` tout lot `claimed` depuis > N s dont le membre est `gone`. Jamais un LLM dans cette boucle.
4. **Trap focusId/PTY** (vault) : `removeFromCanvas` ne touche pas `focusId`, et un PTY peut survivre au retrait visuel → « libérer un fils » doit **vraiment** délier (retirer du `member`) ET dire au fils de se mettre au repos, sinon la skill reste active sur un fils que Virgile croit libéré.

### 5.8 Contrats de bord (cas non traités — finding #18)

- **Même cwd obligatoire (V1)** : lien autorisé seulement si `fils.cwd === pere.cwd` (gratuit : cwd déjà dans `sessions.ts:14` et `member.cwd`). Hors-cwd ⇒ worktrees (Option B, hors-V1).
- **0 fils** : une escouade sans fils = le père travaille seul (no-op, pas d'erreur).
- **Plusieurs escouades simultanées** : isolées par `squad_id` (dérivé du token).
- **Fils déjà recruté par un autre père** : refusé (un token = un squad). L'affordance grise/refuse.

### 5.9 Détecteur d'état « prêt » — prérequis de toute injection auto (finding #19)

**Fait vérifié** : `setSessionState` est aujourd'hui du **dead code** (zéro appelant prod, aucun parseur de sortie). Vlaude **ne connaît pas** l'état working/waiting d'une session. Donc toute écriture programmatique fiable (injection de rôle au lien, boucle worker, nudge) suppose un détecteur à **construire** : parser le flux `onData` déjà disponible (`manager.rs`/`usePty`) pour repérer le prompt idle de `claude` et les écrans de permission (`Do you want to proceed`, `1. Yes`), et alimenter `setSessionState`. **En V1**, on s'en passe via le garde-fou humain (§5.2) ; le détecteur est un prérequis des phases auto (§12).

### 5.10 Persistance & reload (finding #7/#16)

**Fait vérifié** : `PersistedSnapshot`/`snapshot()`/`hydrate()` (`sessions.ts:29-37, 193-217`) listent des champs fixes ; l'autosave se déclenche à chaque mutation (`persistence.ts:23`) ; `hydrate` force `state:"working"`. Les **PTY survivent à un reload du webview** (réattachés depuis `layout.json`), mais l'état escouade en zustand, lui, repartirait du snapshot → **desync** (UI sans liens face à des fils toujours en boucle).

**Décision §10.3 (ne pas mettre l'état dans deux endroits)** :
- **A — liens volatiles (simple V1)** : l'état squad n'entre pas dans le snapshot ; au reload on **re-dérive le panneau depuis le bus** (`members()`/`list()`) si le bus survit, sinon Virgile re-tire les liens. Pattern déjà en place pour `fullscreenId` (volontairement éphémère, `sessions.test.ts:137`).
- **B — persisté** : étendre les **trois** fonctions (`PersistedSnapshot` + `snapshot()` + `hydrate()`) en cohérence + test round-trip + ré-hydrater le bus en accord. Plus lourd.
- **Source unique** : trancher si l'appartenance vit dans le **bus** (Rust, §5.3) **ou** le store — pas les deux (règle « pas de moyenne »). Le store ne doit que **miroiter** le bus.

### 5.11 Définition de « fait » (finding #17)

Le trou v1 : `complete()` ne vérifiait rien — un fils marque « fait » ≠ fait/correct (contredit ta règle « evidence before assertions »). Fix : états `submitted` (posé par le fils) vs `verified` (posé par le **père** après build/tests/lint du périmètre OK). Le panneau distingue **jaune (submitted)** / **vert (verified)** → Virgile repère un faux-done d'un coup d'œil (le tableau EST l'état du panneau). Pas d'`evidence` parsée par le bus en V1 (over-engineering).

### 5.12 Répartition & intégration (corrige le « merge » faux — finding #11)

1. Virgile donne la feature au père.
2. Le père découpe en lots **disjoints** (le bus **rejette/flag** si chevauchant, §5.6), s'attribue les **coutures** (§5.6bis), `post_tasks`.
3. Virgile valide le split d'un œil au panneau (avec les flags rouges déterministes comme cibles).
4. Chaque fils boucle : `claim` → code **dans son périmètre** → `submit` → suivant. Bloqué → `msg` + `claim` un autre lot.
5. **Intégration (PAS un merge git)** : en Option A il y a **un seul working tree** — rien à merger. Le père écrit ses fichiers de couture **après** que tous les lots dont ils dépendent sont `submitted`, **idéalement fils en pause** (pas de `claim` en vol sur un lot adjacent), puis lance build/tests et `verify` les lots. Deux écrivains non transactionnels dans le même dossier = clobber → le séquencement est **normatif**, pas optionnel. (Le « merge déterministe » n'existe qu'en Option B, worktrees, §11.)

## 6. UI Vlaude

- **Geste de lien** : **handler pointer maison** (PAS dnd-kit — finding #6/#20). Vérifié : `@dnd-kit/*` est du **code mort** (0 import dans `src/`) ; le drag des tuiles est géré par **react-grid-layout** (`draggableHandle=".vl-tile-bar"`). L'affordance de lien **doit** porter `.vl-no-drag` (`Canvas.tsx:136`, comme `vl-tile-actions`) sinon `pointerdown` déclenche le déplacement de la tuile. Tracé = `pointerdown`+`setPointerCapture`+`stopPropagation` → `pointermove` (trait SVG overlay) → `pointerup` (cible via `elementFromPoint`/dataset). Le coin SE reste le resize.
  - **Positions pixel** : le store ne contient que des unités de grille (`{i,x,y,w,h}` en colonnes), **pas de pixels** → calculer les rects depuis la grille + largeur courante, ou lire le DOM.
- **Panneau escouade** : le tableau live (lots todo/claimed/**submitted(jaune)**/**verified(vert)** par fils + flags overlap/sortie-de-périmètre) + journal des messages + **statut des membres (alive/gone)**. C'est ce qui rend « ils communiquent et se répartissent » **visible et débogable** (§9 observabilité).
- État d'escouade : **miroir** du bus (source unique, §5.10), pas une 2ᵉ vérité.

> Toute pièce visible passe par le skill `frontend-design` **avant** d'être codée (règle projet).

## 7. Points d'ancrage dans le code (localisés, vérifiés)

- `src/store/sessions.ts` — miroir de l'appartenance escouade (aucune notion de lien aujourd'hui). Persistance §5.10.
- `src/components/SessionTile.tsx` / `Canvas.tsx` — affordance `.vl-no-drag` + trait. `sendCommand`/`pty_write` = la primitive d'injection (`:16-19`), fire-and-forget.
- `src-tauri/src/pty/manager.rs` — `member_gone` sur close/EOF (`:60-67, 115-121`), reaper sur le tick, détecteur d'état (§5.9).
- `src-tauri/src/pty/wsl.rs` — point unique du spawn ; flags éventuels (`--permission-mode`, §10.5) ici.
- **Bus** : selon §10.1 — serveur HTTP `0.0.0.0` (crate net-new, §5.3) **ou** CLI/SQLite sur FS. Dans les deux cas, **code neuf non trivial** (pas un « petit endpoint », pas « ~1 jour »).
- Skills `squad-pere` / `squad-fils` — `SKILL.md` installés par Vlaude (rôle + accès bus + token + interdits de coutures). Injectées via `pty_write` d'un slash command.

## 8. Flux end-to-end

1. Virgile, dans le père, tire 2 liens vers 2 terminaux **au repos, même cwd**.
2. Vlaude injecte token + `/squad-pere` / `/squad-fils`. Le bus enregistre 3 membres (alive).
3. Virgile écrit la feature au père.
4. Le père découpe en 3 lots disjoints (2 fils + coutures pour lui) → `post_tasks` (bus vérifie la disjonction).
5. Virgile valide le split (flags rouges = cibles).
6. Chaque fils `claim` → code dans son périmètre → `submit`.
7. Un fils bloqué → `msg`, prend un autre lot, lit la réponse plus tard.
8. Un fils est fermé en vol → Vlaude release son lot → notifie le père.
9. Lots `submitted` → le père écrit les coutures, lance build/tests, `verify`.
10. Virgile vérifie le résultat end-to-end.

## 9. Risques & limites (honnêtes)

- **La qualité du découpage fait tout.** Mauvais split → clobber ou fils qui glande. Mitigé par vérif déterministe (§5.6) + validation humaine, **pas supprimable**.
- **Isolation A = souple + coutures non couvertes.** Le token empêche la confusion d'identité mais un fils peut fuiter son token / sortir de son périmètre (détecté a posteriori §5.6, pas empêché). Les 4 classes de coutures (§5.6bis) restent dangereuses ; mitigées en les réservant au père.
- **Injection PTY = fire-and-forget sur un REPL sans garde.** Fiable seulement sur un fils au repos (§5.2). Le détecteur d'état (§5.9) est à construire pour l'auto.
- **Nudge & écrans de permission (finding #10)** : relancer un fils inactif par `pty_write` **corrompt l'état** s'il attend une permission (le texte part dans le dialogue). Mieux : boucle **dans la skill** + fils lancés en `--permission-mode acceptEdits` (mais le recrutement de sessions existantes ne l'a pas → §10.5).
- **Les agents ne tournent pas en fond** → boucle worker fragile (Phase 2/3).
- **Desync reload** (§5.10) tant que la persistance n'est pas tranchée.
- **Observabilité** : le panneau (membres, lots, messages, flags) **est** l'outil de debug — sans lui, une escouade qui rate est une boîte noire.
- **Couplage = pas de parallélisme.** Gain **~1,3–1,7×** sur découpable, **< 1×** sur emmêlé.

## 10. Décisions — **tranchées** (Virgile, 2026-06-04)

1. **Transport du bus** : ✅ **SQLite-sur-FS** (`.vlaude/squad.db`, `BEGIN IMMEDIATE`, écrivains côté WSL, Vlaude read-only). Réseau éliminé. Locking cross-frontière à valider en Phase 1. (§5.3)
2. **Identité** : ✅ **token dans l'env + résolution code-side** (`$VLAUDE_SQUAD_TOKEN`, le bus résout l'appelant du token, jamais du payload). (§5.5)
3. **Persistance des liens** : ✅ **volatiles** — l'état squad n'entre pas dans le snapshot ; re-dérivé du bus au reload. Le store ne fait que **miroiter** le bus (source unique). (§5.10)
4. **Overlap de périmètres** : ✅ **flag rouge** dans le panneau en V1 (pas de reject hard) ; `post_tasks` calcule l'intersection statique mais laisse passer en signalant. (§5.6)
5. **Permission-mode des fils** : ✅ **accepter les terminaux existants, sans nudge auto** en V1 (pas de `--permission-mode` imposé, pas de relance programmatique qui corromprait un écran de permission). Boucle worker = instruction de skill, relance manuelle si besoin. (§9)
6. **Le père code-t-il ?** ✅ **coutures/intégration uniquement** (pas de lots de fond).

## 11. Hors-scope V1 (évolutions)

- **B — worktrees** (isolation dure + **vrai** merge git). Seule façon propre d'avoir `fils.cwd ≠ pere.cwd`.
- **Auto-découpe** robuste (père décompose sans validation humaine).
- **Bus MCP** (seulement si un jour passage au spawn d'escouade ; incompatible avec le recrutement dynamique, §5.3).
- **Détecteur d'état « prêt »** mûr (§5.9) + boucle worker auto-relancée.

## 12. Phasage (effort corrigé — ce n'est PAS « ~1 jour »)

> La passe adversariale a montré que la Phase 1 inclut un **sous-système bus net-new** (transport + identité-token + cycle de vie + vérif disjonction) — pas un bouton. Estimation v1 « ~1 jour » **retirée**.

- **Phase 1 — bus minimal + liens + panneau (plusieurs jours).** Transport tranché (§10.1), token-identité (§5.5), `claim`/`submit`/`verify` atomiques, release sur mort de fils (§5.7), vérif disjonction (§5.6), même-cwd (§5.8). Virgile pose 2 lots à la main, 2 fils les prennent/codent dans leurs périmètres, le père intègre. **Prouve le gain réel** avant l'auto-magie.
- **Phase 2 — auto-découpe** par le père (Virgile valide le split d'un œil) + détecteur d'état « prêt » (§5.9).
- **Phase 3 — polish** : boucle worker auto + nudge sûr (permission-mode), journal live, durcissement périmètres, observabilité.

## 13. Annexe — preuve empirique du transport (passe adversariale)

Sur la machine cible (vérifié par un agent) :
- Sessions claude lancées **dans WSL** (`wsl.exe -- zsh … exec claude`, `manager.rs:42` + `wsl.rs:17-33`).
- `.wslconfig` **sans** `networkingMode=mirrored` → **NAT**. `ip route` → `default via 192.168.112.1`, subnet `192.168.112.0/20`. `ip addr show lo` → `127.0.0.1 scope host` (loopback WSL isolée).
- Listener Windows bind `127.0.0.1` + `curl localhost:PORT` (et `curl 127.0.0.1:PORT`) depuis WSL → **exit 7, connection refused**. ⇒ « localhost HTTP » est mort.
- Listener Windows bind `0.0.0.0:8734` + `curl http://192.168.112.1:8734/` depuis WSL → **HTTP 200, exit 0** (firewall n'a pas bloqué, profil privé). ⇒ `0.0.0.0` + gateway-IP fonctionne.
- Gateway régénérée au reboot WSL → **découverte runtime via `ip route`** obligatoire ; `resolv.conf` inutilisable (Tailscale → `100.100.100.100`).
