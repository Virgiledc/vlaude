# Vlaude — Plan A : Pont PTY/WSL + un terminal Claude live

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une app Tauri 2 Windows qui lance **un vrai `claude` interactif dans WSL** dans une fenêtre xterm.js, via un pont PTY/ConPTY avec batching 16 ms — et qui build en `.exe`.

**Architecture:** Cœur Rust (`portable-pty`) ouvre un PTY, lance `wsl.exe -- bash -lic "cd <cwd> && exec claude"` (ConPTY). Une boucle de lecture accumule les octets ANSI dans un coalescer ; un thread « ticker » les flush toutes les 16 ms vers le frontend via un **Tauri Channel binaire**. Le frontend (React+TS) rend un terminal **xterm.js** (renderer WebGL), renvoie les frappes au PTY (`pty_write`) et propage le resize.

**Tech Stack:** Tauri 2, Rust + `portable-pty`, React + TypeScript + Vite, `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl`.

---

## ⚙️ Conventions d'exécution (lire avant de commencer)

- **Le projet vit côté Windows** : `C:\Users\VirgileDc\Vlaude` = `/mnt/c/Users/VirgileDc/Vlaude` côté WSL. Claude (dans WSL) édite les fichiers via `/mnt/c/...`.
- **Tous les `npm`/`cargo`/`tauri` se lancent côté Windows** (toolchain MSVC + WebView2 requis ; l'app appelle `wsl.exe` donc elle doit tourner sur Windows). Deux façons :
  - **One-shots** (install, test, build) : depuis WSL, `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && <commande>"`.
  - **Serveur de dev long** (`npm run tauri dev`) : Virgile le lance dans un **terminal Windows** (ou via `! cmd.exe /c "..."` dans la session).
- **Prérequis Windows** (à vérifier une fois) : Node 20+, Rust (MSVC, `rustup`), WebView2 Runtime (présent par défaut Win11), Build Tools VS (MSVC). Et **WSL avec `claude` installé et loggé** (déjà le cas).
- **Git** : `git init` à la Task 0. Les steps « Commit » sont des **checkpoints** : conformément à la politique de Virgile, **ne pas committer sans son feu vert** — traiter chaque commit comme « prêt à committer, je confirme ? ».
- **TDD** : les modules de **logique pure** (`wsl.rs`, `coalesce.rs`) sont en vrai TDD (test rouge → vert). Le PTY/xterm est de l'**intégration** → vérifié par **observation** (lancer + constater), pas par test unitaire bidon.

---

## 🗺️ Structure des fichiers (créés dans ce plan)

```
C:\Users\VirgileDc\Vlaude\
├─ package.json, vite.config.ts, index.html, tsconfig.json   (scaffold)
├─ src/
│  ├─ main.tsx                      (entrée React)
│  ├─ App.tsx                       (monte UN <TerminalView/> pour le spike)
│  ├─ App.css
│  └─ terminal/
│     ├─ TerminalView.tsx           (composant xterm : monte, wire I/O, resize)
│     ├─ usePty.ts                  (helpers Tauri : spawn/write/resize/close + Channel)
│     └─ terminal.css
└─ src-tauri/
   ├─ Cargo.toml
   ├─ tauri.conf.json
   └─ src/
      ├─ main.rs                    (généré, appelle lib::run)
      ├─ lib.rs                     (builder Tauri, state PtyManager, commands)
      └─ pty/
         ├─ mod.rs                  (pub mod wsl/coalesce/manager)
         ├─ wsl.rs                  (build_wsl_argv + tests)         ← TDD
         ├─ coalesce.rs            (Coalescer + tests)               ← TDD
         └─ manager.rs              (PtyManager : spawn/write/resize/close)
```

**Responsabilité de chaque fichier** : `wsl.rs` = construire l'argv `wsl.exe` (pur). `coalesce.rs` = accumuler/vider des octets (pur). `manager.rs` = cycle de vie PTY + threads + Channel. `lib.rs` = câblage Tauri. `usePty.ts` = pont JS↔Rust. `TerminalView.tsx` = rendu terminal.

---

## Task 0 : Relocalisation + scaffold Tauri

**Files:**
- Create: tout le scaffold sous `C:\Users\VirgileDc\Vlaude\`

- [ ] **Step 1 : Déplacer le projet existant côté Windows**

Depuis WSL (copie les docs déjà écrits ; on ne perd rien) :
```bash
mkdir -p /mnt/c/Users/VirgileDc/Vlaude
cp -r /home/virgile/dt/Vlaude/docs /mnt/c/Users/VirgileDc/Vlaude/docs
cp /home/virgile/dt/Vlaude/.mcp.json /mnt/c/Users/VirgileDc/Vlaude/ 2>/dev/null || true
```

- [ ] **Step 2 : Scaffolder Tauri 2 (React + TS) dans le dossier**

Run (Windows, non-interactif) :
```bash
cmd.exe /c "cd /d C:\Users\VirgileDc && npm create tauri-app@latest Vlaude -- --template react-ts --manager npm --identifier com.vlaude.app"
```
Si le scaffold refuse un dossier non vide, scaffolder dans `Vlaude-tmp` puis fusionner `src/`, `src-tauri/`, `package.json`, `vite.config.ts`, `index.html`, `tsconfig*.json` dans `Vlaude\`.
Expected : arborescence `src/` + `src-tauri/` créée.

- [ ] **Step 3 : Installer les deps frontend**

Run :
```bash
cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && npm install && npm install @xterm/xterm @xterm/addon-fit @xterm/addon-webgl"
```
Expected : `node_modules` présent, 0 erreur.

- [ ] **Step 4 : Ajouter portable-pty au crate Rust**

Run :
```bash
cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo add portable-pty"
```
Expected : `portable-pty` ajouté dans `src-tauri/Cargo.toml`.

- [ ] **Step 5 : Vérifier que la fenêtre vide démarre**

Virgile lance dans un terminal Windows : `npm run tauri dev` (depuis `C:\Users\VirgileDc\Vlaude`).
Expected : une fenêtre Tauri vide s'ouvre, pas d'erreur de compilation Rust.

- [ ] **Step 6 : git init + commit checkpoint**

```bash
cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && git init && git add -A && git commit -m \"chore: scaffold Tauri 2 + React/TS + portable-pty\""
```

---

## Task 1 : `wsl.rs` — construire l'argv `wsl.exe` (TDD)

**Files:**
- Create: `src-tauri/src/pty/mod.rs`
- Create: `src-tauri/src/pty/wsl.rs`

- [ ] **Step 1 : Déclarer le module pty**

`src-tauri/src/pty/mod.rs` :
```rust
pub mod wsl;
```
Et dans `src-tauri/src/lib.rs`, ajouter en haut : `mod pty;`

- [ ] **Step 2 : Écrire les tests qui échouent**

`src-tauri/src/pty/wsl.rs` :
```rust
/// POSIX single-quote escaping: ' -> '\''
fn single_quote(s: &str) -> String {
    let escaped = s.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

/// Build the argument vector passed to `wsl.exe` to launch an interactive
/// `claude` REPL in `cwd`. `bash -lic` loads the login PATH (~/.local/bin)
/// and `exec claude` makes closing the PTY kill claude.
pub fn build_wsl_argv(distro: Option<&str>, cwd: &str) -> Vec<String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_distro() {
        let argv = build_wsl_argv(None, "/home/virgile/dt/threadscrap");
        assert_eq!(
            argv,
            vec![
                "--".to_string(),
                "bash".to_string(),
                "-lic".to_string(),
                "cd '/home/virgile/dt/threadscrap' && exec claude".to_string(),
            ]
        );
    }

    #[test]
    fn with_distro() {
        let argv = build_wsl_argv(Some("Ubuntu"), "/a/b");
        assert_eq!(argv[0], "-d");
        assert_eq!(argv[1], "Ubuntu");
        assert_eq!(argv[2], "--");
        assert_eq!(argv.last().unwrap(), "cd '/a/b' && exec claude");
    }

    #[test]
    fn escapes_single_quote_in_path() {
        let argv = build_wsl_argv(None, "/a b/it's");
        assert_eq!(argv.last().unwrap(), "cd '/a b/it'\\''s' && exec claude");
    }
}
```

- [ ] **Step 3 : Lancer les tests → rouge**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test wsl"`
Expected : FAIL (`not yet implemented` / `todo!`).

- [ ] **Step 4 : Implémenter `build_wsl_argv`**

Remplacer le `todo!()` par :
```rust
pub fn build_wsl_argv(distro: Option<&str>, cwd: &str) -> Vec<String> {
    let inner = format!("cd {} && exec claude", single_quote(cwd));
    let mut argv = Vec::new();
    if let Some(d) = distro {
        argv.push("-d".to_string());
        argv.push(d.to_string());
    }
    argv.push("--".to_string());
    argv.push("bash".to_string());
    argv.push("-lic".to_string());
    argv.push(inner);
    argv
}
```

- [ ] **Step 5 : Lancer les tests → vert**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test wsl"`
Expected : 3 tests PASS.

- [ ] **Step 6 : Commit checkpoint**

```bash
cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && git add -A && git commit -m \"feat(pty): build_wsl_argv with quoting + tests\""
```

---

## Task 2 : `coalesce.rs` — accumuler/vider des octets (TDD)

**Files:**
- Create: `src-tauri/src/pty/coalesce.rs`
- Modify: `src-tauri/src/pty/mod.rs`

- [ ] **Step 1 : Exporter le module**

`src-tauri/src/pty/mod.rs` devient :
```rust
pub mod wsl;
pub mod coalesce;
```

- [ ] **Step 2 : Écrire les tests qui échouent**

`src-tauri/src/pty/coalesce.rs` :
```rust
/// Accumulates raw PTY bytes between flush ticks so we send ~60 batched
/// messages/sec instead of one IPC message per tiny read.
#[derive(Default)]
pub struct Coalescer {
    buf: Vec<u8>,
}

impl Coalescer {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn push(&mut self, _data: &[u8]) {
        todo!()
    }
    /// Returns and clears the buffer, or None if empty.
    pub fn drain(&mut self) -> Option<Vec<u8>> {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_then_drain_concatenates() {
        let mut c = Coalescer::new();
        c.push(b"foo");
        c.push(b"bar");
        assert_eq!(c.drain(), Some(b"foobar".to_vec()));
    }

    #[test]
    fn drain_empty_is_none() {
        let mut c = Coalescer::new();
        assert_eq!(c.drain(), None);
    }

    #[test]
    fn drain_clears_buffer() {
        let mut c = Coalescer::new();
        c.push(b"x");
        let _ = c.drain();
        assert_eq!(c.drain(), None);
    }
}
```

- [ ] **Step 3 : Tests → rouge**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test coalesce"`
Expected : FAIL (`todo!`).

- [ ] **Step 4 : Implémenter**

```rust
    pub fn push(&mut self, data: &[u8]) {
        self.buf.extend_from_slice(data);
    }
    pub fn drain(&mut self) -> Option<Vec<u8>> {
        if self.buf.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.buf))
        }
    }
```

- [ ] **Step 5 : Tests → vert**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo test coalesce"`
Expected : 3 tests PASS.

- [ ] **Step 6 : Commit checkpoint**

```bash
cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && git add -A && git commit -m \"feat(pty): byte Coalescer + tests\""
```

---

## Task 3 : `manager.rs` — cycle de vie PTY + threads + Channel

**Files:**
- Create: `src-tauri/src/pty/manager.rs`
- Modify: `src-tauri/src/pty/mod.rs`

- [ ] **Step 1 : Exporter le module**

`src-tauri/src/pty/mod.rs` :
```rust
pub mod wsl;
pub mod coalesce;
pub mod manager;
```

- [ ] **Step 2 : Écrire le PtyManager complet**

`src-tauri/src/pty/manager.rs` :
```rust
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;

use super::coalesce::Coalescer;
use super::wsl::build_wsl_argv;

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    alive: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn spawn(
        &self,
        id: String,
        distro: Option<String>,
        cwd: String,
        cols: u16,
        rows: u16,
        on_data: Channel<&[u8]>,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new("wsl.exe");
        for arg in build_wsl_argv(distro.as_deref(), &cwd) {
            cmd.arg(arg);
        }
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave); // close the slave handle in the parent

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let coalescer = Arc::new(Mutex::new(Coalescer::new()));
        let alive = Arc::new(AtomicBool::new(true));

        // Reader thread: blocking reads → push into coalescer.
        {
            let coalescer = coalescer.clone();
            let alive = alive.clone();
            thread::spawn(move || {
                let mut buf = [0u8; 8192];
                while alive.load(Ordering::Relaxed) {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => coalescer.lock().unwrap().push(&buf[..n]),
                        Err(_) => break,
                    }
                }
                alive.store(false, Ordering::Relaxed);
            });
        }

        // Ticker thread: flush coalescer to the frontend every ~16 ms.
        {
            let coalescer = coalescer.clone();
            let alive = alive.clone();
            let on_data = on_data.clone();
            thread::spawn(move || {
                while alive.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_millis(16));
                    let drained = coalescer.lock().unwrap().drain();
                    if let Some(bytes) = drained {
                        if on_data.send(&bytes).is_err() {
                            break;
                        }
                    }
                }
                if let Some(bytes) = coalescer.lock().unwrap().drain() {
                    let _ = on_data.send(&bytes);
                }
            });
        }

        self.sessions
            .lock()
            .unwrap()
            .insert(id, PtySession { master: pair.master, writer, child, alive });
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let sess = sessions.get_mut(id).ok_or("unknown session")?;
        sess.writer.write_all(data).map_err(|e| e.to_string())?;
        sess.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let sess = sessions.get(id).ok_or("unknown session")?;
        sess.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn close(&self, id: &str) -> Result<(), String> {
        if let Some(mut sess) = self.sessions.lock().unwrap().remove(id) {
            sess.alive.store(false, Ordering::Relaxed);
            let _ = sess.child.kill();
        }
        Ok(())
    }
}
```

- [ ] **Step 3 : Vérifier que ça compile**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo build"`
Expected : compile OK. *(Si `Channel<&[u8]>` pose un souci de lifetime à la compilation, remplacer le type de message par `Vec<u8>` dans `spawn` ET dans la commande `pty_spawn` Task 4, et `on_data.send(bytes.clone())` — fonctionnellement identique ; la doc Tauri 2 supporte les deux, `&[u8]` étant le chemin binaire rapide.)*

- [ ] **Step 4 : Commit checkpoint**

```bash
cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && git add -A && git commit -m \"feat(pty): PtyManager spawn/write/resize/close with 16ms coalescing threads\""
```

---

## Task 4 : Câbler les commandes Tauri + le state

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1 : Réécrire `lib.rs`**

`src-tauri/src/lib.rs` (garder la fn `run` générée, y ajouter le state + les commands) :
```rust
mod pty;

use pty::manager::PtyManager;
use tauri::ipc::Channel;
use tauri::State;

#[tauri::command]
fn pty_spawn(
    state: State<PtyManager>,
    id: String,
    distro: Option<String>,
    cwd: String,
    cols: u16,
    rows: u16,
    on_data: Channel<&[u8]>,
) -> Result<(), String> {
    state.spawn(id, distro, cwd, cols, rows, on_data)
}

#[tauri::command]
fn pty_write(state: State<PtyManager>, id: String, data: Vec<u8>) -> Result<(), String> {
    state.write(&id, &data)
}

#[tauri::command]
fn pty_resize(state: State<PtyManager>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.resize(&id, cols, rows)
}

#[tauri::command]
fn pty_close(state: State<PtyManager>, id: String) -> Result<(), String> {
    state.close(&id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
*(Si le `lib.rs` généré contient déjà un exemple `greet`, le supprimer — surgical : on ne garde que ce qui sert.)*

- [ ] **Step 2 : Vérifier la compilation**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude\src-tauri && cargo build"`
Expected : compile OK.

- [ ] **Step 3 : Commit checkpoint**

```bash
cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && git add -A && git commit -m \"feat(ipc): register pty_spawn/write/resize/close commands + PtyManager state\""
```

---

## Task 5 : `usePty.ts` — pont JS ↔ Rust

**Files:**
- Create: `src/terminal/usePty.ts`

- [ ] **Step 1 : Écrire les helpers**

`src/terminal/usePty.ts` :
```ts
import { invoke, Channel } from "@tauri-apps/api/core";

export interface PtyHandle {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

/** Spawn a claude PTY in WSL and stream its bytes to `onData`. */
export function createPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void
): PtyHandle {
  const channel = new Channel<Uint8Array>();
  channel.onmessage = onData;

  invoke("pty_spawn", { id, distro: null, cwd, cols, rows, onData: channel }).catch(
    (e) => console.error("pty_spawn failed", e)
  );

  const encoder = new TextEncoder();
  return {
    write: (data) =>
      invoke("pty_write", { id, data: Array.from(encoder.encode(data)) }).catch(
        (e) => console.error("pty_write failed", e)
      ),
    resize: (c, r) =>
      invoke("pty_resize", { id, cols: c, rows: r }).catch(() => {}),
    close: () => invoke("pty_close", { id }).catch(() => {}),
  };
}
```

- [ ] **Step 2 : Commit checkpoint**

```bash
cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && git add -A && git commit -m \"feat(frontend): usePty bridge (spawn/write/resize/close via Channel)\""
```

---

## Task 6 : `TerminalView.tsx` — rendu xterm + I/O + resize

**Files:**
- Create: `src/terminal/TerminalView.tsx`
- Create: `src/terminal/terminal.css`

- [ ] **Step 1 : Écrire le composant**

`src/terminal/TerminalView.tsx` :
```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { createPty } from "./usePty";

interface Props {
  id: string;
  cwd: string;
}

export function TerminalView({ id, cwd }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      fontFamily:
        'ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: "#0e0e11", foreground: "#c8c8cf" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try {
      term.loadAddon(new WebglAddon());
    } catch (e) {
      console.warn("WebGL renderer unavailable, falling back to DOM", e);
    }
    fit.fit();

    const pty = createPty(id, cwd, term.cols, term.rows, (bytes) =>
      term.write(bytes)
    );
    const dataSub = term.onData((d) => pty.write(d));

    const ro = new ResizeObserver(() => {
      fit.fit();
      pty.resize(term.cols, term.rows);
    });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      dataSub.dispose();
      pty.close();
      term.dispose();
    };
  }, [id, cwd]);

  return <div className="vl-terminal-host" ref={hostRef} />;
}
```

`src/terminal/terminal.css` :
```css
.vl-terminal-host {
  width: 100%;
  height: 100%;
  background: #0e0e11;
  padding: 8px;
  box-sizing: border-box;
}
```

- [ ] **Step 2 : Monter un terminal dans `App.tsx`**

Remplacer le contenu de `src/App.tsx` par (spike : un cwd codé en dur — remplace par un de tes dossiers WSL réels) :
```tsx
import { TerminalView } from "./terminal/TerminalView";
import "./App.css";

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#0e0e11" }}>
      <TerminalView id="spike-1" cwd="/home/virgile/dt/threadscrap" />
    </div>
  );
}
```

- [ ] **Step 3 : SPIKE — lancer et OBSERVER (vérification clé du plan)**

Virgile lance `npm run tauri dev` (terminal Windows).
**Expected, à constater visuellement :**
1. Le **vrai prompt `claude`** apparaît dans la fenêtre (TUI, couleurs).
2. Je tape une question → claude répond, le streaming est fluide (pas de lag/saccade).
3. Couleurs ANSI et curseur corrects.
4. Je redimensionne la fenêtre → le terminal se reflow proprement (pas de troncature durable).

Si KO, déboguer dans l'ordre : (a) `wsl.exe` lance-t-il `claude` à la main avec le même argv ? (b) le Channel reçoit-il des octets (log dans `onData`) ? (c) corruption après resize → bug ConPTY connu (#14599), ajouter un envoi `Ctrl-L` après resize comme contournement.

- [ ] **Step 4 : Commit checkpoint**

```bash
cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && git add -A && git commit -m \"feat(frontend): live claude terminal via xterm (WebGL) — spike green\""
```

---

## Task 7 : Build `.exe`

**Files:**
- Modify: `src-tauri/tauri.conf.json` (titre fenêtre)

- [ ] **Step 1 : Régler le titre de la fenêtre**

Dans `src-tauri/tauri.conf.json`, mettre le `title` de la fenêtre principale à `"Vlaude"` et `productName` à `"Vlaude"`.

- [ ] **Step 2 : Build release**

Run : `cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && npm run tauri build"`
Expected : build OK ; binaire + installeur sous `src-tauri\target\release\bundle\`.

- [ ] **Step 3 : Lancer l'`.exe` et OBSERVER**

Double-cliquer l'`.exe` généré.
**Expected :** l'app démarre hors `dev`, un vrai `claude` tourne dans la fenêtre, taille de l'exe notée (objectif < ~20 Mo).

- [ ] **Step 4 : Commit checkpoint**

```bash
cmd.exe /c "cd /d C:\Users\VirgileDc\Vlaude && git add -A && git commit -m \"build: Vlaude .exe produces a working single-session claude terminal\""
```

---

## ✅ Definition of Done — Plan A
- Un vrai `claude` interactif tourne dans la fenêtre Tauri (frappe → réponse, couleurs/TUI fidèles).
- Resize de la fenêtre = reflow propre du terminal.
- Streaming fluide (batching 16 ms en place, pas de saturation CPU sur un débit soutenu type `claude` qui écrit beaucoup).
- `cargo test` : `wsl` + `coalesce` verts.
- `npm run tauri build` → un `.exe` Windows qui démarre et fait tout ce qui précède.

## 🔎 Couverture de la spec (traçabilité)
| Exigence spec | Couvert par |
|---|---|
| Wrapper CLI `claude` interactif (Vision A) | Task 3/6 (spawn `wsl.exe -- ... claude`) |
| Pont Windows→WSL via PTY/ConPTY | Task 1/3 (`build_wsl_argv` + `portable-pty`) |
| Batching 16 ms (pièce porteuse) | Task 2/3 (Coalescer + ticker thread) |
| Channel binaire (pas chunk-par-chunk) | Task 3/4/5 (`Channel<&[u8]>`/`Uint8Array`) |
| Terminal fidèle (xterm WebGL) | Task 6 |
| Resize/SIGWINCH | Task 3 (`resize`) + Task 6 (ResizeObserver) |
| Build `.exe` Windows | Task 0/7 |
| *(Hors Plan A → Plan B)* sidebar, canvas, grouping, 3 actions, multi-session | voir ci-dessous |

---

## 📋 Plan B (esquisse — détaillé une fois Plan A vert)

> Produit l'app v0.1 complète. Détaillé en plan séparé après validation du pont.

1. **SessionManager front + store** (état sessions, `openInCanvas`, focus, `groupKey=cwd`) — TDD reducers (Vitest).
2. **Dérivation des groupes par chemin** (pure fn) — TDD.
3. **Sidebar** : groupes repliables par chemin + `+ Nouvelle session` (dialogue dossier WSL via plugin `@tauri-apps/plugin-dialog`, chemins récents) + zone « À venir ».
4. **Canvas en zones par chemin** : double-clic ouvre une tuile ; plusieurs `<TerminalView/>` montés ; WebGL pour la tuile focus, DOM pour le fond.
5. **3 actions** par tuile (⛶ plein écran / ◳ enlever de la page = unmount sans `pty_close` / ✕ fermer = `pty_close`) + **modal de confirmation**.
6. **Resize/réarrange intra-zone**.
7. **Polish UI** via skill `frontend-design` (thème sombre Mac, réfs `../design` raycast/linear/warp) — invoqué AVANT de coder l'UI.
```
```

Sources techniques de référence : [marc2332/tauri-terminal](https://github.com/marc2332/tauri-terminal) · [Shabari-K-S/terminon](https://github.com/Shabari-K-S/terminon) · [crynta/terax-ai](https://github.com/crynta/terax-ai) · [Tnze/tauri-plugin-pty](https://github.com/Tnze/tauri-plugin-pty) · [Tauri – Calling Rust / Channels](https://v2.tauri.app/develop/calling-rust/).
