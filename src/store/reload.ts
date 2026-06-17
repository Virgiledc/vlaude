export type ReloadPhase = "recapping" | "clearing" | "done" | "error";

export interface ReloadEntry {
  sessionId: string;
  handoffPath: string;
  donePath: string;
  startedAt: number;
  phase: ReloadPhase;
  handoff: string | null;
  error: string | null;
}

export interface ReloadSignals {
  doneContent: string | null;
  handoffContent: string | null;
}

export type ReloadAction =
  | { type: "wait" }
  | { type: "clear"; handoff: string }
  | { type: "fail"; error: string };

export const RECAP_TIMEOUT_MS = 180_000;
export const RELOAD_POLL_MS = 800;

export function reloadPaths(home: string, claudeSessionId: string): { handoffPath: string; donePath: string } {
  const base = `${home.replace(/\/+$/, "")}/.vlaude/handoffs/${claudeSessionId}`;
  return { handoffPath: `${base}.md`, donePath: `${base}.done` };
}

export function buildHandoffPrompt(handoffPath: string, donePath: string): string {
  return [
    "Le contexte de cette session est saturé. Avant que je reparte sur une session vierge,",
    "fais exactement ceci, dans cet ordre, sans me poser de question :",
    "",
    `1. Écris un handoff de reprise dans ${handoffPath} (écrase s'il existe). Court mais`,
    "   actionnable — c'est le PROMPT qui démarrera la prochaine session, pas un journal.",
    "   Contenu : objectif en cours, état/avancement réel, fichiers clés touchés (chemin:ligne),",
    "   prochaine étape concrète, pièges/contraintes à ne pas réoublier.",
    "",
    "2. Persiste dans le vault Obsidian uniquement le savoir durable, selon tes critères",
    "   habituels (trap résolu, décision d'archi, mécanisme du codebase, contournement de",
    "   limitation) — une note = une claim, rien de trivial. S'il n'y a rien qui mérite, skip.",
    "",
    `3. EN TOUT DERNIER, une fois 1 et 2 faits, écris ${donePath} (contenu : ok).`,
  ].join("\n");
}

export function planReload(entry: ReloadEntry, signals: ReloadSignals, now: number): ReloadAction {
  if (entry.phase !== "recapping") return { type: "wait" };
  if (signals.doneContent === null) {
    if (now - entry.startedAt >= RECAP_TIMEOUT_MS) {
      return { type: "fail", error: "timeout : claude n'a pas terminé le récap" };
    }
    return { type: "wait" };
  }
  const handoff = signals.handoffContent;
  if (handoff === null || handoff.trim() === "") {
    return { type: "fail", error: "handoff vide ou illisible" };
  }
  return { type: "clear", handoff };
}

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useSessions } from "./sessions";
import { featurePayload } from "./injection";
import { wslHome } from "./wslfs";
import { getTerm } from "../terminal/termRegistry";

const encoder = new TextEncoder();

interface ReloadStore {
  entries: Record<string, ReloadEntry>;
  poll: ReturnType<typeof setInterval> | null;
  startReload: (sessionId: string) => Promise<void>;
  isClearing: (sessionId: string) => boolean;
  phaseOf: (sessionId: string) => ReloadPhase | undefined;
  onReady: (sessionId: string) => void;
  tick: () => Promise<void>;
  ensurePoll: () => void;
  stopPoll: () => void;
}

export const useReload = create<ReloadStore>((set, get) => ({
  entries: {},
  poll: null,

  startReload: async (sessionId) => {
    const active = get().entries[sessionId]?.phase;
    if (active === "recapping" || active === "clearing") return;
    const session = useSessions.getState().sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const home = (await wslHome()) || "/home";
    const { handoffPath, donePath } = reloadPaths(home, session.claudeSessionId);
    const entry: ReloadEntry = {
      sessionId,
      handoffPath,
      donePath,
      startedAt: Date.now(),
      phase: "recapping",
      handoff: null,
      error: null,
    };
    set((s) => ({ entries: { ...s.entries, [sessionId]: entry } }));
    const payload = featurePayload(buildHandoffPrompt(handoffPath, donePath));
    invoke("pty_write", { id: sessionId, data: Array.from(encoder.encode(payload)) }).catch((e) =>
      console.error("pty_write failed", e)
    );
    get().ensurePoll();
  },

  isClearing: (sessionId) => get().entries[sessionId]?.phase === "clearing",

  phaseOf: (sessionId) => get().entries[sessionId]?.phase,

  onReady: (sessionId) => {
    const e = get().entries[sessionId];
    if (!e || e.phase !== "clearing" || e.handoff === null) return;
    getTerm(sessionId)?.paste(e.handoff);
    set((s) => ({ entries: { ...s.entries, [sessionId]: { ...s.entries[sessionId], phase: "done" } } }));
  },

  tick: async () => {
    const recapping = Object.values(get().entries).filter((e) => e.phase === "recapping");
    if (recapping.length === 0) {
      get().stopPoll();
      return;
    }
    const now = Date.now();
    for (const e of recapping) {
      let doneContent: string | null = null;
      let handoffContent: string | null = null;
      try {
        doneContent = await invoke<string | null>("wsl_read_file", { path: e.donePath });
        if (doneContent !== null) handoffContent = await invoke<string | null>("wsl_read_file", { path: e.handoffPath });
      } catch {
        continue;
      }
      const action = planReload(e, { doneContent, handoffContent }, now);
      if (action.type === "wait") continue;
      if (action.type === "fail") {
        set((s) => ({ entries: { ...s.entries, [e.sessionId]: { ...s.entries[e.sessionId], phase: "error", error: action.error } } }));
      } else {
        set((s) => ({ entries: { ...s.entries, [e.sessionId]: { ...s.entries[e.sessionId], phase: "clearing", handoff: action.handoff } } }));
        useSessions.getState().respawnSession(e.sessionId);
      }
    }
  },

  ensurePoll: () => {
    if (get().poll) return;
    set({ poll: setInterval(() => { get().tick(); }, RELOAD_POLL_MS) });
  },

  stopPoll: () => {
    const p = get().poll;
    if (p) clearInterval(p);
    set({ poll: null });
  },
}));
