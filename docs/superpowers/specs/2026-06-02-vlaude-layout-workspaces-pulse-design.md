# Vlaude v0.2 — Layout flexible, Workspaces & Pulse d'attente

- **Date** : 2026-06-02
- **Statut** : design validé (brainstorming) → prêt pour le plan d'implémentation
- **Auteur** : Virgile + Claude
- **Pré-requis** : v0.1 livrée (pont PTY/WSL, sidebar groupée, canvas en zones, 3 actions, modal). Ce doc étend l'UI ; il **ne touche pas** au pont PTY ni à xterm.

---

## 1. Problème & vision

Le canvas v0.1 est en **flexbox automatique pur** : les zones (groupes par chemin) s'empilent, les tuiles se partagent la largeur, **aucune poignée**, aucun état de taille/ordre dans le store (`Session` = `id,name,cwd,status,openInCanvas`, et `status` est figé à `running`, jamais mis à jour).

L'utilisateur veut **reprendre la main sur la disposition** : agrandir un répertoire pour lui donner plus de place, redimensionner et réordonner les terminaux à l'intérieur, organiser le travail en **onglets de workspace**, et **repérer d'un coup d'œil quelle session attend une réponse** (pulse).

---

## 2. Périmètre

### Dans le scope
1. **Zones redimensionnables** — chaque zone (répertoire) peut être agrandie/rétrécie en hauteur dans le canvas.
2. **Tuiles redimensionnables** — chaque terminal peut être redimensionné en largeur dans sa zone.
3. **Réordonnancement par drag** — glisser une tuile pour la réordonner **à l'intérieur de sa zone** (même `cwd`).
4. **Onglets de workspace** — barre d'onglets en haut ; chaque onglet = un espace de travail complet (son jeu de sessions/zones et sa disposition).
5. **Persistance + relance auto** — la disposition (workspaces, zones, tailles, ordre, onglet actif) survit au redémarrage ; au démarrage, claude est **relancé à neuf** dans chaque dossier mémorisé.
6. **Pulse d'attente** — quand une session attend une réponse de l'utilisateur, sa tuile (et sa ligne de sidebar) émet un **pulse violet discret toutes les ~5 s**.

### Non-goals (explicites, YAGNI)
- Déplacer une tuile **d'une zone à une autre** (le drag est borné à la zone d'origine).
- Fenêtres flottantes / grille libre type dashboard.
- Restaurer le **scrollback** d'avant fermeture (le PTY meurt avec l'app — impossible ; au mieux relance à neuf).
- Macros, raccourcis globaux, sélecteur de modèle, multi-distro.
- Aucun refactor du pont PTY, de `manager.rs`, de `TerminalView` (hors le strict nécessaire au resize/pulse).

---

## 3. Décisions verrouillées (issues du brainstorming)

| Sujet | Décision |
|---|---|
| Modèle de disposition | **A — zones par répertoire**, redimensionnables (pas grille libre, pas flottant) |
| Granularité | Resize zones **et** tuiles ; reorder **intra-zone** uniquement |
| Onglets | **Workspaces** (niveau app), pas onglets par zone ni par tuile |
| Persistance | **Disposition + relance auto** des sessions au démarrage |
| Détection « attend » | **Hooks Claude Code injectés** (déterministe), pas heuristique |
| Lib resize | **`react-resizable-panels`** (resize CSS, ne remonte pas les terminaux) |
| Lib reorder | **`dnd-kit`** (sortable borné à la zone) |
| Couleur pulse | **violet** `#8b5cf6`, animation 5 s, discrète |

---

## 4. Modèle de données

Source unique : on **étend le store `src/store/sessions.ts`** (zustand) plutôt que de multiplier les stores (évite les bugs de synchronisation taille↔session↔workspace).

```ts
type SessionState = 'working' | 'waiting' | 'attention' | 'exited';

interface Workspace { id: string; name: string; }

interface Session {
  id: string;
  name: string;
  cwd: string;
  workspaceId: string;        // NOUVEAU — rattachement à un workspace
  order: number;              // NOUVEAU — rang dans sa zone (pour le reorder)
  state: SessionState;        // REMPLACE `status` figé — piloté par les hooks
  openInCanvas: boolean;
}

interface AppState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  sessions: Session[];
  focusId: string | null;
  counter: number;
  zoneSizes: Record<string, Record<string, number>>; // [workspaceId][cwd] -> poids (hauteur)
  tileSizes: Record<string, number>;                  // [sessionId] -> poids (largeur)
  // actions: createSession, closeSession, removeFromCanvas, openInCanvas, setFocus,
  //          createWorkspace, renameWorkspace, closeWorkspace, switchWorkspace,
  //          reorderInZone(cwd, orderedIds), setZoneSizes(wsId, sizes), setTileSizes(sizes),
  //          setSessionState(id, state)
}
```

- **Groupement** : `groupByPath` devient *filtré par `activeWorkspaceId`* puis *trié par `order`* à l'intérieur de chaque `cwd`.
- **Une session appartient à exactement un workspace.** Une nouvelle session est créée dans le workspace actif. Au moins un workspace « 1 » existe toujours.
- **`state`** remplace l'ancien `status` (`running|idle|exited` jamais mis à jour). Valeur initiale `working` à la création (claude démarre), puis piloté par les hooks (§6). `exited` quand le PTY meurt.

---

## 5. Layout & composants

### Fichiers
- **Modifier** `src/App.tsx` — monte `<WorkspaceTabs/>` au-dessus de `<Canvas/>` ; le canvas ne rend que le workspace actif.
- **Créer** `src/components/WorkspaceTabs.tsx` (+ `.css`) — barre d'onglets ; `+` crée ; double-clic renomme (input inline) ; `✕` ferme via **modal de confirmation** si l'onglet contient des sessions vivantes (réutiliser le pattern `ConfirmCloseModal`). **Fermer un workspace termine (kill PTY) toutes ses sessions** ; on ne peut pas fermer le dernier workspace (il en reste toujours au moins un).
- **Réécrire** `src/components/Canvas.tsx` — structure en panneaux imbriqués :
  - `PanelGroup direction="vertical"` = la pile des **zones** ; un `PanelResizeHandle` entre chaque zone.
  - chaque zone = `PanelGroup direction="horizontal"` = les **tuiles** ; un `PanelResizeHandle` entre chaque tuile.
  - `onLayout` de chaque groupe → `setZoneSizes` / `setTileSizes` (debounced).
  - tailles initiales lues depuis `zoneSizes`/`tileSizes` (défaut = parts égales).
- **Modifier** `src/components/SessionTile.tsx` — devient un `useSortable` (dnd-kit) **scoping par zone** ; ajoute une **poignée de drag** dans la barre de titre ; conserve les 3 actions ⛶ ◳ ✕ ; ajoute la classe `waiting`/`attention` pour le pulse.
- **Inchangé** `src/terminal/TerminalView.tsx` — son `ResizeObserver` existant capte déjà le redimensionnement du conteneur → `fit()` + `pty_resize`. (Vérifier seulement que le resize d'un Panel déclenche bien l'observer.)

### Contrainte dure
**Redimensionner ne doit jamais re-monter une tuile** (remount xterm = perte de scrollback + flash). `react-resizable-panels` redimensionne via CSS sans démonter ses enfants → OK. dnd-kit réordonne sans démonter (translation CSS) → OK.

---

## 6. Pulse d'attente (détection déterministe via hooks)

### Constat vérifié (cette session)
- L'install locale expose les events de hooks : `SessionStart, Notification, PreCompact, Stop, PostToolUse, UserPromptSubmit` (lus dans `~/.claude/settings.json`).
- `claude --settings <file-or-json>` permet de **charger des réglages additionnels** au lancement (`--help` : « load *additional* settings »).
- Preuve en direct : le hook `UserPromptSubmit` de l'utilisateur (`qmd-orient.sh`) tourne à chaque prompt.

### Mécanisme
Au spawn du PTY, Vlaude lance `claude --settings <json>` injectant 3 hooks **additifs** :

| Event | Signification | État écrit |
|---|---|---|
| `UserPromptSubmit` | l'utilisateur a soumis → claude bosse | `working` |
| `Stop` | claude a fini son tour → attend l'utilisateur | `waiting` |
| `Notification` | claude réclame une action (permission, idle) | `attention` |

Chaque hook exécute :
```
echo <state> > "$VLAUDE_PULSE_DIR/$VLAUDE_SESSION_ID"
```
Vlaude **injecte `VLAUDE_PULSE_DIR` et `VLAUDE_SESSION_ID` dans l'env du PTY** au spawn (id unique par tuile, indépendant du `session_id` interne de claude). Côté **Rust** : un thread poll `VLAUDE_PULSE_DIR` (~1 s) et émet l'état au frontend (event Tauri / Channel) ; le store fait `setSessionState`.

### Rendu
- CSS : `.vl-tile.waiting`, `.vl-tile.attention` → keyframe `vl-pulse` **5 s infinite** : box-shadow violet (`#8b5cf6`) qui monte puis redescend, **discret** ; petit point violet dans la barre de titre. Idem sur la ligne de sidebar correspondante.
- Animation **CSS pure** (aucun JS par frame) → coût nul même avec beaucoup de sessions.
- `working` / `exited` → pas de pulse.

### ⚠️ Zone d'ombre à lever au spike (non inventée)
**`--settings` ajoute-t-il les hooks Vlaude sans remplacer les hooks globaux qmd de l'utilisateur ?** Le `--help` dit « additional » (additif) et l'utilisateur a déjà plusieurs hooks par event, ce qui est cohérent avec un merge — **mais à confirmer en l'exécutant** avant de s'engager. Vérif concrète : lancer claude via `--settings` avec un hook `Stop` sentinelle, taper une question, vérifier que (a) le sentinelle est écrit ET (b) `qmd-orient.sh` tourne toujours sur `UserPromptSubmit`.
**Fallback si merge KO** : heuristique « aucun octet PTY pendant ~N s ET le dernier écran montre le prompt d'input » — moins fiable (curseur clignotant, lignes « esc to interrupt »), réservée au dernier recours.

---

## 7. Persistance & relance auto

- Le store sérialise `{ workspaces, activeWorkspaceId, sessions (sans état PTY), zoneSizes, tileSizes, order }` → fichier JSON dans le répertoire app-data Tauri.
- I/O : commande Rust `save_layout(json)` / `load_layout() -> json` (ou plugin `@tauri-apps/plugin-fs`). Écriture **debounced** (~500 ms) à chaque changement de taille / ordre / workspace / création-fermeture de session.
- **Démarrage** : le front lit le JSON → reconstruit workspaces, zones, tuiles, tailles → appelle `pty_spawn` pour **chaque** session (claude **à neuf** dans son `cwd`, `state='working'`). Si la lecture échoue/absente → un workspace « 1 » vide.
- Le scrollback d'avant n'est pas restauré (PTY neuf) — assumé et communiqué.

---

## 8. Découpage indicatif (étapes vérifiables)

| # | Étape | Vérification concrète |
|---|---|---|
| 0 | **Spike `--settings`** (lever la zone d'ombre §6) | sentinelle `Stop` écrit + hook qmd toujours actif |
| 1 | Store étendu (workspaces, `state`, `order`, sizes) + `groupByPath` par workspace/order | tests vitest : reducers, grouping, reorder |
| 2 | Canvas en `react-resizable-panels` (zones V / tuiles H) | resize visible ; **terminaux non remontés** (scrollback conservé) |
| 3 | Reorder intra-zone (dnd-kit) | drag réordonne + `order` persiste |
| 4 | `WorkspaceTabs` + bascule + create/rename/close | 2 workspaces isolés, fermeture confirmée |
| 5 | Persistance JSON + relance auto | resize → fermer l'app → rouvrir : disposition restaurée + sessions relancées |
| 6 | Pulse (Rust spawn `--settings`+env+poll+event ; CSS `vl-pulse`) | claude finit son tour → pulse violet ; je tape → s'arrête |
| 7 | Polish UI (skill `frontend-design`) | cohérence thème sombre, espacements, états |

---

## 9. Risques & mitigations

| Risque | Mitigation |
|---|---|
| `--settings` remplace au lieu de merger les hooks | Spike étape 0 ; fallback heuristique idle prêt |
| fs-watch peu fiable sous WSL/`/mnt/c` | On **poll** (pas de watch) ; `VLAUDE_PULSE_DIR` en fs Linux (`/tmp/...`), jamais `/mnt/c` |
| Remount xterm au resize (perte scrollback) | `react-resizable-panels` (CSS) + dnd-kit (translate) ne démontent pas |
| Beaucoup de sessions = coût animation | Pulse = CSS pur, 0 JS/frame |
| Drag inter-zone casserait « groupé par chemin » | Hors scope : drag borné à la zone (dnd-kit `containerId`) |
| Pas de dépôt git | À signaler ; `git init` est un pré-requis du plan v0.1 non fait (ne pas committer sans feu vert) |

---

## 10. Definition of Done

- J'agrandis une zone → elle prend plus de place ; je redimensionne une tuile ; je réordonne par drag dans la zone — **sans** remonter les terminaux.
- Je crée/renomme/ferme des **workspaces** ; chacun garde sa propre disposition.
- Je redimensionne, je ferme l'app, je la rouvre → **la disposition revient et les sessions sont relancées** dans leurs dossiers.
- Quand claude finit son tour, la tuile **pulse en violet** toutes les ~5 s ; quand je réponds, le pulse s'arrête.
- Build `.exe` OK, multi-session fluide.
- Aucune étape « faite » sans preuve observée (pas de « ça devrait marcher »).
