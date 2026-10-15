import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { ITheme } from "@xterm/xterm";

export interface OmarchyTheme {
  name: string | null;
  colors: Record<string, string>;
  terminal: Record<string, string>;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

const CSS_VARS: Record<string, string> = {
  background: "--c-bg",
  dark_background: "--c-bg-dark",
  darker_background: "--c-bg-darker",
  lighter_background: "--c-bg-lighter",
  foreground: "--c-fg",
  dark_foreground: "--c-fg-dark",
  bright_foreground: "--c-fg-bright",
  accent: "--c-accent",
  selection: "--c-selection",
  muted: "--c-muted",
  active_border_color: "--c-active-border",
  active_tab_background: "--c-glow",
  red: "--c-red",
  yellow: "--c-yellow",
  green: "--c-green",
};

export function cssVarsFromColors(colors: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, cssVar] of Object.entries(CSS_VARS)) {
    const v = colors[key];
    out[cssVar] = v && HEX.test(v) ? v : null;
  }
  return out;
}

const LUMON_TERMINAL: Record<string, string> = {
  foreground: "#d6e2ee",
  background: "#16242d",
  cursor: "#f2fcff",
  selection_background: "#243d56",
  selection_foreground: "#f2fcff",
  color0: "#16242d", color1: "#4d86b0", color2: "#5e95bc", color3: "#6fa4c9",
  color4: "#6fb8e3", color5: "#8bc9eb", color6: "#b4e4f6", color7: "#d6e2ee",
  color8: "#304860", color9: "#73a6cb", color10: "#86b7d8", color11: "#9dcae5",
  color12: "#f2fcff", color13: "#b1d8ee", color14: "#d1eef8", color15: "#f2fcff",
};

const ANSI: (keyof ITheme)[] = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

export function xtermThemeFrom(theme: OmarchyTheme | null): ITheme {
  const src = theme && HEX.test(theme.terminal.color0 ?? "") ? theme.terminal : LUMON_TERMINAL;
  const pick = (key: string) => (HEX.test(src[key] ?? "") ? src[key] : LUMON_TERMINAL[key]);
  const out: Record<string, string> = {
    background: pick("background"),
    foreground: pick("foreground"),
    cursor: pick("cursor"),
    cursorAccent: pick("background"),
    selectionBackground: pick("selection_background"),
    selectionForeground: pick("selection_foreground"),
  };
  ANSI.forEach((k, i) => { out[k] = pick(`color${i}`); });
  return out as ITheme;
}

interface ThemeState {
  theme: OmarchyTheme | null;
  xterm: ITheme;
  refresh: () => Promise<void>;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: null,
  xterm: xtermThemeFrom(null),
  refresh: async () => {
    const theme = await invoke<OmarchyTheme | null>("omarchy_theme").catch(() => null);
    if (!theme || JSON.stringify(theme) === JSON.stringify(get().theme)) return;
    const root = document.documentElement.style;
    for (const [cssVar, value] of Object.entries(cssVarsFromColors(theme.colors))) {
      if (value) root.setProperty(cssVar, value);
      else root.removeProperty(cssVar);
    }
    document.documentElement.dataset.mode = theme.colors.mode === "light" ? "light" : "dark";
    set({ theme, xterm: xtermThemeFrom(theme) });
  },
}));
