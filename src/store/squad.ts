import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { wslHome } from "./wslfs";
import { useSessions } from "./sessions";
import { planInjections, injectionPayload, newInjectionEntry, featurePayload } from "./injection";
import type { InjectionEntry, InjectionView } from "./injection";
import { planWake, newWakeState, wakePayload } from "./wake";
import type { WakeState } from "./wake";
import type { SquadState, SquadTaskStatus } from "../components/SquadPanel";

export interface SquadViewRaw {
  squad: { squad_id: string; cwd: string } | null;
  members: { name: string; role: "pere" | "fils"; alive: boolean; last_seen: number }[];
  tasks: {
    id: number;
    title: string;
    status: SquadTaskStatus;
    owned_paths: string[];
    claimed_by: string | null;
  }[];
}

const uuid = (): string =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  ).replace(/-/g, "");

const lastSegment = (p: string): string => p.replace(/\/+$/, "").split("/").filter(Boolean).pop() || p;

export function mapView(raw: SquadViewRaw | null): SquadState | null {
  if (!raw || !raw.squad) return null;
  return {
    name: lastSegment(raw.squad.cwd),
    members: raw.members.map((m) => ({ name: m.name, role: m.role, alive: m.alive, lastSeen: m.last_seen })),
    tasks: raw.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      ownedPaths: t.owned_paths,
      status: t.status,
      claimedBy: t.claimed_by,
    })),
    overlaps: [],
    messages: [],
  };
}

export function toInjectionView(raw: SquadViewRaw | null): InjectionView | null {
  if (!raw || !raw.squad) return null;
  return {
    members: raw.members.map((m) => ({ name: m.name, lastSeen: m.last_seen })),
    hasTodo: raw.tasks.some((t) => t.status === "todo"),
  };
}

function squadEnv(home: string, cwd: string, token: string): Record<string, string> {
  const h = home.replace(/\/+$/, "");
  const c = cwd.replace(/\/+$/, "");
  return {
    VLAUDE_SQUAD_PY: `${h}/.vlaude/squad.py`,
    VLAUDE_SQUAD_DB: `${c}/.vlaude/squad.db`,
    VLAUDE_SQUAD_TOKEN: token,
  };
}

async function squadCli(cwd: string, args: string[]): Promise<SquadViewRaw | null> {
  const raw = await invoke<string>("squad_cli", { cwd, args });
  return raw ? (JSON.parse(raw) as SquadViewRaw) : null;
}

const encoder = new TextEncoder();

const writeRole = (id: string, payload: string): void => {
  invoke("pty_write", { id, data: Array.from(encoder.encode(payload)) }).catch((e) =>
    console.error("pty_write failed", e)
  );
};

interface SquadStore {
  active: { squadId: string; cwd: string } | null;
  view: SquadState | null;
  envById: Record<string, Record<string, string>>;
  roleById: Record<string, "pere" | "fils">;
  injection: Record<string, InjectionEntry>;
  wake: WakeState;
  poll: ReturnType<typeof setInterval> | null;
  panelCollapsed: boolean;
  createSquad: (cwd: string, name?: string) => Promise<void>;
  addFils: (name?: string) => Promise<void>;
  notifySpawn: (sessionId: string) => void;
  markReady: (sessionId: string) => void;
  manualInject: (sessionId: string) => void;
  runInjection: (raw: SquadViewRaw | null, now: number) => void;
  sendFeature: (text: string) => void;
  runWake: (raw: SquadViewRaw | null, now: number) => void;
  togglePanel: () => void;
  startPoll: (cwd: string) => void;
  disband: () => void;
}

export const useSquad = create<SquadStore>((set, get) => ({
  active: null,
  view: null,
  envById: {},
  roleById: {},
  injection: {},
  wake: newWakeState(),
  poll: null,
  panelCollapsed: false,

  createSquad: async (cwd, name) => {
    const squadId = "sq-" + uuid().slice(0, 8);
    const pereToken = uuid();
    await squadCli(cwd, ["init", "--squad-id", squadId, "--pere-token", pereToken, "--cwd", cwd]);
    const home = (await wslHome()) || "/home";
    const env = squadEnv(home, cwd, pereToken);
    const id = useSessions.getState().createSession(cwd, name || "père");
    set((st) => ({
      active: { squadId, cwd },
      envById: { ...st.envById, [id]: env },
      roleById: { ...st.roleById, [id]: "pere" },
      injection: { ...st.injection, [id]: newInjectionEntry("pere", "pere", Date.now()) },
      wake: newWakeState(),
    }));
    get().startPoll(cwd);
  },

  addFils: async (name) => {
    const active = get().active;
    if (!active) return;
    const filsToken = uuid();
    const filsCount = (get().view?.members.filter((m) => m.role === "fils").length ?? 0) + 1;
    const filsName = name || `fils-${filsCount}`;
    await squadCli(active.cwd, [
      "add-member", "--member-token", filsToken, "--squad-id", active.squadId,
      "--role", "fils", "--name", filsName, "--cwd", active.cwd,
    ]);
    const home = (await wslHome()) || "/home";
    const env = squadEnv(home, active.cwd, filsToken);
    const id = useSessions.getState().createSession(active.cwd, filsName);
    set((st) => ({
      envById: { ...st.envById, [id]: env },
      roleById: { ...st.roleById, [id]: "fils" },
      injection: { ...st.injection, [id]: newInjectionEntry("fils", filsName, Date.now()) },
    }));
  },

  notifySpawn: (sessionId) =>
    set((st) => {
      const e = st.injection[sessionId];
      if (!e) return st;
      return { injection: { ...st.injection, [sessionId]: newInjectionEntry(e.role, e.memberName, Date.now()) } };
    }),

  markReady: (sessionId) =>
    set((st) => {
      const e = st.injection[sessionId];
      if (!e || e.phase !== "booting" || e.readyAt !== null) return st;
      return { injection: { ...st.injection, [sessionId]: { ...e, readyAt: Date.now() } } };
    }),

  manualInject: (sessionId) => {
    const st = get();
    const e = st.injection[sessionId];
    if (!e) return;
    const member = st.view?.members.find((m) => m.name === e.memberName);
    writeRole(sessionId, injectionPayload(e.role));
    set({
      injection: {
        ...st.injection,
        [sessionId]: {
          ...e,
          phase: "pending-ack",
          attempts: 1,
          lastInjectAt: Date.now(),
          baselineLastSeen: member ? member.lastSeen : null,
        },
      },
    });
  },

  runInjection: (raw, now) => {
    const sessions = useSessions.getState().sessions;
    const entries: Record<string, InjectionEntry> = {};
    for (const [id, e] of Object.entries(get().injection)) {
      if (sessions.some((s) => s.id === id)) entries[id] = e;
    }
    for (const a of planInjections(entries, toInjectionView(raw), now)) {
      const e = entries[a.id];
      if (a.type === "inject") {
        writeRole(a.id, a.payload);
        entries[a.id] = { ...e, phase: "pending-ack", attempts: e.attempts + 1, lastInjectAt: now, baselineLastSeen: a.baselineLastSeen };
      } else if (a.type === "wait-lots") {
        entries[a.id] = { ...e, phase: "waiting-lots" };
      } else if (a.type === "activate") {
        entries[a.id] = { ...e, phase: "active" };
      } else {
        entries[a.id] = { ...e, phase: "failed" };
      }
    }
    set({ injection: entries });
  },

  sendFeature: (text) => {
    if (!text.trim()) return;
    const st = get();
    const pereId = Object.keys(st.roleById).find((id) => st.roleById[id] === "pere");
    if (!pereId || st.injection[pereId]?.phase !== "active") return;
    writeRole(pereId, featurePayload(text));
  },

  runWake: (raw, now) => {
    if (!raw || !raw.squad) return;
    const st = get();
    const pereId = Object.keys(st.roleById).find((id) => st.roleById[id] === "pere");
    if (!pereId || st.injection[pereId]?.phase !== "active") return;
    const plan = planWake(st.wake, raw.tasks, now);
    if (plan.wake) writeRole(pereId, wakePayload(plan.wake));
    set({ wake: plan.state });
  },

  togglePanel: () => set((st) => ({ panelCollapsed: !st.panelCollapsed })),

  startPoll: (cwd) => {
    const existing = get().poll;
    if (existing) clearInterval(existing);
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const raw = await squadCli(cwd, ["view"]);
        set({ view: mapView(raw) });
        get().runInjection(raw, Date.now());
        get().runWake(raw, Date.now());
      } catch {
        /* transient: db locked / not yet created */
      } finally {
        inFlight = false;
      }
    };
    tick();
    set({ poll: setInterval(tick, 800) });
  },

  disband: () => {
    const p = get().poll;
    if (p) clearInterval(p);
    set({ active: null, view: null, poll: null, envById: {}, roleById: {}, injection: {}, wake: newWakeState(), panelCollapsed: false });
  },
}));

useSessions.subscribe((state) => {
  const st = useSquad.getState();
  if (!st.active) return;
  const memberIds = Object.keys(st.roleById);
  if (memberIds.length === 0) return;
  if (!state.sessions.some((s) => st.roleById[s.id])) st.disband();
});
