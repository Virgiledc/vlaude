import { useEffect, useMemo } from "react";
import ReactGridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useSessions } from "../store/sessions";
import { SessionTile } from "./SessionTile";
import "./Canvas.css";

const { WidthProvider } = ReactGridLayout;
type Layout = ReactGridLayout.Layout;

const Grid = WidthProvider(ReactGridLayout);
const COLS = 12;
const ROW_HEIGHT = 36;

interface Props {
  onRequestClose: (id: string) => void;
}

export function Canvas({ onRequestClose }: Props) {
  const workspaces = useSessions((s) => s.workspaces);
  const activeWorkspaceId = useSessions((s) => s.activeWorkspaceId);

  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    return () => clearTimeout(t);
  }, [activeWorkspaceId]);

  return (
    <div className="vl-canvas-root">
      {workspaces.map((w) => (
        <div
          key={w.id}
          className="vl-workspace-layer"
          style={{ display: w.id === activeWorkspaceId ? "block" : "none" }}
        >
          <WorkspaceGrid workspaceId={w.id} onRequestClose={onRequestClose} />
        </div>
      ))}
    </div>
  );
}

function WorkspaceGrid({ workspaceId, onRequestClose }: { workspaceId: string } & Props) {
  const sessions = useSessions((s) => s.sessions);
  const focusId = useSessions((s) => s.focusId);
  const setFocus = useSessions((s) => s.setFocus);
  const removeFromCanvas = useSessions((s) => s.removeFromCanvas);
  const storedLayout = useSessions((s) => s.layouts[workspaceId]);
  const setLayout = useSessions((s) => s.setLayout);

  const visible = useMemo(
    () => sessions.filter((s) => s.workspaceId === workspaceId && s.openInCanvas),
    [sessions, workspaceId]
  );

  const layout: Layout[] = useMemo(() => {
    const byId = new Map((storedLayout ?? []).map((it) => [it.i, it]));
    return visible.map((s, idx) => {
      const found = byId.get(s.id);
      if (found) return { ...found };
      return { i: s.id, x: (idx * 6) % COLS, y: Math.floor(idx / 2) * 8, w: 6, h: 8 };
    });
  }, [visible, storedLayout]);

  if (visible.length === 0) {
    return (
      <div className="vl-canvas vl-canvas-empty">
        Aucune session ouverte. Double-clique une session dans la barre latérale, ou crée-en une.
      </div>
    );
  }

  return (
    <div className="vl-canvas">
      <Grid
        className="vl-grid"
        layout={layout}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={[10, 10]}
        draggableHandle=".vl-tile-bar"
        draggableCancel=".vl-no-drag"
        resizeHandles={["se"]}
        onLayoutChange={(l: Layout[]) =>
          setLayout(
            workspaceId,
            l.map((it) => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h }))
          )
        }
      >
        {visible.map((s) => (
          <div key={s.id} className="vl-grid-item">
            <SessionTile
              session={s}
              focused={focusId === s.id}
              onFocus={() => setFocus(s.id)}
              onRemove={() => removeFromCanvas(s.id)}
              onRequestClose={() => onRequestClose(s.id)}
            />
          </div>
        ))}
      </Grid>
    </div>
  );
}
