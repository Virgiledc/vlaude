import { invoke, Channel } from "@tauri-apps/api/core";

export interface PtyHandle {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

export function createPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
  kind: "claude" | "claudex" | "term" = "claude",
  env?: Record<string, string>,
  claudeSessionId?: string
): PtyHandle {
  const channel = new Channel<ArrayBuffer | Uint8Array>();
  channel.onmessage = (msg) => {
    onData(msg instanceof Uint8Array ? msg : new Uint8Array(msg));
  };

  invoke("pty_spawn", {
    id, distro: null, cwd, cols, rows, kind,
    env: env ? Object.entries(env) : null,
    claudeSessionId: claudeSessionId ?? null,
    onData: channel,
  }).catch(
    (e) => console.error("pty_spawn failed", e)
  );

  const encoder = new TextEncoder();
  return {
    write: (data) =>
      invoke("pty_write", { id, data: Array.from(encoder.encode(data)) }).catch(
        (e) => console.error("pty_write failed", e)
      ),
    resize: (c, r) => invoke("pty_resize", { id, cols: c, rows: r }).catch(() => {}),
    close: () => invoke("pty_close", { id }).catch(() => {}),
  };
}
