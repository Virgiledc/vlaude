import { describe, it, expect } from "vitest";
import { busTiles } from "./bus";
import type { Session } from "./sessions";

const session = (over: Partial<Session>): Session => ({
  id: "a",
  name: "session-1",
  cwd: "/r",
  workspaceId: "w",
  order: 0,
  state: "idle",
  openInCanvas: true,
  claudeSessionId: "u",
  kind: "claude",
  ...over,
});

describe("busTiles", () => {
  it("publishes live tiles with their routing fields only", () => {
    expect(busTiles([session({ id: "a", name: "codex-1", kind: "codex", state: "working" })])).toEqual([
      { id: "a", name: "codex-1", kind: "codex", state: "working", cwd: "/r" },
    ]);
  });

  it("drops paused and exited tiles, whose PTY cannot receive", () => {
    const out = busTiles([
      session({ id: "a" }),
      session({ id: "b", openInCanvas: false }),
      session({ id: "c", state: "exited" }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["a"]);
  });
});
