import { describe, expect, it } from "vitest";
import { groupByPath } from "./grouping";
import type { Session } from "./sessions";

const mk = (over: Partial<Session>): Session => ({
  id: over.id ?? "x",
  name: over.name ?? "n",
  cwd: over.cwd ?? "/home/v/a",
  workspaceId: over.workspaceId ?? "ws-1",
  order: over.order ?? 0,
  state: "working",
  openInCanvas: true,
});

describe("groupByPath", () => {
  it("only includes sessions of the given workspace", () => {
    const groups = groupByPath(
      [mk({ id: "1", cwd: "/home/v/a", workspaceId: "ws-1" }), mk({ id: "2", cwd: "/home/v/a", workspaceId: "ws-2" })],
      "ws-1"
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["1"]);
  });

  it("sorts sessions within a zone by order", () => {
    const groups = groupByPath(
      [mk({ id: "a", order: 2 }), mk({ id: "b", order: 0 }), mk({ id: "c", order: 1 })],
      "ws-1"
    );
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps first-seen cwd order between zones and prettifies the label", () => {
    const groups = groupByPath(
      [mk({ id: "1", cwd: "/home/v/b" }), mk({ id: "2", cwd: "/home/v/a" })],
      "ws-1"
    );
    expect(groups.map((g) => g.cwd)).toEqual(["/home/v/b", "/home/v/a"]);
    expect(groups[0].label).toBe("~/b");
  });
});
