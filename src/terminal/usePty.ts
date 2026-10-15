import { invoke } from "@tauri-apps/api/core";
import { subscribePty, unsubscribePty } from "./ptyStream";

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
  kind: "claude" | "claudex" | "codex" | "omp" | "term" = "claude",
  env?: Record<string, string>,
  claudeSessionId?: string
): PtyHandle {
  let closed = false;
  subscribePty(id, onData)
    .then(() => {
      if (closed) return;
      return invoke("pty_spawn", {
        id, cwd, cols, rows, kind,
        env: env ? Object.entries(env) : null,
        claudeSessionId: claudeSessionId ?? null,
      });
    })
    .catch((e) => console.error("pty_spawn failed", e));

  const encoder = new TextEncoder();
  return {
    write: (data) =>
      invoke("pty_write", { id, data: Array.from(encoder.encode(data)) }).catch(
        (e) => console.error("pty_write failed", e)
      ),
    resize: (c, r) => invoke("pty_resize", { id, cols: c, rows: r }).catch(() => {}),
    close: () => {
      closed = true;
      unsubscribePty(id, onData);
      invoke("pty_close", { id }).catch(() => {});
    },
  };
}
