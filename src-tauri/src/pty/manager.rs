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
        on_data: Channel<Vec<u8>>,
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
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let coalescer = Arc::new(Mutex::new(Coalescer::new()));
        let alive = Arc::new(AtomicBool::new(true));

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

        {
            let coalescer = coalescer.clone();
            let alive = alive.clone();
            let on_data = on_data.clone();
            thread::spawn(move || {
                while alive.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_millis(16));
                    let drained = coalescer.lock().unwrap().drain();
                    if let Some(bytes) = drained {
                        if on_data.send(bytes).is_err() {
                            break;
                        }
                    }
                }
                if let Some(bytes) = coalescer.lock().unwrap().drain() {
                    let _ = on_data.send(bytes);
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
