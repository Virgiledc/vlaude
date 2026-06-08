import { describe, it, expect, vi } from "vitest";
import { createMarkerScanner, READY_MARKER } from "./readyScan";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("createMarkerScanner", () => {
  it("fires when the prompt marker arrives in one chunk", () => {
    const onReady = vi.fn();
    const scan = createMarkerScanner(onReady);
    scan(enc("\x1b[2B❯ \x1b[7m \x1b[27m"));
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("fires when the marker is split across chunks", () => {
    const onReady = vi.fn();
    const scan = createMarkerScanner(onReady);
    scan(READY_MARKER.slice(0, 3));
    expect(onReady).not.toHaveBeenCalled();
    scan(READY_MARKER.slice(3));
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("does not fire on banner output without the prompt", () => {
    const onReady = vi.fn();
    const scan = createMarkerScanner(onReady);
    scan(enc("\x1b[38;5;174m ▐▛███ Claude Code v2.1.165"));
    scan(enc("\x1b[?2004h\x1b[?1004h\x1b[?2031h"));
    expect(onReady).not.toHaveBeenCalled();
  });

  it("recovers from an aborted partial match", () => {
    const onReady = vi.fn();
    const scan = createMarkerScanner(onReady);
    scan(new Uint8Array([0xe2, 0x9d, 0x41]));
    scan(READY_MARKER);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("fires only once then ignores everything", () => {
    const onReady = vi.fn();
    const scan = createMarkerScanner(onReady);
    scan(READY_MARKER);
    scan(READY_MARKER);
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
