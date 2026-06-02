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
