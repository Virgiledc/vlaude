use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Instant;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};

use super::coalesce::{flush_delay, Coalescer};
use super::frame::encode_frame;
use super::shell::{build_shell_argv, SessionKind};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    alive: Arc<AtomicBool>,
    slot: u64,
}

#[derive(Default)]
struct Pending {
    sessions: HashMap<u64, (String, Coalescer)>,
    channel: Option<Channel<InvokeResponseBody>>,
}

impl Pending {
    fn has_data(&self) -> bool {
        self.sessions.values().any(|(_, buf)| !buf.is_empty())
    }
}

#[derive(Default)]
struct Outbox {
    pending: Mutex<Pending>,
    ready: Condvar,
}

impl Outbox {
    fn push(&self, slot: u64, data: &[u8]) {
        if let Some((_, buf)) = self.pending.lock().unwrap().sessions.get_mut(&slot) {
            buf.push(data);
            self.ready.notify_one();
        }
    }

    fn flush_forever(&self) {
        let mut last: Option<Instant> = None;
        loop {
            let mut pending = self.pending.lock().unwrap();
            while pending.channel.is_none() || !pending.has_data() {
                pending = self.ready.wait(pending).unwrap();
            }
            let wait = flush_delay(last.map(|t| t.elapsed()));
            if !wait.is_zero() {
                drop(pending);
                thread::sleep(wait);
                pending = self.pending.lock().unwrap();
            }
            let mut frame = Vec::new();
            for (id, buf) in pending.sessions.values_mut() {
                if let Some(bytes) = buf.drain() {
                    encode_frame(&mut frame, id, &bytes);
                }
            }
            let channel = pending.channel.clone();
            drop(pending);
            last = Some(Instant::now());
            if let Some(channel) = channel.filter(|_| !frame.is_empty()) {
                let _ = channel.send(InvokeResponseBody::Raw(frame));
            }
        }
    }
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
    outbox: Arc<Outbox>,
    next_slot: AtomicU64,
}

impl Default for PtyManager {
    fn default() -> Self {
        let outbox = Arc::new(Outbox::default());
        let flusher = outbox.clone();
        thread::spawn(move || flusher.flush_forever());
        Self { sessions: Mutex::new(HashMap::new()), outbox, next_slot: AtomicU64::new(0) }
    }
}

impl PtyManager {
    pub fn attach(&self, channel: Channel<InvokeResponseBody>) {
        self.outbox.pending.lock().unwrap().channel = Some(channel);
        self.outbox.ready.notify_one();
    }

    pub fn spawn(
        &self,
        id: String,
        cwd: String,
        cols: u16,
        rows: u16,
        kind: SessionKind,
        env: Vec<(String, String)>,
        claude_session_id: Option<String>,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new("bash");
        for arg in build_shell_argv(&cwd, kind, &env, claude_session_id.as_deref()) {
            cmd.arg(arg);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let alive = Arc::new(AtomicBool::new(true));
        let slot = self.next_slot.fetch_add(1, Ordering::Relaxed);
        self.outbox.pending.lock().unwrap().sessions.insert(slot, (id.clone(), Coalescer::new()));

        {
            let outbox = self.outbox.clone();
            let alive = alive.clone();
            thread::spawn(move || {
                let mut buf = [0u8; 8192];
                while alive.load(Ordering::Relaxed) {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => outbox.push(slot, &buf[..n]),
                        Err(_) => break,
                    }
                }
                alive.store(false, Ordering::Relaxed);
            });
        }

        let replaced = self
            .sessions
            .lock()
            .unwrap()
            .insert(id, PtySession { master: pair.master, writer, child, alive, slot });
        if let Some(old) = replaced {
            self.outbox.pending.lock().unwrap().sessions.remove(&old.slot);
        }
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
        let removed = self.sessions.lock().unwrap().remove(id);
        if let Some(mut sess) = removed {
            sess.alive.store(false, Ordering::Relaxed);
            let _ = sess.child.kill();
            self.outbox.pending.lock().unwrap().sessions.remove(&sess.slot);
        }
        Ok(())
    }
}
