import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { createPty } from "./usePty";
import { registerTerm, unregisterTerm } from "./termRegistry";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

interface Props {
  id: string;
  cwd: string;
  kind?: "claude" | "term";
  visible: boolean;
  fullscreen: boolean;
}

const RESIZE_DEBOUNCE_MS = 80;

export function TerminalView({ id, cwd, kind = "claude", visible, fullscreen }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const applyResizeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    let disposed = false;
    const term = new Terminal({
      fontFamily: '"Geist Mono", ui-monospace, "JetBrains Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      ignoreBracketedPasteMode: kind === "term",
      theme: { background: "#0e0e11", foreground: "#c8c8cf" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (!e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return true;
      if (e.code === "KeyC") {
        if (!term.hasSelection()) return true;
        e.preventDefault();
        const sel = term.getSelection();
        if (sel) writeText(sel).catch((err) => console.error("clipboard writeText failed", err));
        term.clearSelection();
        return false;
      }
      if (e.code === "KeyV") {
        e.preventDefault();
        readText()
          .then((t) => { if (t) term.paste(t); })
          .catch((err) => console.error("clipboard readText failed", err));
        return false;
      }
      return true;
    });
    try { term.loadAddon(new WebglAddon()); } catch (e) { console.warn("WebGL off", e); }
    fit.fit();
    document.fonts.load('700 13px "Geist Mono"').then(() => {
      if (!disposed) term.clearTextureAtlas();
    }).catch(() => {});
    const pty = createPty(id, cwd, term.cols, term.rows, (bytes) => term.write(bytes), kind);
    const dataSub = term.onData((d) => pty.write(d));

    let lastCols = term.cols;
    let lastRows = term.rows;
    const applyResize = () => {
      fit.fit();
      if (term.cols === lastCols && term.rows === lastRows) return;
      lastCols = term.cols;
      lastRows = term.rows;
      pty.resize(term.cols, term.rows);
    };
    applyResizeRef.current = applyResize;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; applyResize(); }, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(hostRef.current);

    termRef.current = term;
    registerTerm(id, term);
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      ro.disconnect();
      dataSub.dispose();
      unregisterTerm(id);
      pty.close();
      term.dispose();
      termRef.current = null;
      applyResizeRef.current = null;
    };
  }, [id, cwd, kind]);

  useEffect(() => {
    if (!visible || !termRef.current || !applyResizeRef.current) return;
    applyResizeRef.current();
    termRef.current.focus();
  }, [visible, fullscreen]);

  return <div className="vl-terminal-host" ref={hostRef} />;
}
