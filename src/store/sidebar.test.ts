import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "./sidebar";

describe("clampSidebarWidth", () => {
  it("clamps below the minimum", () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_WIDTH_MIN);
  });

  it("clamps above the maximum", () => {
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_WIDTH_MAX);
  });

  it("rounds an in-range value", () => {
    expect(clampSidebarWidth(223.6)).toBe(224);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(Infinity)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });
});
