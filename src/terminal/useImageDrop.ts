import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useSessions } from "../store/sessions";
import { getTerm } from "./termRegistry";
import { winToWslPath } from "./winToWsl";

export function useImageDrop(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const id = useSessions.getState().focusId;
        if (!id) return;
        const term = getTerm(id);
        if (!term) return;
        for (const path of event.payload.paths) {
          term.paste(winToWslPath(path) + " ");
        }
        term.focus();
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      })
      .catch((e) => console.error("onDragDropEvent failed", e));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
