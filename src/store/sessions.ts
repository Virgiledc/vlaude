import { create } from "zustand";

export type SessionStatus = "running" | "idle" | "exited";

export interface Session {
  id: string;
  name: string;
  cwd: string;
  status: SessionStatus;
  openInCanvas: boolean;
}

interface SessionsState {
  sessions: Session[];
  focusId: string | null;
  counter: number;
  createSession: (cwd: string, name?: string) => string;
  openInCanvas: (id: string) => void;
  removeFromCanvas: (id: string) => void;
  closeSession: (id: string) => void;
  setFocus: (id: string) => void;
}

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const useSessions = create<SessionsState>((set) => ({
  sessions: [],
  focusId: null,
  counter: 0,
  createSession: (cwd, name) => {
    const id = newId();
    set((st) => {
      const counter = st.counter + 1;
      const session: Session = {
        id,
        name: name?.trim() || `session-${counter}`,
        cwd,
        status: "running",
        openInCanvas: true,
      };
      return { sessions: [...st.sessions, session], focusId: id, counter };
    });
    return id;
  },
  openInCanvas: (id) =>
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, openInCanvas: true } : s)),
      focusId: id,
    })),
  removeFromCanvas: (id) =>
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, openInCanvas: false } : s)),
    })),
  closeSession: (id) =>
    set((st) => ({
      sessions: st.sessions.filter((s) => s.id !== id),
      focusId: st.focusId === id ? null : st.focusId,
    })),
  setFocus: (id) => set({ focusId: id }),
}));
