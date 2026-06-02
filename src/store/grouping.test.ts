import { describe, it, expect } from "vitest";
import { groupByPath, prettyCwd } from "./grouping";
import type { Session } from "./sessions";

const s = (id: string, cwd: string): Session => ({
  id, name: id, cwd, status: "running", openInCanvas: true,
});

describe("groupByPath", () => {
  it("groups sessions by cwd, preserving creation order of groups", () => {
    const groups = groupByPath([
      s("a", "/home/v/dt/threadscrap"),
      s("b", "/home/v/dt/saas"),
      s("c", "/home/v/dt/threadscrap"),
    ]);
    expect(groups.map((g) => g.cwd)).toEqual([
      "/home/v/dt/threadscrap",
      "/home/v/dt/saas",
    ]);
    expect(groups[0].sessions.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("labels with ~ for home", () => {
    expect(prettyCwd("/home/virgile/dt/threadscrap")).toBe("~/dt/threadscrap");
    expect(prettyCwd("/srv/app")).toBe("/srv/app");
  });
});
