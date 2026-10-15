pub fn encode_frame(out: &mut Vec<u8>, id: &str, data: &[u8]) {
    out.extend_from_slice(&(id.len() as u16).to_le_bytes());
    out.extend_from_slice(id.as_bytes());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(data);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_concatenated_with_le_lengths() {
        let mut out = Vec::new();
        encode_frame(&mut out, "ab", b"xyz");
        encode_frame(&mut out, "c", b"");
        assert_eq!(out, vec![2, 0, b'a', b'b', 3, 0, 0, 0, b'x', b'y', b'z', 1, 0, b'c', 0, 0, 0, 0]);
    }
}
