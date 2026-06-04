import { useEffect, useState } from "react";
import { TerminalView } from "../terminal/TerminalView";
import { prettyCwd } from "../store/grouping";
import { useSessions, type Session } from "../store/sessions";
import { invoke } from "@tauri-apps/api/core";
import "./SessionTile.css";

const cwdHue = (cwd: string): number => {
  let h = 0;
  for (let i = 0; i < cwd.length; i++) h = (h * 31 + cwd.charCodeAt(i)) % 360;
  return h;
};

const encoder = new TextEncoder();

const sendCommand = (id: string, command: string): void => {
  const data = Array.from(encoder.encode(command + "\r"));
  invoke("pty_write", { id, data }).catch((e) => console.error("pty_write failed", e));
};

interface Props {
  session: Session;
  focused: boolean;
  fullscreen: boolean;
  onFocus: () => void;
  onRemove: () => void;
  onRequestClose: () => void;
  onToggleFullscreen: () => void;
}

export function SessionTile({ session, focused, fullscreen, onFocus, onRemove, onRequestClose, onToggleFullscreen }: Props) {
  const hue = cwdHue(session.cwd);
  const view = useSessions((s) => s.views[session.id] ?? "claude");
  const toggleView = useSessions((s) => s.toggleView);
  const [termOpened, setTermOpened] = useState(false);
  useEffect(() => {
    if (view === "term") setTermOpened(true);
  }, [view]);
  return (
    <div
      className={`vl-tile${focused ? " focused" : ""}`}
      onMouseDown={onFocus}
      style={{ "--dir-color": `hsl(${hue} 55% 62%)` } as React.CSSProperties}
    >
      <div className="vl-tile-bar">
        <span className="vl-dir-dot" />
        <span className={`vl-dot ${session.state}`} />
        <span className="vl-tile-name">{session.name}</span>
        <span className="vl-tile-dir">{prettyCwd(session.cwd)}</span>
        <span className="vl-tile-actions vl-no-drag">
          <button title="/clear" className="cmd" onClick={(e) => { e.stopPropagation(); sendCommand(session.id, "/clear"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>
          </button>
          <button title={view === "term" ? "Revenir à Claude (Ctrl+T)" : "Terminal (Ctrl+T)"} className={`cmd${view === "term" ? " active" : ""}`} onClick={(e) => { e.stopPropagation(); toggleView(session.id); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg>
          </button>
          <button title="/effort ultracode" className="cmd" onClick={(e) => { e.stopPropagation(); sendCommand(session.id, "/effort ultracode"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>
          </button>
          <button title={fullscreen ? "Quitter le plein écran (Ctrl+E / Échap)" : "Plein écran (Ctrl+E)"} className={`full${fullscreen ? " active" : ""}`} onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }}>⛶</button>
          <button title="Enlever de la page" className="rem" onClick={(e) => { e.stopPropagation(); onRemove(); }}>◳</button>
          <button title="Fermer" className="cls" onClick={(e) => { e.stopPropagation(); onRequestClose(); }}>✕</button>
        </span>
      </div>
      <div className="vl-tile-body">
        <div className="vl-term-layer" data-active={view === "claude"}>
          <TerminalView id={session.id} cwd={session.cwd} kind="claude" visible={session.openInCanvas && view === "claude"} fullscreen={fullscreen} />
        </div>
        {termOpened && (
          <div className="vl-term-layer" data-active={view === "term"}>
            <TerminalView id={`${session.id}:term`} cwd={session.cwd} kind="term" visible={session.openInCanvas && view === "term"} fullscreen={fullscreen} />
          </div>
        )}
      </div>
    </div>
  );
}
