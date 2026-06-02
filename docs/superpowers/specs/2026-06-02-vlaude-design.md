# Vlaude — Spec de conception (MVP v0.1)

- **Date** : 2026-06-02
- **Statut** : validé (brainstorming) → prêt pour le plan d'implémentation
- **Auteur** : Virgile + Claude

---

## 1. Vision & contexte

**Vlaude** est une application de bureau Windows (un seul `.exe`) qui sert de **gestionnaire de fenêtres « new-gen, style app Mac »** autour du vrai CLI **Claude Code**. Objectif final : **multi-gérer tous mes agents Claude** sous forme de fenêtres, avec des macros et des raccourcis.

Chaque « session » est une instance **interactive** du programme `claude` qui tourne **dans WSL** (Linux), lancée par l'app Windows via un **pont PTY** (`wsl.exe` + Windows ConPTY). L'app multiplexe plusieurs sessions à la fois, affiche le terminal réel de chacune avec une fidélité totale (couleurs ANSI, TUI, curseur), et — plus tard — ajoute macros et raccourcis globaux.

Ce document couvre le **MVP v0.1** : créer / afficher / organiser / fermer des sessions. La vision complète (macros, raccourcis, persistance) est hors périmètre v0.1 mais l'architecture la prévoit.

### Pourquoi wrapper le CLI (et pas l'Agent SDK)
- Réutilise **tel quel** le setup existant : login Max (OAuth), skills, plugins, MCP (qmd/vault), `CLAUDE.md`, commandes.
- **Coût** : une session `claude` **interactive** consomme le **quota Max normal** (fenêtres 5h), *pas* l'enveloppe « Agent SDK credit » séparée ($200/mois) introduite le 15/06/2026 pour l'usage programmatique (`claude -p` / SDK). Pour faire tourner beaucoup d'agents, le wrapper interactif est nettement plus économique.

---

## 2. Décisions d'architecture (verrouillées)

| Sujet | Décision | Raison courte |
|---|---|---|
| Nature des sessions | Wrapper du CLI `claude` (interactif) | Réutilise tout le setup ; quota Max normal |
| Runtime | `.exe` Windows → pont WSL → `claude` en PTY | `claude` est installé dans WSL |
| Stack | **Tauri 2** (Rust + WebView2 + xterm.js + portable-pty) | Gagnant du benchmark (57/65) : fidélité terminal (xterm.js = moteur de VS Code), exe léger, polish UI en web, raccourcis globaux natifs |
| Terminal | **xterm.js** (WebGL pour visible, DOM pour fond) | Renderer le plus éprouvé ; évite le plafond ~16 contextes WebGL |
| Layout | Sidebar groupée par chemin + canvas en **zones par chemin** | Demande explicite : rangé et lisible, place pour extensions |

**Runner-up** : .NET/Avalonia (56.5/65). À reconsidérer **uniquement** si une exigence dure « < 100 Mo de RAM » apparaît (WebView2 = RAM type Chromium, quelques centaines de Mo, **fixes et partagées**, pas par session).

---

## 3. Périmètre

### Dans le MVP v0.1
1. Une fenêtre unique : **sidebar** (gauche) + **canvas** (droite).
2. **Créer** une session : `+ Nouvelle session` → choisir un **dossier de travail WSL** → lance `claude` dedans.
3. La session apparaît dans la **sidebar** sous son **groupe de chemin** et s'**ouvre dans le canvas**.
4. **Terminal réel** par session (xterm.js), pleinement **interactif** (saisie clavier → PTY).
5. **Groupement par chemin** dans la sidebar **et** le canvas (zones).
6. **3 actions** par tuile : **plein écran** · **enlever de la page** · **fermer** (+ modal de confirmation).
7. **Redimensionner / réarranger** les tuiles à l'intérieur d'une zone.

### Hors périmètre v0.1 (prévu après)
- Macros et raccourcis globaux (l'archi réserve : raccourci → focus session → écriture dans le PTY).
- Persistance des sessions / du layout entre redémarrages.
- Sélecteur de modèle, multi-distro avancé, drag-resize libre inter-zones, thèmes.

---

## 4. Modèle de données (frontend ↔ Rust)

```
Session {
  id: string (uuid)
  name: string            // défaut "session-N", renommable plus tard
  cwd: string             // chemin WSL absolu, ex. "/home/virgile/dt/threadscrap"
  groupKey: string        // = cwd (clé de regroupement par chemin)
  status: "running" | "idle" | "exited"
  openInCanvas: boolean   // true si affichée dans le canvas
  // état terminal (xterm) vit côté frontend ; le PTY vit côté Rust
}

PathGroup {
  groupKey: string        // cwd
  label: string           // affichage, ex. "~/dt/threadscrap"
  sessions: Session[]
}
```
Le **groupement** est dérivé : on regroupe les sessions par `cwd` exact. (Affinage possible plus tard : regrouper par racine de projet plutôt que cwd exact.)

---

## 5. Architecture technique

```
.exe Windows (Tauri 2, ~10 Mo, 1 fenêtre)
│
├─ CŒUR RUST
│  ├─ SessionManager : create/close, état, focus, dérive les PathGroups
│  │     └─ par session → portable-pty (master)
│  │            └─ spawn : wsl.exe -d <distro> -- bash -lic "cd <cwd> && claude"
│  │               (via Windows ConPTY ; CREATE_NO_WINDOW ; TERM correct ;
│  │                propagation resize/SIGWINCH → taille PTY)
│  │
│  └─ PONT PTY  ← pièce porteuse, construite EN PREMIER
│        boucle de lecture par PTY → buffer d'octets ANSI bruts
│        → coalesce/flush toutes les ~16 ms (1 frame)
│        → Tauri Channel en binaire (ArrayBuffer)
│        ⚠ JAMAIS emit-par-chunk, JAMAIS JSON par octet (sinon CPU à fond en multi-session)
│
└─ FRONTEND (WebView2, 1 seul moteur Chromium — RAM fixe partagée)
   ├─ 1 instance xterm.js par session
   │     • WebGL renderer pour la/les tuile(s) visible(s)
   │     • DOM/canvas renderer pour les sessions de fond (évite le plafond ~16 ctx WebGL)
   │     • DPI : Per-Monitor-V2 + re-fit sur changement de devicePixelRatio (anti-flou)
   ├─ Sidebar (groupes par chemin) + Canvas (zones) + Modal — polish Mac en CSS
   └─ [v0.2+] global-shortcut plugin → macros = write() direct dans le PTY de la session focus
                                        (pas de synthèse d'input OS)
```

### Commande de lancement (à valider au spike)
`wsl.exe -d <distro_par_défaut> -- bash -lic "cd '<cwd>' && exec claude"`
- `-lic` : shell login interactif (charge `~/.local/bin` dans le PATH où vit `claude`).
- `exec claude` : remplace le shell pour que la fermeture du PTY tue bien `claude`.
- À ajuster selon le résultat du spike (gestion du PATH, distro, quoting).

---

## 6. Flux utilisateur

**Créer** : clic `+ Nouvelle session` → dialogue (dossier WSL + nom optionnel) → Rust spawn le PTY → Session ajoutée (status `running`, `openInCanvas=true`) → tuile rendue dans la zone du chemin.

**Ouvrir / focus** : *simple-clic* dans la sidebar = sélectionne + met le focus (scrolle vers la tuile si déjà ouverte). *Double-clic* = ouvre la session dans le canvas (`openInCanvas=true`).

**3 actions sur une tuile** :
- **⛶ Plein écran** : la session remplit toute l'app (mode focus) ; re-clic = retour.
- **◳ Enlever de la page** : `openInCanvas=false` → retirée du canvas, **process conservé** (status inchangé), reste dans la sidebar. Double-clic pour la rouvrir.
- **✕ Fermer** : ouvre la **modal de confirmation** → si confirmé, Rust tue le PTY, Session retirée (sidebar + canvas).

**Resize / réarrange** : à l'intérieur d'une zone de chemin (et zones entre elles).

---

## 7. Layout & UI

- **Sidebar gauche, persistante** : sessions groupées par chemin (en-tête de groupe repliable = label de chemin). Indicateur d'état (point) par session. Marqueur « ● ouvert » si dans le canvas. `+ Nouvelle session` en bas. **Zone réservée « À venir »** (Macros, Réglages) — place pour extensions futures.
- **Canvas droit** : **une zone encadrée par chemin**, contenant les tuiles de session redimensionnables. Réarrangement à l'intérieur d'une zone.
- **Tuile de session** : mini barre de titre (nom + 3 icônes d'action) + corps = terminal xterm.js.
- **Modal de fermeture** : titre « Fermer "<nom>" ? », texte « La session sera terminée. Action irréversible. », boutons **Annuler** / **Fermer** (destructif).
- **Esthétique** : sombre, épuré, style Mac/Linear/Warp. Accent chaud discret (clin d'œil Claude). Le polish détaillé passera par le skill `frontend-design` au moment de coder l'UI, en s'appuyant sur les références de `../design` (raycast, linear, warp, superhuman).

---

## 8. Décisions par défaut (confirmées)

1. **Simple-clic** = sélectionne/focus ; **double-clic** = ouvre dans le canvas.
2. **Création** = dialogue (dossier WSL + chemins récents pour aller vite) + nom optionnel (auto `session-N`). Distro = **distro WSL par défaut**, configurable plus tard.
3. **Pas de persistance** des sessions vivantes à la fermeture de l'app en v0.1.
4. **Modèle** : `claude` garde le **réglage par défaut** de l'utilisateur (pas de sélecteur au MVP).

---

## 9. Risques & mitigations (issus du benchmark)

| Risque | Mitigation |
|---|---|
| **Débit IPC** : emit-par-chunk sur 15 PTYs sature un cœur | **Tauri Channel + coalescing Rust 16 ms en binaire**. Construit jour 1. |
| **RAM type Chromium** (WebView2, centaines de Mo fixes) | Une seule WebView, renderer WebGL, features inutiles désactivées. Tradeoff assumé (sinon → .NET). |
| **ConPTY fuit** sous gros débit (corruption TUI) | Inhérent à toute stack Windows↔WSL ; portable-pty = moteur de WezTerm (le + éprouvé). Plus tard : option SSH dans un sshd WSL pour un vrai PTY Linux. |
| **Bug Claude Code #14599** (corruption de rendu ConPTY après resize) | Suivre/épingler la version corrigée ; bonne propagation SIGWINCH ; action « redraw/restart REPL » par session. |
| **Flou xterm.js en DPI fractionnaire** (125/150 %) | Per-Monitor-V2, devicePixelRatio correct + re-fit, WebGL, police mono nette. |
| **Plafond ~16 contextes WebGL** | WebGL pour le visible, DOM/canvas pour le fond. |
| **Taxe d'apprentissage Rust (solo)** | Surface Rust bornée au pont PTY/WSL ; tout l'UI reste en web. 2 spikes de dé-risque (voir §10). |

---

## 10. Découpage indicatif (pour le plan d'implémentation)

1. **Spike A — pont PTY** : `wsl.exe` + ConPTY + portable-pty fait tourner un **vrai `claude` interactif** dans une fenêtre Tauri, I/O OK, sans corruption. *(le plus risqué → en premier)*
2. **Spike B — multi-terminal** : 2-3 PTYs simultanés, batching 16 ms via Channel, stratégie WebGL/DOM.
3. **SessionManager Rust** : create/close, état, dérive des groupes par chemin.
4. **Sidebar** groupée par chemin + `+ Nouvelle session` (dialogue dossier WSL).
5. **Canvas** en zones par chemin, double-clic pour ouvrir, resize intra-zone.
6. **3 actions** + modal de confirmation de fermeture.
7. **Polish UI** (skill `frontend-design`) : thème, espacements, états, anim.

### Critères de succès v0.1
- Je peux créer N sessions dans des dossiers WSL différents ; elles apparaissent groupées par chemin (sidebar + canvas).
- Chaque terminal est le **vrai** REPL `claude` : je tape, ça répond, couleurs/TUI fidèles.
- Je peux mettre en plein écran, enlever de la page (process conservé), et fermer (avec modal → process tué).
- Avec 5+ sessions qui streament, l'app reste fluide (pas de cœur saturé).
- Build → un `.exe` Windows qui démarre et fait tout ce qui précède.

---

## 11. Vérification (definition of done)
Aucune étape n'est « faite » sans preuve concrète : terminal réel qui répond, build `.exe` qui démarre, multi-session fluide observée. Pas de « ça devrait marcher ».
