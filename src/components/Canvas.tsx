import { Fragment, useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useSessions } from "../store/sessions";
import { groupByPath } from "../store/grouping";
import { SessionTile } from "./SessionTile";
import "./Canvas.css";

interface Props {
  onRequestClose: (id: string) => void;
}

export function Canvas({ onRequestClose }: Props) {
  const workspaces = useSessions((s) => s.workspaces);
  const activeWorkspaceId = useSessions((s) => s.activeWorkspaceId);
  return (
    <div className="vl-canvas-root">
      {workspaces.map((w) => (
        <div
          key={w.id}
          className="vl-workspace-layer"
          style={{ display: w.id === activeWorkspaceId ? "block" : "none" }}
        >
          <WorkspaceCanvas workspaceId={w.id} onRequestClose={onRequestClose} />
        </div>
      ))}
    </div>
  );
}

function WorkspaceCanvas({ workspaceId, onRequestClose }: { workspaceId: string } & Props) {
  const sessions = useSessions((s) => s.sessions);
  const focusId = useSessions((s) => s.focusId);
  const setFocus = useSessions((s) => s.setFocus);
  const removeFromCanvas = useSessions((s) => s.removeFromCanvas);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  const groups = groupByPath(sessions, workspaceId)
    .map((g) => ({ ...g, sessions: g.sessions.filter((s) => s.openInCanvas) }))
    .filter((g) => g.sessions.length > 0);

  const fsValid =
    fullscreenId !== null && sessions.some((s) => s.id === fullscreenId && s.openInCanvas);
  const fs = fsValid ? fullscreenId : null;
  useEffect(() => {
    if (fullscreenId !== null && !fsValid) setFullscreenId(null);
  }, [fullscreenId, fsValid]);

  if (groups.length === 0) {
    return (
      <div className="vl-canvas vl-canvas-empty-wrap">
        <div className="vl-canvas-empty">
          Aucune session ouverte. Double-clique une session dans la barre latérale, ou crée-en une.
        </div>
      </div>
    );
  }

  return (
    <PanelGroup direction="vertical" className="vl-canvas" autoSaveId={`vl-zones-${workspaceId}`}>
      {groups.map((g, zi) => (
        <Fragment key={g.cwd}>
          {zi > 0 && <PanelResizeHandle className="vl-rh vl-rh-v" />}
          <Panel id={`zone-${g.cwd}`} order={zi} minSize={12} className="vl-zone-panel">
            <div className="vl-zone">
              <div className="vl-zone-label">
                <span className="tick" />
                <span className="path">{g.label}</span>
                <span className="count">{g.sessions.length}</span>
              </div>
              <PanelGroup
                direction="horizontal"
                className="vl-zone-tiles"
                autoSaveId={`vl-tiles-${workspaceId}-${g.cwd}`}
              >
                {g.sessions.map((s, ti) => (
                  <Fragment key={s.id}>
                    {ti > 0 && <PanelResizeHandle className="vl-rh vl-rh-h" />}
                    <Panel id={`tile-${s.id}`} order={ti} minSize={15}>
                      <SessionTile
                        session={s}
                        fullscreen={fs === s.id}
                        focused={focusId === s.id}
                        onFocus={() => setFocus(s.id)}
                        onToggleFullscreen={() => setFullscreenId(fs === s.id ? null : s.id)}
                        onRemove={() => removeFromCanvas(s.id)}
                        onRequestClose={() => onRequestClose(s.id)}
                      />
                    </Panel>
                  </Fragment>
                ))}
              </PanelGroup>
            </div>
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  );
}
