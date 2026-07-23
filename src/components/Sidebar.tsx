import { useSessions } from "../store/sessions";
import { groupByPath } from "../store/grouping";
import "./Sidebar.css";

interface Props {
  onNewSession: () => void;
  onNewSquad: () => void;
}

export function Sidebar({ onNewSession, onNewSquad }: Props) {
  const sessions = useSessions((s) => s.sessions);
  const focusId = useSessions((s) => s.focusId);
  const setFocus = useSessions((s) => s.setFocus);
  const openInCanvas = useSessions((s) => s.openInCanvas);
  const activeWorkspaceId = useSessions((s) => s.activeWorkspaceId);
  const groups = groupByPath(sessions, activeWorkspaceId);

  return (
    <div className="vl-sidebar">
      <div className="vl-sidebar-scroll">
        {groups.length === 0 && <div className="vl-side-empty">Aucune session</div>}
        {groups.map((g) => (
          <div className="vl-side-group" key={g.cwd}>
            <div className="vl-side-grouplabel">{g.label}</div>
            {g.sessions.map((s) => (
              <div
                key={s.id}
                className={`vl-side-row${focusId === s.id ? " focused" : ""}`}
                onClick={() => setFocus(s.id)}
                onDoubleClick={() => openInCanvas(s.id)}
              >
                <span className={`vl-dot ${s.state}`} />
                <span className="vl-side-name">{s.name}</span>
                {s.kind === "claudex" && <span className="vl-badge-gpt">GPT</span>}
                {s.openInCanvas && <span className="vl-side-open">●</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <button className="vl-new" onClick={onNewSession}>+ Nouvelle session</button>
      <button className="vl-new vl-new-squad" onClick={onNewSquad}>⛓ Nouvelle escouade</button>
    </div>
  );
}
