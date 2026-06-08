import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSessions } from "../store/sessions";
import { cleanTranscript, useDictation } from "../store/dictation";
import { getTerm } from "./termRegistry";

interface ResultPayload {
  transcript?: string;
}

interface ErrorPayload {
  code?: string;
  message?: string;
}

interface ProgressPayload {
  status?: string;
  progress?: number;
}

export function useDictationEvents(): void {
  useEffect(() => {
    let disposed = false;
    const unlistens: (() => void)[] = [];
    const sub = <T>(event: string, handler: (payload: T) => void): void => {
      listen<T>(event, (e) => handler(e.payload))
        .then((u) => {
          if (disposed) u();
          else unlistens.push(u);
        })
        .catch((e) => console.error(`listen ${event} failed`, e));
    };

    sub<ResultPayload>("stt://result", (p) => {
      const id = useDictation.getState().consumeResult();
      if (!id) return;
      const text = cleanTranscript(p.transcript ?? "");
      if (!text) {
        useDictation.getState().markEmptyResult(id);
        return;
      }
      const term = getTerm(id);
      if (!term) return;
      term.paste(text + " ");
      if (useSessions.getState().focusId === id) term.focus();
    });

    sub<ErrorPayload>("stt://error", (p) => {
      useDictation.getState().failActive(p.message || p.code || "reconnaissance vocale en erreur");
    });

    sub<ProgressPayload>("stt://download-progress", (p) => {
      if (p.status === "downloading" && typeof p.progress === "number") {
        useDictation.getState().setProgress(p.progress);
      }
    });

    return () => {
      disposed = true;
      for (const u of unlistens) u();
    };
  }, []);
}
