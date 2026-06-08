import { describe, it, expect } from "vitest";
import {
  planWake,
  newWakeState,
  wakePayload,
  WAKE_MIN_GAP_MS,
  WAKE_REMIND_AFTER_MS,
  type WakeTask,
} from "./wake";

const task = (id: number, status: WakeTask["status"]): WakeTask => ({ id, status });

describe("wakePayload", () => {
  it("clears the prompt line and submits a single-line [Vlaude] nudge", () => {
    const p = wakePayload([2]);
    expect(p.startsWith("\x15[Vlaude] Lot soumis : #2")).toBe(true);
    expect(p).toContain("squad verify --task 2");
    expect(p.endsWith("\r")).toBe(true);
    expect(p).not.toContain("\n");
  });

  it("groups several lots into one message", () => {
    const p = wakePayload([2, 5]);
    expect(p).toContain("Lots soumis : #2, #5");
    expect(p).toContain("squad verify --task <id>");
  });
});

describe("planWake", () => {
  it("stays silent while nothing is submitted", () => {
    const r = planWake(newWakeState(), [task(1, "todo"), task(2, "claimed"), task(3, "verified")], 1_000);
    expect(r.wake).toBeNull();
    expect(planWake(r.state, [], 2_000).wake).toBeNull();
  });

  it("wakes once on the claimed-to-submitted transition, then stays silent", () => {
    let r = planWake(newWakeState(), [task(1, "claimed")], 1_000);
    r = planWake(r.state, [task(1, "submitted")], 2_000);
    expect(r.wake).toEqual([1]);
    r = planWake(r.state, [task(1, "submitted")], 3_000);
    expect(r.wake).toBeNull();
    r = planWake(r.state, [task(1, "submitted")], 4_000);
    expect(r.wake).toBeNull();
  });

  it("treats a task already submitted at first sight as a fresh submission", () => {
    expect(planWake(newWakeState(), [task(1, "submitted")], 1_000).wake).toEqual([1]);
  });

  it("groups simultaneous transitions into a single wake", () => {
    let r = planWake(newWakeState(), [task(1, "claimed"), task(3, "claimed")], 1_000);
    r = planWake(r.state, [task(1, "submitted"), task(3, "submitted")], 2_000);
    expect(r.wake).toEqual([1, 3]);
  });

  it("holds a submission landing inside the min gap and flushes it after", () => {
    let r = planWake(newWakeState(), [task(1, "submitted")], 1_000);
    expect(r.wake).toEqual([1]);
    r = planWake(r.state, [task(1, "submitted"), task(2, "submitted")], 1_800);
    expect(r.wake).toBeNull();
    r = planWake(r.state, [task(1, "submitted"), task(2, "submitted")], 1_000 + WAKE_MIN_GAP_MS);
    expect(r.wake).toEqual([2]);
  });

  it("drops a held nudge when the lot is verified before the flush", () => {
    let r = planWake(newWakeState(), [task(1, "submitted")], 1_000);
    r = planWake(r.state, [task(1, "submitted"), task(2, "submitted")], 1_800);
    expect(r.wake).toBeNull();
    r = planWake(r.state, [task(1, "submitted"), task(2, "verified")], 1_000 + WAKE_MIN_GAP_MS);
    expect(r.wake).toBeNull();
  });

  it("re-wakes a task that leaves submitted and comes back", () => {
    let r = planWake(newWakeState(), [task(1, "submitted")], 1_000);
    r = planWake(r.state, [task(1, "verified")], 30_000);
    expect(r.wake).toBeNull();
    r = planWake(r.state, [task(1, "submitted")], 60_000);
    expect(r.wake).toEqual([1]);
  });

  it("reminds exactly once when a lot stays submitted past the reminder delay", () => {
    let r = planWake(newWakeState(), [task(1, "submitted")], 1_000);
    r = planWake(r.state, [task(1, "submitted")], 1_000 + WAKE_REMIND_AFTER_MS - 1);
    expect(r.wake).toBeNull();
    r = planWake(r.state, [task(1, "submitted")], 1_000 + WAKE_REMIND_AFTER_MS);
    expect(r.wake).toEqual([1]);
    r = planWake(r.state, [task(1, "submitted")], 1_000 + 3 * WAKE_REMIND_AFTER_MS);
    expect(r.wake).toBeNull();
  });

  it("a fresh state re-notifies reused task ids after a squad is recreated", () => {
    expect(planWake(newWakeState(), [task(1, "submitted")], 1_000).wake).toEqual([1]);
    expect(planWake(newWakeState(), [task(1, "submitted")], 2_000).wake).toEqual([1]);
  });
});
