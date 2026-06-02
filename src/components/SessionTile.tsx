import { TerminalView } from "../terminal/TerminalView";
import type { Session } from "../store/sessions";
import "./SessionTile.css";

interface Props {
  session: Session;
  fullscreen: boolean;
  focused: boolean;
  onFocus: () => void;
  onToggleFullscreen: () => void;
  onRemove: () => void;
  onRequestClose: () => void;
}

export function SessionTile({
  session, fullscreen, focused, onFocus, onToggleFullscreen, onRemove, onRequestClose,
}: Props) {
  return (
    <div
      className={`vl-tile${focused ? " focused" : ""}${fullscreen ? " fullscreen" : ""}`}
      onMouseDown={onFocus}
      style={{ display: session.openInCanvas ? "flex" : "none" }}
    >
      <div className="vl-tile-bar">
        <span className={`vl-dot ${session.state}`} />
        <span className="vl-tile-name">{session.name}</span>
        <span className="vl-tile-actions">
          <button title="Plein écran" className="full" onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }}>⛶</button>
          <button title="Enlever de la page" className="rem" onClick={(e) => { e.stopPropagation(); onRemove(); }}>◳</button>
          <button title="Fermer" className="cls" onClick={(e) => { e.stopPropagation(); onRequestClose(); }}>✕</button>
        </span>
      </div>
      <TerminalView id={session.id} cwd={session.cwd} visible={session.openInCanvas} />
    </div>
  );
}
