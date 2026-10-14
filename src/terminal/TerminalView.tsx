import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { createPty } from "./usePty";
import { createMarkerScanner } from "./readyScan";
import { registerTerm, unregisterTerm } from "./termRegistry";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useSquad } from "../store/squad";
import { useReload } from "../store/reload";
import { useSessions } from "../store/sessions";
import { detectAgentState, type DetectedState } from "./agentState";

interface Props {
  id: string;
  cwd: string;
  kind?: "claude" | "claudex" | "codex" | "omp" | "term";
  claudeSessionId?: string;
  visible: boolean;
  fullscreen: boolean;
}

const RESIZE_DEBOUNCE_MS = 80;
const MIN_FIT_WIDTH_PX = 80;
const STATE_PROBE_MS = 500;

export function TerminalView({ id, cwd, kind = "claude", claudeSessionId, visible, fullscreen }: Props) {
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
      theme: {
        background: "#0c0a13",
        foreground: "#cfc9e2",
        cursor: "#b69cff",
        selectionBackground: "rgba(159, 122, 255, 0.32)",
      },
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
    const host = hostRef.current;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) {
        writeText(term.getSelection()).catch((err) => console.error("clipboard writeText failed", err));
        term.clearSelection();
        return;
      }
      if (term.modes.mouseTrackingMode !== "none") return;
      readText()
        .then((t) => { if (t) term.paste(t); })
        .catch((err) => console.error("clipboard readText failed", err));
    };
    host.addEventListener("contextmenu", onContextMenu);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch (e) { console.warn("WebGL off", e); }
    fit.fit();
    if (!document.fonts.check('700 13px "Geist Mono"')) {
      document.fonts.load('700 13px "Geist Mono"').then(() => {
        if (!disposed) term.clearTextureAtlas();
      }).catch(() => {});
    }
    const squad = useSquad.getState();
    const env = squad.envById[id];
    let scan: ((bytes: Uint8Array) => void) | null = null;
    if (kind === "claude" && squad.injection[id]) {
      squad.notifySpawn(id);
      scan = createMarkerScanner(() => {
        scan = null;
        useSquad.getState().markReady(id);
      });
    } else if (kind !== "term" && useReload.getState().isClearing(id)) {
      scan = createMarkerScanner(() => {
        scan = null;
        useReload.getState().onReady(id);
      });
    }
    const pty = createPty(id, cwd, term.cols, term.rows, (bytes) => {
      term.write(bytes);
      if (scan) scan(bytes);
    }, kind, kind === "term" ? env : { ...env, VLAUDE_TILE_ID: id }, claudeSessionId);
    const dataSub = term.onData((d) => {
      const safe = d.replace(/\x1a/g, "");
      if (safe) pty.write(safe);
    });

    let title = "";
    const titleSub = term.onTitleChange((t) => { title = t; });
    const agentKind = kind === "term" ? null : kind;
    let lastDetected: DetectedState | null = null;
    const probe = agentKind === null ? null : setInterval(() => {
      const buf = term.buffer.active;
      const lines: string[] = [];
      for (let y = buf.baseY; y < buf.baseY + term.rows; y++) {
        lines.push(buf.getLine(y)?.translateToString(true) ?? "");
      }
      const detected = detectAgentState(agentKind, title, lines);
      if (detected === lastDetected) return;
      useSessions.getState().applyDetected(id, detected, lastDetected, document.hasFocus());
      lastDetected = detected;
    }, STATE_PROBE_MS);

    let lastCols = term.cols;
    let lastRows = term.rows;
    const applyResize = () => {
      const host = hostRef.current;
      if (!host || host.clientWidth === 0 || host.clientHeight === 0) return;
      if (host.clientWidth < MIN_FIT_WIDTH_PX) return;
      if (!host.checkVisibility({ visibilityProperty: true })) return;
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
      if (probe !== null) clearInterval(probe);
      ro.disconnect();
      host.removeEventListener("contextmenu", onContextMenu);
      dataSub.dispose();
      titleSub.dispose();
      unregisterTerm(id);
      pty.close();
      term.dispose();
      termRef.current = null;
      applyResizeRef.current = null;
    };
  }, [id, cwd, kind, claudeSessionId]);

  useEffect(() => {
    if (!visible || !termRef.current || !applyResizeRef.current) return;
    applyResizeRef.current();
    termRef.current.focus();
  }, [visible, fullscreen]);

  return <div className="vl-terminal-host" ref={hostRef} />;
}
