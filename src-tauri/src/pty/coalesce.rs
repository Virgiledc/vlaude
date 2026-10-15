use std::time::Duration;

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
    pub fn push(&mut self, data: &[u8]) {
        self.buf.extend_from_slice(data);
    }
    /// Returns and clears the buffer, or None if empty.
    pub fn drain(&mut self) -> Option<Vec<u8>> {
        if self.buf.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.buf))
        }
    }
    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }
}

pub const FRAME: Duration = Duration::from_millis(33);

pub fn flush_delay(since_last_flush: Option<Duration>) -> Duration {
    since_last_flush.map_or(Duration::ZERO, |d| FRAME.saturating_sub(d))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_flush_is_immediate() {
        assert_eq!(flush_delay(None), Duration::ZERO);
    }

    #[test]
    fn flush_after_idle_is_immediate() {
        assert_eq!(flush_delay(Some(Duration::from_millis(400))), Duration::ZERO);
        assert_eq!(flush_delay(Some(FRAME)), Duration::ZERO);
    }

    #[test]
    fn flush_under_load_waits_for_the_rest_of_the_frame() {
        assert_eq!(flush_delay(Some(Duration::ZERO)), FRAME);
        assert_eq!(flush_delay(Some(Duration::from_millis(10))), FRAME - Duration::from_millis(10));
    }

    #[test]
    fn is_empty_tracks_pending_bytes() {
        let mut c = Coalescer::new();
        assert!(c.is_empty());
        c.push(b"x");
        assert!(!c.is_empty());
        let _ = c.drain();
        assert!(c.is_empty());
    }

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
