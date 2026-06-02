import { TerminalView } from "../terminal/TerminalView";
import { prettyCwd } from "../store/grouping";
import type { Session } from "../store/sessions";
import "./SessionTile.css";

const cwdHue = (cwd: string): number => {
  let h = 0;
  for (let i = 0; i < cwd.length; i++) h = (h * 31 + cwd.charCodeAt(i)) % 360;
  return h;
};

interface Props {
  session: Session;
  focused: boolean;
  onFocus: () => void;
  onRemove: () => void;
  onRequestClose: () => void;
}

export function SessionTile({ session, focused, onFocus, onRemove, onRequestClose }: Props) {
  const hue = cwdHue(session.cwd);
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
          <button title="Enlever de la page" className="rem" onClick={(e) => { e.stopPropagation(); onRemove(); }}>◳</button>
          <button title="Fermer" className="cls" onClick={(e) => { e.stopPropagation(); onRequestClose(); }}>✕</button>
        </span>
      </div>
      <TerminalView id={session.id} cwd={session.cwd} visible={session.openInCanvas} />
    </div>
  );
}
