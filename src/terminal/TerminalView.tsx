import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { createPty } from "./usePty";

interface Props {
  id: string;
  cwd: string;
  visible: boolean;
}

export function TerminalView({ id, cwd, visible }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<ReturnType<typeof createPty> | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily: '"Geist Mono", ui-monospace, "JetBrains Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: "#0e0e11", foreground: "#c8c8cf" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try { term.loadAddon(new WebglAddon()); } catch (e) { console.warn("WebGL off", e); }
    fit.fit();
    const pty = createPty(id, cwd, term.cols, term.rows, (bytes) => term.write(bytes));
    const dataSub = term.onData((d) => pty.write(d));
    const ro = new ResizeObserver(() => { fit.fit(); pty.resize(term.cols, term.rows); });
    ro.observe(hostRef.current);
    termRef.current = term; fitRef.current = fit; ptyRef.current = pty;
    return () => {
      ro.disconnect(); dataSub.dispose(); pty.close(); term.dispose();
      termRef.current = null; fitRef.current = null; ptyRef.current = null;
    };
  }, [id, cwd]);

  useEffect(() => {
    if (!visible || !termRef.current || !fitRef.current || !ptyRef.current) return;
    fitRef.current.fit();
    ptyRef.current.resize(termRef.current.cols, termRef.current.rows);
    termRef.current.focus();
  }, [visible]);

  return <div className="vl-terminal-host" ref={hostRef} />;
}
