import { invoke, Channel } from "@tauri-apps/api/core";

type Sink = (bytes: Uint8Array) => void;

const sinks = new Map<string, Sink>();
const decoder = new TextDecoder();
let attached: Promise<unknown> | null = null;

export function decodeFrames(buf: Uint8Array, emit: (id: string, bytes: Uint8Array) => void): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  while (o < buf.length) {
    const idLen = view.getUint16(o, true);
    const id = decoder.decode(buf.subarray(o + 2, o + 2 + idLen));
    o += 2 + idLen;
    const len = view.getUint32(o, true);
    o += 4;
    emit(id, buf.subarray(o, o + len));
    o += len;
  }
}

export function subscribePty(id: string, sink: Sink): Promise<unknown> {
  sinks.set(id, sink);
  if (!attached) {
    const channel = new Channel<ArrayBuffer | Uint8Array>();
    channel.onmessage = (msg) =>
      decodeFrames(msg instanceof Uint8Array ? msg : new Uint8Array(msg), (sid, bytes) => sinks.get(sid)?.(bytes));
    attached = invoke("pty_attach", { onData: channel });
  }
  return attached;
}

export function unsubscribePty(id: string, sink: Sink): void {
  if (sinks.get(id) === sink) sinks.delete(id);
}
