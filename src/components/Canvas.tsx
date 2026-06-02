import { useEffect, useState } from "react";
import { useSessions } from "../store/sessions";
import { groupByPath } from "../store/grouping";
import { SessionTile } from "./SessionTile";
import "./Canvas.css";

interface Props {
  onRequestClose: (id: string) => void;
}

export function Canvas({ onRequestClose }: Props) {
  const sessions = useSessions((s) => s.sessions);
  const focusId = useSessions((s) => s.focusId);
  const setFocus = useSessions((s) => s.setFocus);
  const removeFromCanvas = useSessions((s) => s.removeFromCanvas);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  const fsValid =
    fullscreenId !== null &&
    sessions.some((s) => s.id === fullscreenId && s.openInCanvas);
  const fs = fsValid ? fullscreenId : null;
  useEffect(() => {
    if (fullscreenId !== null && !fsValid) setFullscreenId(null);
  }, [fullscreenId, fsValid]);

  const groups = groupByPath(sessions);
  const anyOpen = sessions.some((s) => s.openInCanvas);

  return (
    <div className="vl-canvas">
      {!anyOpen && (
        <div className="vl-canvas-empty">
          Aucune session ouverte. Double-clique une session dans la barre latérale, ou crée-en une.
        </div>
      )}
      {groups.map((g) => {
        const openCount = g.sessions.filter((s) => s.openInCanvas).length;
        const hasFullscreen = g.sessions.some((s) => s.id === fs);
        const visible = fs ? hasFullscreen : openCount > 0;
        return (
          <div className="vl-zone" key={g.cwd} style={{ display: visible ? "flex" : "none" }}>
            <div className="vl-zone-label">
              <span className="tick" />
              <span className="path">{g.label}</span>
              <span className="count">{openCount}</span>
            </div>
            <div className="vl-zone-tiles">
              {g.sessions.map((s) => (
                <SessionTile
                  key={s.id}
                  session={s}
                  fullscreen={fs === s.id}
                  focused={focusId === s.id}
                  onFocus={() => setFocus(s.id)}
                  onToggleFullscreen={() => setFullscreenId(fs === s.id ? null : s.id)}
                  onRemove={() => removeFromCanvas(s.id)}
                  onRequestClose={() => onRequestClose(s.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
