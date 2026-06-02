import { useSessions } from "../store/sessions";
import { groupByPath } from "../store/grouping";
import "./Sidebar.css";

interface Props {
  onNewSession: () => void;
}

export function Sidebar({ onNewSession }: Props) {
  const sessions = useSessions((s) => s.sessions);
  const focusId = useSessions((s) => s.focusId);
  const setFocus = useSessions((s) => s.setFocus);
  const openInCanvas = useSessions((s) => s.openInCanvas);
  const groups = groupByPath(sessions);

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
                <span className={`vl-dot ${s.status}`} />
                <span className="vl-side-name">{s.name}</span>
                {s.openInCanvas && <span className="vl-side-open">●</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <button className="vl-new" onClick={onNewSession}>+ Nouvelle session</button>
      <div className="vl-side-future">
        <div className="vl-future-label">À VENIR</div>
        <div className="vl-future-row">⌘ Macros</div>
        <div className="vl-future-row">⚙ Réglages</div>
      </div>
    </div>
  );
}
