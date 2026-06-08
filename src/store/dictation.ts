import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type DictationPhase = "idle" | "arming" | "recording" | "transcribing" | "downloading";

export const DICTATION_LANGUAGE = "fr";
export const DICTATION_MODEL = "small";
export const MAX_RECORD_MS = 120_000;
export const AUTOSTOP_MARGIN_MS = 5_000;

export interface DictationError {
  id: string;
  message: string;
}

export interface DictationSnapshot {
  phase: DictationPhase;
  activeId: string | null;
  progress: number;
  error: DictationError | null;
}

export interface MicView {
  cls: string;
  title: string;
  disabled: boolean;
}

export function cleanTranscript(raw: string): string {
  return raw.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export function safetyTimeoutMs(recordedMs: number): number {
  return Math.max(15_000, 2 * recordedMs);
}

export function resultConsumable(phase: DictationPhase, elapsedMs: number): boolean {
  if (phase === "transcribing") return true;
  return phase === "recording" && elapsedMs >= MAX_RECORD_MS - AUTOSTOP_MARGIN_MS;
}

export function micView(id: string, snap: DictationSnapshot): MicView {
  if (snap.phase === "downloading")
    return { cls: " busy", title: `Téléchargement du modèle vocal (${DICTATION_MODEL}, 466 Mo)… ${snap.progress}%`, disabled: true };
  if (snap.activeId === id && snap.phase === "arming")
    return { cls: " busy", title: "Démarrage du micro…", disabled: true };
  if (snap.activeId === id && snap.phase === "recording")
    return { cls: " rec", title: "Enregistrement — cliquer pour transcrire", disabled: false };
  if (snap.activeId === id && snap.phase === "transcribing")
    return { cls: " busy", title: "Transcription…", disabled: true };
  if (snap.phase !== "idle")
    return { cls: "", title: "Dictée en cours dans une autre tuile", disabled: true };
  if (snap.error && snap.error.id === id)
    return { cls: " failed", title: `Dicter en français — dernière erreur : ${snap.error.message}`, disabled: false };
  return { cls: "", title: "Dicter en français", disabled: false };
}

const sttStart = () =>
  invoke("plugin:stt|start_listening", {
    config: { language: DICTATION_LANGUAGE, maxDuration: MAX_RECORD_MS },
  });
const sttStop = () => invoke("plugin:stt|stop_listening");
const sttAvailable = () => invoke<{ available: boolean }>("plugin:stt|is_available");
const sttInstall = () => invoke("plugin:stt|install_model", { id: DICTATION_MODEL });

interface DictationStore extends DictationSnapshot {
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  toggle: (id: string) => void;
  abortIfActive: (id: string) => void;
  consumeResult: () => string | null;
  markEmptyResult: (id: string) => void;
  failActive: (message: string) => void;
  setProgress: (p: number) => void;
}

export const useDictation = create<DictationStore>((set, get) => ({
  activeId: null,
  phase: "idle",
  progress: 0,
  error: null,
  startedAt: 0,
  timer: null,

  toggle: (id) => {
    const st = get();
    if (st.phase === "arming" || st.phase === "transcribing" || st.phase === "downloading") return;
    if (st.activeId !== null && st.activeId !== id) return;
    if (st.phase === "recording") {
      const timer = setTimeout(() => {
        if (get().phase === "transcribing")
          set({ activeId: null, phase: "idle", timer: null, error: { id, message: "transcription sans réponse" } });
      }, safetyTimeoutMs(Date.now() - st.startedAt));
      set({ phase: "transcribing", timer });
      sttStop().catch((e) => {
        const cur = get();
        if (cur.timer !== null) clearTimeout(cur.timer);
        set({ activeId: null, phase: "idle", timer: null, error: { id, message: String(e) } });
      });
      return;
    }
    set({ activeId: id, phase: "arming", error: null });
    sttAvailable()
      .then((a) => {
        const cur = get();
        if (cur.activeId !== id || cur.phase !== "arming") return;
        if (!a.available) {
          set({ phase: "downloading", progress: 0 });
          sttInstall()
            .then(() => {
              if (get().phase === "downloading") set({ activeId: null, phase: "idle", progress: 0 });
            })
            .catch((e) => {
              if (get().phase === "downloading")
                set({ activeId: null, phase: "idle", progress: 0, error: { id, message: String(e) } });
            });
          return;
        }
        sttStart()
          .then(() => {
            const now = get();
            if (now.activeId === id && now.phase === "arming") set({ phase: "recording", startedAt: Date.now() });
            else sttStop().catch(() => {});
          })
          .catch((e) => {
            const msg = String(e);
            if (msg.includes("already listening")) sttStop().catch(() => {});
            const now = get();
            if (now.activeId === id && now.phase === "arming")
              set({ activeId: null, phase: "idle", error: { id, message: msg } });
          });
      })
      .catch((e) => {
        const cur = get();
        if (cur.activeId === id && cur.phase === "arming")
          set({ activeId: null, phase: "idle", error: { id, message: String(e) } });
      });
  },

  abortIfActive: (id) => {
    const st = get();
    if (st.activeId !== id) return;
    if (st.timer !== null) clearTimeout(st.timer);
    if (st.phase === "downloading") {
      set({ activeId: null, timer: null });
      return;
    }
    if (st.phase === "recording" || st.phase === "arming") sttStop().catch(() => {});
    set({ activeId: null, phase: "idle", timer: null });
  },

  consumeResult: () => {
    const st = get();
    if (st.activeId === null) return null;
    if (!resultConsumable(st.phase, Date.now() - st.startedAt)) return null;
    if (st.timer !== null) clearTimeout(st.timer);
    set({ activeId: null, phase: "idle", timer: null });
    return st.activeId;
  },

  markEmptyResult: (id) => set({ error: { id, message: "transcription vide" } }),

  failActive: (message) => {
    const st = get();
    if (st.phase !== "arming" && st.phase !== "recording" && st.phase !== "transcribing") return;
    if (st.timer !== null) clearTimeout(st.timer);
    set({
      activeId: null,
      phase: "idle",
      timer: null,
      error: st.activeId ? { id: st.activeId, message } : null,
    });
  },

  setProgress: (p) => {
    if (get().phase === "downloading") set({ progress: p });
  },
}));
