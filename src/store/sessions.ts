import { create } from "zustand";
import { clampSidebarWidth, SIDEBAR_WIDTH_DEFAULT } from "./sidebar";

export type SessionState = "working" | "waiting" | "attention" | "exited";

export interface Workspace {
  id: string;
  name: string;
}

export interface Session {
  id: string;
  name: string;
  cwd: string;
  workspaceId: string;
  order: number;
  state: SessionState;
  openInCanvas: boolean;
}

export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PersistedSnapshot {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  sessions: Session[];
  counter: number;
  workspaceCounter: number;
  layouts: Record<string, GridItem[]>;
  sidebarWidth: number;
}

interface AppState extends PersistedSnapshot {
  focusId: string | null;
  fullscreenId: string | null;
  views: Record<string, "claude" | "term">;
  createSession: (cwd: string, name?: string) => string;
  openInCanvas: (id: string) => void;
  removeFromCanvas: (id: string) => void;
  closeSession: (id: string) => void;
  setFocus: (id: string) => void;
  toggleFullscreen: (id: string) => void;
  exitFullscreen: () => void;
  toggleView: (id: string) => void;
  setSessionState: (id: string, state: SessionState) => void;
  reorderInZone: (workspaceId: string, cwd: string, orderedIds: string[]) => void;
  setLayout: (workspaceId: string, items: GridItem[]) => void;
  setSidebarWidth: (w: number) => void;
  createWorkspace: (name?: string) => string;
  renameWorkspace: (id: string, name: string) => void;
  closeWorkspace: (id: string) => void;
  switchWorkspace: (id: string) => void;
  hydrate: (snap: PersistedSnapshot) => void;
  snapshot: () => PersistedSnapshot;
}

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const FIRST_WS = "ws-1";
const defaultWorkspaces = (): Workspace[] => [{ id: FIRST_WS, name: "Workspace 1" }];

export const useSessions = create<AppState>((set, get) => ({
  workspaces: defaultWorkspaces(),
  activeWorkspaceId: FIRST_WS,
  sessions: [],
  focusId: null,
  fullscreenId: null,
  views: {},
  counter: 0,
  workspaceCounter: 1,
  layouts: {},
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,

  createSession: (cwd, name) => {
    const id = newId();
    set((st) => {
      const counter = st.counter + 1;
      const wsId = st.activeWorkspaceId;
      const maxOrder = st.sessions
        .filter((s) => s.workspaceId === wsId && s.cwd === cwd)
        .reduce((m, s) => Math.max(m, s.order), -1);
      const session: Session = {
        id,
        name: name?.trim() || `session-${counter}`,
        cwd,
        workspaceId: wsId,
        order: maxOrder + 1,
        state: "working",
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
      fullscreenId: st.fullscreenId === id ? null : st.fullscreenId,
    })),

  closeSession: (id) =>
    set((st) => ({
      sessions: st.sessions.filter((s) => s.id !== id),
      focusId: st.focusId === id ? null : st.focusId,
      fullscreenId: st.fullscreenId === id ? null : st.fullscreenId,
    })),

  setFocus: (id) => set({ focusId: id }),

  toggleFullscreen: (id) =>
    set((st) => {
      if (st.fullscreenId === id) return { fullscreenId: null };
      const target = st.sessions.find((s) => s.id === id);
      if (!target || !target.openInCanvas) return { fullscreenId: null };
      return { fullscreenId: id, focusId: id };
    }),

  exitFullscreen: () => set({ fullscreenId: null }),

  toggleView: (id) =>
    set((st) => ({
      views: { ...st.views, [id]: st.views[id] === "term" ? "claude" : "term" },
    })),

  setSessionState: (id, state) =>
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, state } : s)),
    })),

  reorderInZone: (workspaceId, cwd, orderedIds) =>
    set((st) => {
      const pos = new Map(orderedIds.map((sid, i) => [sid, i] as const));
      return {
        sessions: st.sessions.map((s) =>
          s.workspaceId === workspaceId && s.cwd === cwd && pos.has(s.id)
            ? { ...s, order: pos.get(s.id)! }
            : s
        ),
      };
    }),

  setLayout: (workspaceId, items) =>
    set((st) => ({ layouts: { ...st.layouts, [workspaceId]: items } })),

  setSidebarWidth: (w) => set({ sidebarWidth: clampSidebarWidth(w) }),

  createWorkspace: (name) => {
    const id = newId();
    set((st) => {
      const workspaceCounter = st.workspaceCounter + 1;
      const ws: Workspace = { id, name: name?.trim() || `Workspace ${workspaceCounter}` };
      return { workspaces: [...st.workspaces, ws], activeWorkspaceId: id, workspaceCounter, fullscreenId: null };
    });
    return id;
  },

  renameWorkspace: (id, name) =>
    set((st) => ({
      workspaces: st.workspaces.map((w) => (w.id === id ? { ...w, name: name.trim() || w.name } : w)),
    })),

  closeWorkspace: (id) =>
    set((st) => {
      if (st.workspaces.length <= 1) return st;
      const workspaces = st.workspaces.filter((w) => w.id !== id);
      const sessions = st.sessions.filter((s) => s.workspaceId !== id);
      const activeWorkspaceId = st.activeWorkspaceId === id ? workspaces[0].id : st.activeWorkspaceId;
      const layouts = { ...st.layouts };
      delete layouts[id];
      const fullscreenId =
        st.fullscreenId && sessions.some((s) => s.id === st.fullscreenId) ? st.fullscreenId : null;
      return { workspaces, sessions, activeWorkspaceId, layouts, fullscreenId };
    }),

  switchWorkspace: (id) => set({ activeWorkspaceId: id, fullscreenId: null }),

  hydrate: (snap) =>
    set({
      workspaces: snap.workspaces.length ? snap.workspaces : defaultWorkspaces(),
      activeWorkspaceId: snap.activeWorkspaceId || FIRST_WS,
      sessions: snap.sessions.map((s) => ({ ...s, state: "working" as SessionState })),
      counter: snap.counter,
      workspaceCounter: snap.workspaceCounter,
      layouts: snap.layouts ?? {},
      sidebarWidth: clampSidebarWidth(snap.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT),
      focusId: null,
      fullscreenId: null,
    }),

  snapshot: () => {
    const st = get();
    return {
      workspaces: st.workspaces,
      activeWorkspaceId: st.activeWorkspaceId,
      sessions: st.sessions,
      counter: st.counter,
      workspaceCounter: st.workspaceCounter,
      layouts: st.layouts,
      sidebarWidth: st.sidebarWidth,
    };
  },
}));
