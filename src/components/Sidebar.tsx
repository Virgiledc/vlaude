import { useSessions } from "../store/sessions";
import { groupByPath, prettyCwd } from "../store/grouping";
import { STATE_LABEL, displayState, needsYou, rollupState } from "../terminal/agentState";
import "./Sidebar.css";

interface Props {
  onNewSession: () => void;
  onNewSquad: () => void;
}

export function Sidebar({ onNewSession, onNewSquad }: Props) {
  const sessions = useSessions((s) => s.sessions);
  const workspaces = useSessions((s) => s.workspaces);
  const focusId = useSessions((s) => s.focusId);
  const activeWorkspaceId = useSessions((s) => s.activeWorkspaceId);
  const revealSession = useSessions((s) => s.revealSession);
  const switchWorkspace = useSessions((s) => s.switchWorkspace);

  const pending = sessions.filter((s) => needsYou(displayState(s)));
  const blocked = pending.filter((s) => displayState(s) === "attention");
  const working = sessions.filter((s) => displayState(s) === "working").length;

  const goToNextPending = () => {
    const ordered = [...blocked, ...pending.filter((s) => displayState(s) === "waiting")];
    const target = ordered.find((s) => s.id !== focusId) ?? ordered[0];
    if (target) revealSession(target.id);
  };

  return (
    <div className="vl-sidebar">
      <div className="vl-side-head">
        <span className="vl-brand">Vlaude</span>
        {pending.length > 0 ? (
          <button
            className={`vl-side-pending ${blocked.length > 0 ? "attention" : "waiting"}`}
            title="Aller à la prochaine session qui t'attend"
            onClick={goToNextPending}
          >
            <span className={`vl-dot ${blocked.length > 0 ? "attention" : "waiting"}`} />
            {pending.length} t'attend{pending.length > 1 ? "ent" : ""}
          </button>
        ) : (
          <span className="vl-side-calm">{working > 0 ? `${working} en cours` : "Tout est calme"}</span>
        )}
      </div>
      <div className="vl-sidebar-scroll">
        {workspaces.map((w) => {
          const list = groupByPath(sessions, w.id).flatMap((g) => g.sessions);
          const roll = rollupState(list.map(displayState));
          return (
            <section key={w.id} className={`vl-side-ws${w.id === activeWorkspaceId ? " active" : ""}`}>
              <button className="vl-side-wshead" onClick={() => switchWorkspace(w.id)}>
                <span className="vl-side-wsname">{w.name}</span>
                {roll && roll !== "idle" && roll !== "exited" && <span className={`vl-dot ${roll}`} />}
                <span className="vl-side-wscount">{list.length}</span>
              </button>
              {list.length === 0 && <div className="vl-side-empty">Aucune session</div>}
              {list.map((s) => {
                const state = displayState(s);
                return (
                  <div
                    key={s.id}
                    className={`vl-side-row ${state}${focusId === s.id ? " focused" : ""}`}
                    onClick={() => revealSession(s.id)}
                  >
                    <span className={`vl-dot ${state}`} />
                    <div className="vl-side-main">
                      <div className="vl-side-line">
                        <span className="vl-side-name">{s.name}</span>
                        {s.kind === "claudex" && <span className="vl-badge-gpt">GPT</span>}
                        {s.kind === "codex" && <span className="vl-badge-gpt">CODEX</span>}
                        {s.kind === "omp" && <span className="vl-badge-gpt">OMP</span>}
                      </div>
                      <div className="vl-side-sub">
                        <span className="vl-side-status">{STATE_LABEL[state]}</span>
                        <span className="vl-side-cwd">{prettyCwd(s.cwd)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <button className="vl-new" onClick={onNewSession}>+ Nouvelle session</button>
      <button className="vl-new vl-new-squad" onClick={onNewSquad}>⛓ Nouvelle escouade</button>
    </div>
  );
}
