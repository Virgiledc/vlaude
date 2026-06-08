export type InjectionPhase = "booting" | "waiting-lots" | "pending-ack" | "active" | "failed";

export interface InjectionEntry {
  role: "pere" | "fils";
  memberName: string;
  spawnAt: number;
  readyAt: number | null;
  phase: InjectionPhase;
  attempts: number;
  lastInjectAt: number | null;
  baselineLastSeen: number | null;
}

export interface InjectionView {
  members: { name: string; lastSeen: number }[];
  hasTodo: boolean;
}

export type InjectionAction =
  | { id: string; type: "inject"; payload: string; baselineLastSeen: number | null }
  | { id: string; type: "wait-lots" }
  | { id: string; type: "activate" }
  | { id: string; type: "fail" };

export const READY_FALLBACK_MS = 30_000;
export const ACK_TIMEOUT_MS = 40_000;
export const MAX_ATTEMPTS = 3;

export const injectionPayload = (role: "pere" | "fils"): string => `\x15/squad-${role}\r`;

export const featurePayload = (text: string): string =>
  `\x15\x1b[200~${text.replace(/\r\n|\r|\n/g, "\r")}\x1b[201~\r`;

export const newInjectionEntry = (
  role: "pere" | "fils",
  memberName: string,
  now: number
): InjectionEntry => ({
  role,
  memberName,
  spawnAt: now,
  readyAt: null,
  phase: "booting",
  attempts: 0,
  lastInjectAt: null,
  baselineLastSeen: null,
});

const isReady = (e: InjectionEntry, now: number): boolean =>
  e.readyAt !== null || now - e.spawnAt >= READY_FALLBACK_MS;

const readyTime = (e: InjectionEntry): number => e.readyAt ?? e.spawnAt + READY_FALLBACK_MS;

const inject = (
  id: string,
  e: InjectionEntry,
  member: { lastSeen: number } | null
): InjectionAction => ({
  id,
  type: "inject",
  payload: injectionPayload(e.role),
  baselineLastSeen: member ? member.lastSeen : null,
});

export function planInjections(
  entries: Record<string, InjectionEntry>,
  view: InjectionView | null,
  now: number
): InjectionAction[] {
  const actions: InjectionAction[] = [];
  for (const [id, e] of Object.entries(entries)) {
    const member = view?.members.find((m) => m.name === e.memberName) ?? null;
    if (e.phase === "booting") {
      if (!isReady(e, now)) continue;
      if (e.role === "fils") actions.push({ id, type: "wait-lots" });
      else if (member) actions.push(inject(id, e, member));
      else if (now - readyTime(e) >= ACK_TIMEOUT_MS) actions.push({ id, type: "fail" });
    } else if (e.phase === "waiting-lots") {
      if (view?.hasTodo && member) actions.push(inject(id, e, member));
    } else if (e.phase === "pending-ack") {
      if (member && e.baselineLastSeen !== null && member.lastSeen > e.baselineLastSeen) {
        actions.push({ id, type: "activate" });
      } else if (e.lastInjectAt !== null && now - e.lastInjectAt >= ACK_TIMEOUT_MS) {
        if (e.attempts >= MAX_ATTEMPTS || !member) actions.push({ id, type: "fail" });
        else actions.push(inject(id, e, member));
      }
    } else if (e.phase === "failed") {
      if (member && e.baselineLastSeen !== null && member.lastSeen > e.baselineLastSeen) {
        actions.push({ id, type: "activate" });
      }
    }
  }
  return actions;
}
