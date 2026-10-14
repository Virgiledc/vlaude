import { describe, expect, it } from "vitest";
import {
  addRecent,
  fuzzyMatch,
  parseRecents,
  recencyBucket,
  RECENTS_MAX,
  searchDirs,
  timeAgo,
  tildify,
} from "./dirsearch";

const NOW = new Date(2026, 8, 24, 15, 0).getTime();
const H = 3600_000;

describe("parseRecents", () => {
  it("migrates the legacy string[] format keeping its order", () => {
    expect(parseRecents(JSON.stringify(["/a", "/b"]))).toEqual([
      { path: "/a", at: 0 },
      { path: "/b", at: 0 },
    ]);
  });

  it("reads the object format", () => {
    expect(parseRecents(JSON.stringify([{ path: "/a", at: 5 }]))).toEqual([{ path: "/a", at: 5 }]);
  });

  it("drops garbage, empties and duplicates", () => {
    expect(parseRecents(JSON.stringify(["/a", 3, null, "", { at: 1 }, { path: "/a", at: 9 }]))).toEqual([
      { path: "/a", at: 0 },
    ]);
  });

  it("returns [] on invalid JSON, null or non-array", () => {
    expect(parseRecents("{nope")).toEqual([]);
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
  });
});

describe("addRecent", () => {
  it("moves an existing path to the front with the new timestamp", () => {
    const list = [{ path: "/a", at: 1 }, { path: "/b", at: 2 }];
    expect(addRecent(list, "/b", 10)).toEqual([{ path: "/b", at: 10 }, { path: "/a", at: 1 }]);
  });

  it("caps the list", () => {
    const list = Array.from({ length: RECENTS_MAX }, (_, i) => ({ path: `/p${i}`, at: i }));
    const next = addRecent(list, "/new", 99);
    expect(next).toHaveLength(RECENTS_MAX);
    expect(next[0].path).toBe("/new");
    expect(next.some((r) => r.path === `/p${RECENTS_MAX - 1}`)).toBe(false);
  });
});

describe("fuzzyMatch", () => {
  it("is case-insensitive and ignores spaces", () => {
    expect(fuzzyMatch("VLA", "/home/v/dt/vlaude")).not.toBeNull();
    expect(fuzzyMatch("dt vla", "/home/v/dt/vlaude")).not.toBeNull();
  });

  it("returns null when not a subsequence", () => {
    expect(fuzzyMatch("xyz", "/home/v/dt/vlaude")).toBeNull();
    expect(fuzzyMatch("", "/home/v")).toBeNull();
  });

  it("highlights a contiguous hit in the folder name", () => {
    const path = "/home/virgile/dt/Vlaude";
    expect(fuzzyMatch("vlau", path)!.hits).toEqual([17, 18, 19, 20]);
  });

  it("returns hits in ascending order for scattered matches", () => {
    const hits = fuzzyMatch("dtvl", "/home/virgile/dt/Vlaude")!.hits;
    expect(hits).toEqual([...hits].sort((a, b) => a - b));
    expect(hits).toHaveLength(4);
  });

  it("ranks an exact folder name above a deeper partial match", () => {
    const exact = fuzzyMatch("jv", "/home/v/dt/jv")!.score;
    const deeper = fuzzyMatch("jv", "/home/v/dt/java/views/junk")!.score;
    expect(exact).toBeGreaterThan(deeper);
  });

  it("ranks a folder-name prefix above a match in the parent path", () => {
    const name = fuzzyMatch("dash", "/home/v/tabobine/dashboard")!.score;
    const parent = fuzzyMatch("dash", "/home/v/dashboard/src/api")!.score;
    expect(name).toBeGreaterThan(parent);
  });
});

describe("searchDirs", () => {
  it("merges recents and index without duplicates, recents boosted", () => {
    const recents = [{ path: "/h/dt/saasboost", at: NOW }];
    const index = ["/h/dt/saasboost", "/h/old/saasboost"];
    const res = searchDirs("saasboost", recents, index);
    expect(res.map((r) => r.path)).toEqual(["/h/dt/saasboost", "/h/old/saasboost"]);
    expect(res[0].recent).toEqual(recents[0]);
    expect(res[1].recent).toBeUndefined();
  });

  it("respects the limit", () => {
    const index = Array.from({ length: 100 }, (_, i) => `/h/proj${i}`);
    expect(searchDirs("proj", [], index, 10)).toHaveLength(10);
  });
});

describe("recencyBucket", () => {
  it("splits today / this week / older", () => {
    expect(recencyBucket(NOW - 2 * H, NOW)).toBe("Aujourd'hui");
    expect(recencyBucket(NOW - 3 * 24 * H, NOW)).toBe("Cette semaine");
    expect(recencyBucket(NOW - 20 * 24 * H, NOW)).toBe("Plus ancien");
    expect(recencyBucket(0, NOW)).toBe("Plus ancien");
  });
});

describe("timeAgo", () => {
  it("formats compact relative times", () => {
    expect(timeAgo(0, NOW)).toBe("");
    expect(timeAgo(NOW - 10_000, NOW)).toBe("à l'instant");
    expect(timeAgo(NOW - 5 * 60_000, NOW)).toBe("5 min");
    expect(timeAgo(NOW - 3 * H, NOW)).toBe("3 h");
    expect(timeAgo(NOW - 30 * H, NOW)).toBe("hier");
    expect(timeAgo(NOW - 4 * 24 * H, NOW)).toBe("4 j");
    expect(timeAgo(NOW - 15 * 24 * H, NOW)).toBe("2 sem");
    expect(timeAgo(NOW - 70 * 24 * H, NOW)).toBe("2 mois");
  });
});

describe("tildify", () => {
  it("replaces the home prefix only on a path boundary", () => {
    expect(tildify("/home/v/dt", "/home/v")).toBe("~/dt");
    expect(tildify("/home/v", "/home/v")).toBe("~");
    expect(tildify("/home/vx/dt", "/home/v")).toBe("/home/vx/dt");
    expect(tildify("/home/v/dt", "")).toBe("/home/v/dt");
  });
});
