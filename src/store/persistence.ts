import { invoke } from "@tauri-apps/api/core";
import { useSessions, type PersistedSnapshot } from "./sessions";

export async function loadLayout(): Promise<void> {
  try {
    const raw = await invoke<string | null>("load_layout");
    if (!raw) return;
    const snap = JSON.parse(raw) as PersistedSnapshot;
    useSessions.getState().hydrate(snap);
  } catch (e) {
    console.error("loadLayout failed", e);
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function startAutoSave(): () => void {
  const persist = () => {
    const snap = useSessions.getState().snapshot();
    invoke("save_layout", { data: JSON.stringify(snap) }).catch((e) =>
      console.error("save_layout failed", e)
    );
  };
  const unsub = useSessions.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, 500);
  });
  return unsub;
}
