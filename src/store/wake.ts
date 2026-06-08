import type { SquadTaskStatus } from "../components/SquadPanel";

export interface WakeTask {
  id: number;
  status: SquadTaskStatus;
}

export interface WakeState {
  statusById: Record<number, SquadTaskStatus>;
  pendingIds: number[];
  notifiedAt: Record<number, number>;
  remindedIds: number[];
  lastWakeAt: number | null;
}

export interface WakePlan {
  state: WakeState;
  wake: number[] | null;
}

export const WAKE_MIN_GAP_MS = 15_000;
export const WAKE_REMIND_AFTER_MS = 300_000;

export const newWakeState = (): WakeState => ({
  statusById: {},
  pendingIds: [],
  notifiedAt: {},
  remindedIds: [],
  lastWakeAt: null,
});

export const wakePayload = (ids: number[]): string => {
  const lots = ids.map((n) => `#${n}`).join(", ");
  const head = ids.length === 1 ? "Lot soumis" : "Lots soumis";
  const verify = ids.length === 1 ? `squad verify --task ${ids[0]}` : "squad verify --task <id>";
  return `\x15[Vlaude] ${head} : ${lots}. Vérifie avec squad list, lance build+tests sur le périmètre, puis ${verify} si c'est bon (sinon squad msg au fils).\r`;
};

export function planWake(state: WakeState, tasks: WakeTask[], now: number): WakePlan {
  const submitted = new Set(tasks.filter((t) => t.status === "submitted").map((t) => t.id));
  const fresh = tasks
    .filter((t) => t.status === "submitted" && state.statusById[t.id] !== "submitted")
    .map((t) => t.id);
  const notifiedAt: Record<number, number> = {};
  for (const [id, at] of Object.entries(state.notifiedAt)) {
    if (submitted.has(Number(id))) notifiedAt[Number(id)] = at;
  }
  const remindedIds = state.remindedIds.filter((id) => submitted.has(id));
  const due = Object.entries(notifiedAt)
    .filter(([id, at]) => now - at >= WAKE_REMIND_AFTER_MS && !remindedIds.includes(Number(id)))
    .map(([id]) => Number(id));
  const pending = [...new Set([...state.pendingIds.filter((id) => submitted.has(id)), ...fresh, ...due])]
    .sort((a, b) => a - b);
  const statusById: Record<number, SquadTaskStatus> = {};
  for (const t of tasks) statusById[t.id] = t.status;
  if (pending.length === 0) {
    return { state: { statusById, pendingIds: [], notifiedAt, remindedIds, lastWakeAt: state.lastWakeAt }, wake: null };
  }
  if (state.lastWakeAt !== null && now - state.lastWakeAt < WAKE_MIN_GAP_MS) {
    return { state: { statusById, pendingIds: pending, notifiedAt, remindedIds, lastWakeAt: state.lastWakeAt }, wake: null };
  }
  for (const id of pending) {
    if (notifiedAt[id] === undefined) notifiedAt[id] = now;
  }
  return {
    state: { statusById, pendingIds: [], notifiedAt, remindedIds: [...new Set([...remindedIds, ...due])], lastWakeAt: now },
    wake: pending,
  };
}
