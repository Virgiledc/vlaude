import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { homeDir, listDirs, indexDirs } from "../store/files";
import type { SessionLaunchKind } from "../store/sessions";
import {
  addRecent, parseRecents, recencyBucket, searchDirs, timeAgo, tildify, type Recent,
} from "../store/dirsearch";
import "./NewSessionDialog.css";

const RECENTS_KEY = "vlaude.recentCwds";
export const loadRecents = (): Recent[] => parseRecents(localStorage.getItem(RECENTS_KEY));
const saveRecents = (list: Recent[]) => localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
export const pushRecent = (cwd: string) => saveRecents(addRecent(loadRecents(), cwd, Date.now()));

const parentOf = (p: string) => {
  const up = p.replace(/\/+$/, "").replace(/\/[^/]+$/, "");
  return up === "" ? "/" : up;
};
const joinPath = (p: string, name: string) =>
  p === "/" ? "/" + name : p.replace(/\/+$/, "") + "/" + name;

interface Row { path: string; hits: number[]; recent?: Recent }

const COUNTS = [1, 2, 3, 4, 5, 6];

function Marked({ text, start, hits }: { text: string; start: number; hits: Set<number> }) {
  if (!hits.size) return <>{text}</>;
  const parts: { s: string; on: boolean }[] = [];
  text.split("").forEach((c, i) => {
    const on = hits.has(start + i);
    const last = parts[parts.length - 1];
    if (last && last.on === on) last.s += c;
    else parts.push({ s: c, on });
  });
  return <>{parts.map((p, i) => (p.on ? <mark key={i}>{p.s}</mark> : <span key={i}>{p.s}</span>))}</>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (cwd: string, name?: string, kind?: SessionLaunchKind, count?: number) => void;
  mode?: "session" | "squad";
}

export function NewSessionDialog({ open, onClose, onCreate, mode = "session" }: Props) {
  const [cwd, setCwd] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SessionLaunchKind>("claude");
  const [count, setCount] = useState(1);
  const [recents, setRecents] = useState<Recent[]>([]);
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [home, setHome] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"recents" | "browse">("recents");
  const [index, setIndex] = useState<string[]>([]);
  const [indexing, setIndexing] = useState(false);
  const reqRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const browse = (path: string) => {
    setCwd(path);
    const req = ++reqRef.current;
    setLoading(true);
    listDirs(path)
      .then((d) => { if (req === reqRef.current) setDirs(d); })
      .catch(() => { if (req === reqRef.current) setDirs([]); })
      .finally(() => { if (req === reqRef.current) setLoading(false); });
  };

  useEffect(() => {
    if (!open) return;
    const rs = loadRecents();
    setRecents(rs);
    setQuery("");
    setName("");
    setKind("claude");
    setCount(1);
    setView(rs.length ? "recents" : "browse");
    if (rs.length) setCwd(rs[0].path);
    homeDir().catch(() => "").then((h) => {
      const root = h || "/home";
      setHome(h);
      if (!rs.length) browse(root);
    });
    setIndexing(true);
    indexDirs().then(setIndex).catch(() => {}).finally(() => setIndexing(false));
  }, [open]);

  const searching = query.trim() !== "";
  const typed = query.trim();
  const literal = typed.startsWith("/") ? typed
    : typed === "~" || typed.startsWith("~/") ? (home || "~") + typed.slice(1)
    : null;
  const showList = searching || view === "recents";
  const rows: Row[] = useMemo(
    () => (searching
      ? searchDirs(query, recents, index)
      : recents.map((r) => ({ path: r.path, hits: [], recent: r }))),
    [searching, query, recents, index],
  );

  const active = rows.findIndex((r) => r.path === cwd);

  useEffect(() => {
    if (literal) setCwd(literal);
    else if (searching && rows[0]) setCwd(rows[0].path);
  }, [rows, literal]);

  useEffect(() => {
    listRef.current?.querySelector(".vl-row.active")?.scrollIntoView({ block: "nearest" });
  }, [cwd]);

  if (!open) return null;

  const create = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    pushRecent(trimmed);
    onCreate(trimmed, name.trim() || undefined, kind, mode === "session" ? count : 1);
    onClose();
  };
  const submit = () => create(cwd);

  const pick = (i: number) => {
    if (rows[i]) setCwd(rows[i].path);
  };

  const forget = (path: string) => {
    const next = recents.filter((r) => r.path !== path);
    setRecents(next);
    saveRecents(next);
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && showList) {
      e.preventDefault();
      pick(Math.max(0, Math.min(rows.length - 1, active + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (searching && !literal && rows.length === 0) return;
      submit();
    }
  };

  const now = Date.now();

  const renderRow = (r: Row, i: number) => {
    const hits = new Set(r.hits);
    const cut = r.path.lastIndexOf("/");
    const leaf = r.path.slice(cut + 1);
    const parent = cut > 0 ? r.path.slice(0, cut) : cut === 0 && leaf ? "/" : "";
    const shown = tildify(parent, home);
    const bucket = !searching && r.recent ? recencyBucket(r.recent.at, now) : null;
    const prev = i > 0 && bucket ? recencyBucket(rows[i - 1].recent?.at ?? 0, now) : null;
    return (
      <Fragment key={r.path}>
        {bucket && bucket !== prev && <div className="vl-group">{bucket}</div>}
        <div
          role="option"
          aria-selected={i === active}
          data-i={i}
          className={"vl-row" + (i === active ? " active" : "")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => pick(i)}
          onDoubleClick={() => create(r.path)}
          title={r.path}
        >
          <span className={"vl-row-mark" + (searching && r.recent ? " recent" : "")} />
          <span className="vl-row-name">
            {leaf ? <Marked text={leaf} start={cut + 1} hits={hits} /> : "/"}
          </span>
          <span className="vl-row-path">
            {shown.startsWith("~")
              ? <>~<Marked text={shown.slice(1)} start={home.length} hits={hits} /></>
              : <Marked text={shown} start={0} hits={hits} />}
          </span>
          <span className="vl-row-meta">{r.recent ? timeAgo(r.recent.at, now) : ""}</span>
          {!searching && (
            <button
              className="vl-row-x"
              title="Retirer des récents"
              onClick={(e) => { e.stopPropagation(); forget(r.path); }}
              onDoubleClick={(e) => e.stopPropagation()}
            >×</button>
          )}
        </div>
      </Fragment>
    );
  };

  return (
    <div className="vl-overlay" onMouseDown={onClose}>
      <div className="vl-modal vl-picker" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{mode === "squad" ? "Nouvelle escouade" : "Nouvelle session"}</h3>

        <div className="vl-search">
          <svg className="vl-search-ic" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            autoFocus
            spellCheck={false}
            className="vl-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Chercher un projet…  ou taper /chemin"
          />
          {indexing && <span className="vl-search-busy" title="Indexation des dossiers…" />}
        </div>

        <div className="vl-panel">
          <div className="vl-panel-bar">
            {searching ? (
              <span className="vl-panel-title">
                {rows.length ? `${rows.length}${rows.length === 60 ? "+" : ""} dossier${rows.length > 1 ? "s" : ""}` : "Aucun résultat"}
              </span>
            ) : (
              <div className="vl-picker-tabs" role="tablist">
                <button className={view === "recents" ? "active" : ""} onClick={() => setView("recents")}>
                  Récents{recents.length > 0 && <span className="vl-tab-n">{recents.length}</span>}
                </button>
                <button className={view === "browse" ? "active" : ""} onClick={() => { setView("browse"); browse(cwd || home || "/home"); }}>
                  Parcourir
                </button>
              </div>
            )}
            {showList ? (
              <span className="vl-keys"><kbd>↑</kbd><kbd>↓</kbd> choisir <kbd>↵</kbd> créer</span>
            ) : (
              <span className="vl-browse-tools">
                {loading && <span className="vl-loading">…</span>}
                <button className="vl-up" onClick={() => browse(parentOf(cwd))} disabled={cwd === "/"}>↑ Parent</button>
              </span>
            )}
          </div>

          {showList ? (
            <div className="vl-list" role="listbox" ref={listRef}>
              {rows.length === 0 && (
                <div className="vl-empty">
                  {!searching ? "Aucun projet récent. Cherche un dossier ou parcours."
                    : indexing && index.length === 0 ? "Indexation des dossiers…"
                    : "Aucun dossier ne correspond"}
                </div>
              )}
              {rows.map(renderRow)}
            </div>
          ) : (
            <div className="vl-list">
              {dirs.length === 0 && !loading && <div className="vl-empty">Aucun sous-dossier</div>}
              {dirs.map((d) => (
                <button key={d} className="vl-dir" onClick={() => browse(joinPath(cwd, d))}>
                  <span className="vl-dir-ic">▸</span>{d}
                </button>
              ))}
            </div>
          )}
        </div>

        <label>Dossier</label>
        <input
          className="vl-input"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="/home/virgile/dt/threadscrap"
        />

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
              >claudex (gpt)</button>
              <button
                type="button"
                className={kind === "codex" ? "active" : ""}
                onClick={() => setKind("codex")}
              >codex</button>
              <button
                type="button"
                className={kind === "omp" ? "active" : ""}
                onClick={() => setKind("omp")}
              >omp</button>
            </div>

            <label>Instances</label>
            <div className="vl-kind-toggle vl-count-toggle" role="radiogroup">
              {COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={count === n ? "active" : ""}
                  onClick={() => setCount(n)}
                >{n}</button>
              ))}
            </div>
          </>
        )}

        <div className="vl-modal-actions">
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" onClick={submit}>{mode === "squad" ? "Créer l'escouade" : count > 1 ? `Créer ${count} sessions` : "Créer ici"}</button>
        </div>
      </div>
    </div>
  );
}
