import { describe, expect, it } from "vitest";
import { cssVarsFromColors, xtermThemeFrom, type OmarchyTheme } from "./theme";

describe("cssVarsFromColors", () => {
  it("maps Omarchy color keys to CSS variables", () => {
    const vars = cssVarsFromColors({ background: "#16242d", accent: "#8bc9eb", bright_foreground: "#f2fcff" });
    expect(vars["--c-bg"]).toBe("#16242d");
    expect(vars["--c-accent"]).toBe("#8bc9eb");
    expect(vars["--c-fg-bright"]).toBe("#f2fcff");
  });

  it("returns null for missing or malformed values so stylesheet fallbacks apply", () => {
    const vars = cssVarsFromColors({ accent: "red; background: url(x)", muted: "#30486" });
    expect(vars["--c-accent"]).toBeNull();
    expect(vars["--c-muted"]).toBeNull();
    expect(vars["--c-active-border"]).toBeNull();
  });
});

describe("xtermThemeFrom", () => {
  const terminal: Record<string, string> = {
    foreground: "#a9b1d6", background: "#1a1b26", cursor: "#c0caf5",
    selection_background: "#7aa2f7", selection_foreground: "#c0caf5",
  };
  for (let i = 0; i < 16; i++) terminal[`color${i}`] = `#0000${i.toString(16).padStart(2, "0")}`;
  const theme: OmarchyTheme = { name: "tokyo-night", colors: {}, terminal };

  it("maps kitty color0..15 onto the 16 ANSI slots in order", () => {
    const x = xtermThemeFrom(theme);
    expect(x.black).toBe("#000000");
    expect(x.red).toBe("#000001");
    expect(x.white).toBe("#000007");
    expect(x.brightBlack).toBe("#000008");
    expect(x.brightWhite).toBe("#00000f");
    expect(x.background).toBe("#1a1b26");
    expect(x.cursorAccent).toBe("#1a1b26");
    expect(x.selectionBackground).toBe("#7aa2f7");
  });

  it("falls back to the Lumon palette without a theme", () => {
    const x = xtermThemeFrom(null);
    expect(x.background).toBe("#16242d");
    expect(x.blue).toBe("#6fb8e3");
    expect(x.brightWhite).toBe("#f2fcff");
  });

  it("falls back per key when a value is malformed", () => {
    const x = xtermThemeFrom({ ...theme, terminal: { ...terminal, cursor: "nope" } });
    expect(x.cursor).toBe("#f2fcff");
    expect(x.foreground).toBe("#a9b1d6");
  });
});
