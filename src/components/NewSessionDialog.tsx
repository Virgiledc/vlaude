import { useEffect, useRef, useState } from "react";
import { wslHome, listWslDirs } from "../store/wslfs";
import type { SessionLaunchKind } from "../store/sessions";
import "./NewSessionDialog.css";

const RECENTS_KEY = "vlaude.recentCwds";
export const loadRecents = (): string[] => {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]"); } catch { return []; }
};
export const pushRecent = (cwd: string) => {
  const next = [cwd, ...loadRecents().filter((c) => c !== cwd)].slice(0, 8);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
};

const parentOf = (p: string) => {
  const up = p.replace(/\/+$/, "").replace(/\/[^/]+$/, "");
  return up === "" ? "/" : up;
};
const joinPath = (p: string, name: string) =>
  p === "/" ? "/" + name : p.replace(/\/+$/, "") + "/" + name;

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (cwd: string, name?: string, kind?: SessionLaunchKind) => void;
  mode?: "session" | "squad";
}

export function NewSessionDialog({ open, onClose, onCreate, mode = "session" }: Props) {
  const [cwd, setCwd] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SessionLaunchKind>("claude");
  const [recents, setRecents] = useState<string[]>([]);
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  const browse = (path: string) => {
    setCwd(path);
    const req = ++reqRef.current;
    setLoading(true);
    listWslDirs(path)
      .then((d) => { if (req === reqRef.current) setDirs(d); })
      .catch(() => { if (req === reqRef.current) setDirs([]); })
      .finally(() => { if (req === reqRef.current) setLoading(false); });
  };

  useEffect(() => {
    if (!open) return;
    setRecents(loadRecents());
    setName("");
    setKind("claude");
    wslHome().then((h) => browse(h || "/home")).catch(() => browse("/home"));
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const trimmed = cwd.trim();
    if (!trimmed) return;
    pushRecent(trimmed);
    onCreate(trimmed, name.trim() || undefined, kind);
    onClose();
  };

  return (
    <div className="vl-overlay" onMouseDown={onClose}>
      <div className="vl-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{mode === "squad" ? "Nouvelle escouade" : "Nouvelle session"}</h3>

        <label>Dossier WSL</label>
        <input
          className="vl-input"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="/home/virgile/dt/threadscrap"
        />

        <div className="vl-browser">
          <div className="vl-browser-bar">
            <button className="vl-up" onClick={() => browse(parentOf(cwd))} disabled={cwd === "/"}>
              ↑ Dossier parent
            </button>
            {loading && <span className="vl-loading">…</span>}
          </div>
          <div className="vl-browser-list">
            {dirs.length === 0 && !loading && <div className="vl-browser-empty">Aucun sous-dossier</div>}
            {dirs.map((d) => (
              <button key={d} className="vl-dir" onClick={() => browse(joinPath(cwd, d))}>
                <span className="vl-dir-ic">▸</span>{d}
              </button>
            ))}
          </div>
        </div>

        {recents.length > 0 && (
          <div className="vl-recents">
            {recents.map((r) => (
              <button key={r} className="vl-chip" onClick={() => browse(r)}>{r}</button>
            ))}
          </div>
        )}

        <label>Nom (optionnel)</label>
        <input
          className="vl-input"
          placeholder="session-N"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />

        {mode === "session" && (
          <>
            <label>Agent</label>
            <div className="vl-kind-toggle" role="radiogroup">
              <button
                type="button"
                className={kind === "claude" ? "active" : ""}
                onClick={() => setKind("claude")}
              >claude</button>
              <button
                type="button"
                className={kind === "claudex" ? "active" : ""}
                onClick={() => setKind("claudex")}
              >claudex · GPT</button>
            </div>
          </>
        )}

        <div className="vl-modal-actions">
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" onClick={submit}>{mode === "squad" ? "Créer l'escouade" : "Créer ici"}</button>
        </div>
      </div>
    </div>
  );
}
