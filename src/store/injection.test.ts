import { describe, it, expect } from "vitest";
import {
  planInjections,
  newInjectionEntry,
  injectionPayload,
  featurePayload,
  READY_FALLBACK_MS,
  ACK_TIMEOUT_MS,
  MAX_ATTEMPTS,
  type InjectionEntry,
  type InjectionView,
} from "./injection";

const view = (over?: Partial<InjectionView>): InjectionView => ({
  members: [
    { name: "pere", lastSeen: 100 },
    { name: "fils-1", lastSeen: 100 },
  ],
  hasTodo: false,
  ...over,
});

const pere = (over?: Partial<InjectionEntry>): InjectionEntry => ({
  ...newInjectionEntry("pere", "pere", 1_000),
  ...over,
});

const fils = (over?: Partial<InjectionEntry>): InjectionEntry => ({
  ...newInjectionEntry("fils", "fils-1", 1_000),
  ...over,
});

describe("injectionPayload", () => {
  it("clears the input box with Ctrl-U before the slash command", () => {
    expect(injectionPayload("pere")).toBe("\x15/squad-pere\r");
    expect(injectionPayload("fils")).toBe("\x15/squad-fils\r");
  });
});

describe("featurePayload", () => {
  it("clears the line then wraps the feature in a bracketed paste before the final \\r", () => {
    expect(featurePayload("export CSV")).toBe("\x15\x1b[200~export CSV\x1b[201~\r");
  });

  it("normalizes newlines to \\r so claude inserts line breaks without submitting", () => {
    expect(featurePayload("a\nb\r\nc")).toBe("\x15\x1b[200~a\rb\rc\x1b[201~\r");
  });
});

describe("planInjections — booting", () => {
  it("does nothing before the ready marker or the fallback delay", () => {
    expect(planInjections({ a: pere() }, view(), 1_000 + READY_FALLBACK_MS - 1)).toEqual([]);
  });

  it("injects the pere as soon as it is ready, with the bus baseline", () => {
    const actions = planInjections({ a: pere({ readyAt: 3_000 }) }, view(), 3_800);
    expect(actions).toEqual([
      { id: "a", type: "inject", payload: "\x15/squad-pere\r", baselineLastSeen: 100 },
    ]);
  });

  it("injects the pere on fallback timeout when the marker never fired", () => {
    const actions = planInjections({ a: pere() }, view(), 1_000 + READY_FALLBACK_MS);
    expect(actions[0]).toMatchObject({ id: "a", type: "inject" });
  });

  it("waits for the bus view before injecting the pere, then fails if it never comes", () => {
    const e = pere({ readyAt: 3_000 });
    expect(planInjections({ a: e }, null, 3_800)).toEqual([]);
    expect(planInjections({ a: e }, null, 3_000 + ACK_TIMEOUT_MS)).toEqual([
      { id: "a", type: "fail" },
    ]);
  });

  it("parks a ready fils in waiting-lots instead of injecting", () => {
    expect(planInjections({ f: fils({ readyAt: 3_000 }) }, view(), 3_800)).toEqual([
      { id: "f", type: "wait-lots" },
    ]);
  });
});

describe("planInjections — waiting-lots", () => {
  it("holds the fils while no todo task exists", () => {
    const e = fils({ readyAt: 3_000, phase: "waiting-lots" });
    expect(planInjections({ f: e }, view({ hasTodo: false }), 60_000)).toEqual([]);
    expect(planInjections({ f: e }, null, 60_000)).toEqual([]);
  });

  it("injects the fils once a todo task appears", () => {
    const e = fils({ readyAt: 3_000, phase: "waiting-lots" });
    expect(planInjections({ f: e }, view({ hasTodo: true }), 60_000)).toEqual([
      { id: "f", type: "inject", payload: "\x15/squad-fils\r", baselineLastSeen: 100 },
    ]);
  });

  it("holds the fils when todo exists but its member is missing from the view", () => {
    const e = fils({ readyAt: 3_000, phase: "waiting-lots", memberName: "fils-9" });
    expect(planInjections({ f: e }, view({ hasTodo: true }), 60_000)).toEqual([]);
  });
});

describe("planInjections — pending-ack", () => {
  const pending = (over?: Partial<InjectionEntry>): InjectionEntry =>
    pere({ readyAt: 3_000, phase: "pending-ack", attempts: 1, lastInjectAt: 4_000, baselineLastSeen: 100, ...over });

  it("activates only on bus proof: last_seen strictly past the baseline", () => {
    const acked = view({ members: [{ name: "pere", lastSeen: 101 }] });
    expect(planInjections({ a: pending() }, acked, 10_000)).toEqual([{ id: "a", type: "activate" }]);
  });

  it("does not activate while last_seen sits at the baseline", () => {
    expect(planInjections({ a: pending() }, view(), 4_000 + ACK_TIMEOUT_MS - 1)).toEqual([]);
  });

  it("re-injects after the ack timeout while attempts remain", () => {
    const actions = planInjections({ a: pending() }, view(), 4_000 + ACK_TIMEOUT_MS);
    expect(actions).toEqual([
      { id: "a", type: "inject", payload: "\x15/squad-pere\r", baselineLastSeen: 100 },
    ]);
  });

  it("fails after MAX_ATTEMPTS without ack", () => {
    const e = pending({ attempts: MAX_ATTEMPTS });
    expect(planInjections({ a: e }, view(), 4_000 + ACK_TIMEOUT_MS)).toEqual([
      { id: "a", type: "fail" },
    ]);
  });

  it("fails on timeout when the member vanished from the view", () => {
    const e = pending({ memberName: "ghost" });
    expect(planInjections({ a: e }, view(), 4_000 + ACK_TIMEOUT_MS)).toEqual([
      { id: "a", type: "fail" },
    ]);
  });

  it("never activates from a null baseline (manual inject without view)", () => {
    const e = pending({ baselineLastSeen: null });
    expect(planInjections({ a: e }, view(), 5_000)).toEqual([]);
  });
});

describe("planInjections — terminal phases", () => {
  it("leaves active and dead-end failed entries alone", () => {
    const a = pere({ phase: "active" });
    const f = pere({ phase: "failed" });
    expect(planInjections({ a, f }, view({ hasTodo: true }), 999_999)).toEqual([]);
  });

  it("recovers a failed entry on late bus proof", () => {
    const e = pere({ phase: "failed", attempts: 3, lastInjectAt: 4_000, baselineLastSeen: 100 });
    expect(planInjections({ a: e }, view({ members: [{ name: "pere", lastSeen: 150 }] }), 999_999)).toEqual([
      { id: "a", type: "activate" },
    ]);
  });
});
