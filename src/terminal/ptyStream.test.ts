import { describe, expect, it } from "vitest";
import { decodeFrames } from "./ptyStream";

describe("decodeFrames", () => {
  it("splits the frames encoded by pty/frame.rs", () => {
    const buf = new Uint8Array([2, 0, 97, 98, 3, 0, 0, 0, 120, 121, 122, 1, 0, 99, 0, 0, 0, 0]);
    const out: [string, string][] = [];
    decodeFrames(buf, (id, bytes) => out.push([id, new TextDecoder().decode(bytes)]));
    expect(out).toEqual([["ab", "xyz"], ["c", ""]]);
  });

  it("reads lengths relative to a sliced view", () => {
    const backing = new Uint8Array([9, 9, 1, 0, 120, 2, 0, 0, 0, 255, 0]);
    const out: [string, number[]][] = [];
    decodeFrames(backing.subarray(2), (id, bytes) => out.push([id, Array.from(bytes)]));
    expect(out).toEqual([["x", [255, 0]]]);
  });

  it("keeps multi-byte ids intact", () => {
    const id = new TextEncoder().encode("é");
    const buf = new Uint8Array([id.length, 0, ...id, 1, 0, 0, 0, 65]);
    const out: string[] = [];
    decodeFrames(buf, (sid) => out.push(sid));
    expect(out).toEqual(["é"]);
  });
});
