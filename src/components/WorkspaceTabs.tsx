import { useState } from "react";
import { useSessions } from "../store/sessions";
import "./WorkspaceTabs.css";

interface Props {
  onRequestCloseWorkspace: (id: string) => void;
}

export function WorkspaceTabs({ onRequestCloseWorkspace }: Props) {
  const workspaces = useSessions((s) => s.workspaces);
  const activeId = useSessions((s) => s.activeWorkspaceId);
  const switchWorkspace = useSessions((s) => s.switchWorkspace);
  const createWorkspace = useSessions((s) => s.createWorkspace);
  const renameWorkspace = useSessions((s) => s.renameWorkspace);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <div className="vl-tabs">
      {workspaces.map((w) => (
        <div
          key={w.id}
          className={`vl-tab${w.id === activeId ? " active" : ""}`}
          onClick={() => switchWorkspace(w.id)}
          onDoubleClick={() => { setEditingId(w.id); setDraft(w.name); }}
        >
          {editingId === w.id ? (
            <input
              className="vl-tab-edit"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { renameWorkspace(w.id, draft); setEditingId(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { renameWorkspace(w.id, draft); setEditingId(null); }
                if (e.key === "Escape") setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="vl-tab-name">{w.name}</span>
              {workspaces.length > 1 && (
                <button
                  className="vl-tab-close"
                  title="Fermer le workspace"
                  onClick={(e) => { e.stopPropagation(); onRequestCloseWorkspace(w.id); }}
                >
                  ✕
                </button>
              )}
            </>
          )}
        </div>
      ))}
      <button className="vl-tab-new" title="Nouveau workspace" onClick={() => createWorkspace()}>
        +
      </button>
    </div>
  );
}
