import { useState } from "react";
import { useSessions } from "../store/sessions";
import { groupByPath, prettyCwd } from "../store/grouping";
import { STATE_LABEL, displayState, needsYou } from "../terminal/agentState";
import { KindLabel } from "./KindLabel";
import "./Sidebar.css";

interface Props {
  onNewSession: () => void;
  onNewSquad: () => void;
  onRequestCloseWorkspace: (id: string) => void;
}

export function Sidebar({ onNewSession, onNewSquad, onRequestCloseWorkspace }: Props) {
  const sessions = useSessions((s) => s.sessions);
  const workspaces = useSessions((s) => s.workspaces);
  const focusId = useSessions((s) => s.focusId);
  const activeWorkspaceId = useSessions((s) => s.activeWorkspaceId);
  const revealSession = useSessions((s) => s.revealSession);
  const switchWorkspace = useSessions((s) => s.switchWorkspace);
  const createWorkspace = useSessions((s) => s.createWorkspace);
  const renameWorkspace = useSessions((s) => s.renameWorkspace);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const pending = sessions.filter((s) => needsYou(displayState(s)));
  const blocked = pending.filter((s) => displayState(s) === "attention");
  const working = sessions.filter((s) => displayState(s) === "working").length;

  const goToNextPending = () => {
    const ordered = [...blocked, ...pending.filter((s) => displayState(s) === "waiting")];
    const target = ordered.find((s) => s.id !== focusId) ?? ordered[0];
    if (target) revealSession(target.id);
  };

  const commitRename = (id: string) => {
    renameWorkspace(id, draft);
    setEditingId(null);
  };

  return (
    <div className="vl-sidebar">
      <div className="vl-side-head">
        <span className="vl-brand">vlaude</span>
        {pending.length > 0 ? (
          <button
            className={`vl-side-pending${blocked.length > 0 ? " attention" : ""}`}
            title="Aller à la prochaine session qui t'attend"
            onClick={goToNextPending}
          >
            {pending.length} t'attend{pending.length > 1 ? "ent" : ""}
          </button>
        ) : (
          <span className="vl-side-calm">{working > 0 ? `${working} au travail` : "Tout est calme"}</span>
        )}
      </div>
      <div className="vl-sidebar-scroll">
        {workspaces.map((w, i) => {
          const list = groupByPath(sessions, w.id).flatMap((g) => g.sessions);
          return (
            <section key={w.id} className={`vl-side-ws${w.id === activeWorkspaceId ? " active" : ""}`}>
              <div
                className="vl-side-wshead"
                title={i < 9 ? `Ctrl+${i + 1}. Double-clic pour renommer.` : "Double-clic pour renommer."}
                onClick={() => switchWorkspace(w.id)}
                onDoubleClick={() => { setEditingId(w.id); setDraft(w.name); }}
              >
                <span className="vl-side-wsnum">{i + 1}</span>
                {editingId === w.id ? (
                  <input
                    className="vl-side-wsedit"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitRename(w.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(w.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="vl-side-wsname">{w.name}</span>
                )}
                <span className="vl-side-wscount">{list.length}</span>
                {workspaces.length > 1 && (
                  <button
                    className="vl-side-wsclose"
                    title="Fermer le workspace"
                    onClick={(e) => { e.stopPropagation(); onRequestCloseWorkspace(w.id); }}
                  >
                    ×
                  </button>
                )}
              </div>
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
                        <KindLabel kind={s.kind} />
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
        <button className="vl-side-addws" onClick={() => createWorkspace()}>+ Nouveau workspace</button>
      </div>
      <div className="vl-side-foot">
        <button className="vl-act primary" title="Ctrl+Maj+N" onClick={onNewSession}>
          <span>Nouvelle session</span>
        </button>
        <button className="vl-act" onClick={onNewSquad}>
          <span>Nouvelle escouade</span>
        </button>
      </div>
    </div>
  );
}
