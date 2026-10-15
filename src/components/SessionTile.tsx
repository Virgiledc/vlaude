import { useEffect, useState } from "react";
import { TerminalView } from "../terminal/TerminalView";
import { prettyCwd } from "../store/grouping";
import { useSessions, type Session } from "../store/sessions";
import { useSquad } from "../store/squad";
import { useReload } from "../store/reload";
import type { InjectionPhase } from "../store/injection";
import { STATE_LABEL, needsYou } from "../terminal/agentState";
import { invoke } from "@tauri-apps/api/core";
import { KindLabel } from "./KindLabel";
import "./SessionTile.css";

const encoder = new TextEncoder();

const sendCommand = (id: string, command: string): void => {
  const data = Array.from(encoder.encode(command + "\r"));
  invoke("pty_write", { id, data }).catch((e) => console.error("pty_write failed", e));
};

const roleTitle = (role: "pere" | "fils", phase: InjectionPhase | undefined): string => {
  if (phase === "active") return `Rôle /squad-${role} confirmé par le bus`;
  if (phase === "pending-ack") return `/squad-${role} envoyé — en attente de confirmation du bus`;
  if (phase === "waiting-lots") return "Fils prêt — /squad-fils partira dès que le père aura posté des lots";
  if (phase === "failed") return `Injection /squad-${role} sans confirmation — cliquer pour réinjecter`;
  return `Injection auto de /squad-${role} au démarrage de claude — cliquer pour forcer`;
};

const phaseClass = (phase: InjectionPhase | undefined): string => {
  if (phase === "active") return " active";
  if (phase === "failed") return " failed";
  if (phase === "pending-ack" || phase === "waiting-lots") return " pending";
  return "";
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
  const view = useSessions((s) => s.views[session.id] ?? "claude");
  const toggleView = useSessions((s) => s.toggleView);
  const role = useSquad((s) => s.roleById[session.id]);
  const injectionPhase = useSquad((s) => s.injection[session.id]?.phase);
  const manualInject = useSquad((s) => s.manualInject);
  const reloadPhase = useReload((s) => s.entries[session.id]?.phase);
  const startReload = useReload((s) => s.startReload);
  const revealTick = useSessions((s) => (s.revealId === session.id ? s.revealTick : 0));
  const [termOpened, setTermOpened] = useState(false);
  useEffect(() => {
    if (view === "term") setTermOpened(true);
  }, [view]);
  return (
    <div
      className={`vl-tile st-${session.state}${focused ? " focused" : ""}`}
      onMouseDown={onFocus}
    >
      <div className="vl-tile-bar">
        <span className={`vl-dot ${session.state}`} />
        <span className="vl-tile-name">{session.name}</span>
        <KindLabel kind={session.kind} />
        <span className="vl-tile-dir">{prettyCwd(session.cwd)}</span>
        {needsYou(session.state) && <span className="vl-tile-state">{STATE_LABEL[session.state]}</span>}
        <span className="vl-tile-actions vl-no-drag">
          {role && (
            <button
              title={roleTitle(role, injectionPhase)}
              className={`cmd${phaseClass(injectionPhase)}`}
              onClick={(e) => { e.stopPropagation(); manualInject(session.id); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><line x1="8" x2="16" y1="12" y2="12" /></svg>
            </button>
          )}
          <button title="/clear" className="cmd" onClick={(e) => { e.stopPropagation(); sendCommand(session.id, "/clear"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>
          </button>
          <button
            title="reload — récap → session vierge"
            className={`cmd${reloadPhase === "recapping" || reloadPhase === "clearing" ? " pending" : reloadPhase === "error" ? " failed" : ""}`}
            onClick={(e) => { e.stopPropagation(); startReload(session.id); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
          </button>
          <button title={view === "term" ? "Revenir à Claude (Ctrl+T)" : "Terminal (Ctrl+T)"} className={`cmd${view === "term" ? " active" : ""}`} onClick={(e) => { e.stopPropagation(); toggleView(session.id); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg>
          </button>
          <button title="Booster ce claude : /effort ultracode (sans lien avec l'escouade)" className="cmd" onClick={(e) => { e.stopPropagation(); sendCommand(session.id, "/effort ultracode"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>
          </button>
          <button title={fullscreen ? "Quitter le plein écran (Ctrl+E / Échap)" : "Plein écran (Ctrl+E)"} className={`cmd${fullscreen ? " active" : ""}`} onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </button>
          <button title="Mettre en pause (retirer de l'écran)" className="cmd" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/></svg>
          </button>
          <button title="Fermer" className="cmd cls" onClick={(e) => { e.stopPropagation(); onRequestClose(); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </span>
      </div>
      {revealTick > 0 && <span key={revealTick} className="vl-tile-flash" />}
      <div className="vl-tile-body">
        <div className="vl-term-layer" data-active={view === "claude"}>
          <TerminalView id={session.id} cwd={session.cwd} kind={session.kind} claudeSessionId={session.claudeSessionId} visible={session.openInCanvas && view === "claude"} fullscreen={fullscreen} />
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
