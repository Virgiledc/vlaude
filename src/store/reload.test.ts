import { describe, it, expect } from "vitest";
import {
  planReload,
  reloadPaths,
  buildHandoffPrompt,
  RECAP_TIMEOUT_MS,
  type ReloadEntry,
} from "./reload";

const recapping = (over?: Partial<ReloadEntry>): ReloadEntry => ({
  sessionId: "s1",
  handoffPath: "/h/.vlaude/handoffs/u.md",
  donePath: "/h/.vlaude/handoffs/u.done",
  startedAt: 1_000,
  phase: "recapping",
  handoff: null,
  error: null,
  ...over,
});

describe("reloadPaths", () => {
  it("derives .md and .done under ~/.vlaude/handoffs, trimming trailing slash", () => {
    expect(reloadPaths("/home/v/", "u-1")).toEqual({
      handoffPath: "/home/v/.vlaude/handoffs/u-1.md",
      donePath: "/home/v/.vlaude/handoffs/u-1.done",
    });
  });
});

describe("buildHandoffPrompt", () => {
  it("embeds both absolute paths", () => {
    const p = buildHandoffPrompt("/a/u.md", "/a/u.done");
    expect(p).toContain("/a/u.md");
    expect(p).toContain("/a/u.done");
  });
});

describe("planReload", () => {
  it("waits while the .done file is absent and the timeout is not reached", () => {
    expect(planReload(recapping(), { doneContent: null, handoffContent: null }, 1_000 + RECAP_TIMEOUT_MS - 1))
      .toEqual({ type: "wait" });
  });

  it("fails on timeout when .done never appears", () => {
    expect(planReload(recapping(), { doneContent: null, handoffContent: null }, 1_000 + RECAP_TIMEOUT_MS))
      .toMatchObject({ type: "fail" });
  });

  it("fails when .done exists but the handoff is empty", () => {
    expect(planReload(recapping(), { doneContent: "ok", handoffContent: "   " }, 2_000))
      .toMatchObject({ type: "fail" });
  });

  it("clears with the handoff once .done exists and the handoff is non-empty", () => {
    expect(planReload(recapping(), { doneContent: "ok", handoffContent: "Objectif: X" }, 2_000))
      .toEqual({ type: "clear", handoff: "Objectif: X" });
  });

  it("is a no-op outside the recapping phase", () => {
    expect(planReload(recapping({ phase: "clearing" }), { doneContent: "ok", handoffContent: "x" }, 2_000))
      .toEqual({ type: "wait" });
  });
});
