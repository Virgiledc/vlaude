export const READY_MARKER = new Uint8Array([0xe2, 0x9d, 0xaf, 0xc2, 0xa0]);

export function createMarkerScanner(onReady: () => void): (bytes: Uint8Array) => void {
  let pos = 0;
  let done = false;
  return (bytes) => {
    if (done) return;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === READY_MARKER[pos]) pos += 1;
      else pos = bytes[i] === READY_MARKER[0] ? 1 : 0;
      if (pos === READY_MARKER.length) {
        done = true;
        onReady();
        return;
      }
    }
  };
}
