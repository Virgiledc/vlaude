import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessions } from "../store/sessions";
import { listClaudePlugins, loadFavorites, saveFavorites, type PluginItem } from "../store/plugins";
import "./PluginsPanel.css";

interface HoverState {
  item: PluginItem;
  top: number;
  left: number;
}

export function PluginsPanel() {
  const [items, setItems] = useState<PluginItem[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<HoverState | null>(null);

  const focusId = useSessions((s) => s.focusId);
  const sessions = useSessions((s) => s.sessions);
  const focused = focusId ? sessions.find((s) => s.id === focusId) : undefined;
  const canInsert = !!focused && focused.state !== "exited";

  useEffect(() => {
    let alive = true;
    (async () => {
      const [list, favs] = await Promise.all([listClaudePlugins(), loadFavorites()]);
      if (!alive) return;
      setItems(list);
      setFavorites(new Set(favs));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) => it.invocation.toLowerCase().includes(q) || it.description.toLowerCase().includes(q)
    );
  }, [items, query]);

  const favList = useMemo(
    () => filtered.filter((it) => favorites.has(it.invocation)),
    [filtered, favorites]
  );
  const restList = useMemo(
    () => filtered.filter((it) => !favorites.has(it.invocation)),
    [filtered, favorites]
  );

  const toggleFavorite = (invocation: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(invocation)) next.delete(invocation);
      else next.add(invocation);
      saveFavorites([...next]);
      return next;
    });
  };

  const insert = (it: PluginItem) => {
    if (!canInsert || !focusId) return;
    const data = Array.from(new TextEncoder().encode(`${it.invocation} `));
    invoke("pty_write", { id: focusId, data }).catch((e) => console.error("pty_write failed", e));
  };

  const showHover = (e: MouseEvent<HTMLDivElement>, item: PluginItem) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover({
      item,
      top: Math.max(8, Math.min(r.top, window.innerHeight - 200)),
      left: r.right + 8,
    });
  };

  return (
    <div className="vl-plugins">
      <div className="vl-plugins-head">
        <span className="vl-plugins-title">PLUGINS</span>
        <div className="vl-plugins-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher…"
            spellCheck={false}
          />
        </div>
      </div>

      {!canInsert && <div className="vl-plugins-hint">Sélectionne une session pour insérer</div>}

      <div className="vl-plugins-scroll" onMouseLeave={() => setHover(null)}>
        {loading ? (
          <div className="vl-plugins-empty">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="vl-plugins-empty">Aucun résultat</div>
        ) : (
          <>
            {favList.length > 0 && (
              <Section label="★ Favoris">
                {favList.map((it) => (
                  <Row
                    key={it.invocation}
                    item={it}
                    fav
                    disabled={!canInsert}
                    onStar={toggleFavorite}
                    onInsert={insert}
                    onHover={showHover}
                  />
                ))}
              </Section>
            )}
            <Section label={favList.length > 0 ? "Tout" : undefined}>
              {restList.map((it) => (
                <Row
                  key={it.invocation}
                  item={it}
                  fav={false}
                  disabled={!canInsert}
                  onStar={toggleFavorite}
                  onInsert={insert}
                  onHover={showHover}
                />
              ))}
            </Section>
          </>
        )}
      </div>

      {hover && (
        <div className="vl-plugins-card" style={{ top: hover.top, left: hover.left }}>
          <div className="vl-plugins-card-head">
            <span className="vl-plugins-card-inv">{hover.item.invocation}</span>
            <span className="vl-plugins-card-tag">{hover.item.kind}</span>
          </div>
          <div className="vl-plugins-card-src">{hover.item.source}</div>
          <div className="vl-plugins-card-desc">{hover.item.description}</div>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="vl-plugins-section">
      {label && <div className="vl-plugins-label">{label}</div>}
      {children}
    </div>
  );
}

interface RowProps {
  item: PluginItem;
  fav: boolean;
  disabled: boolean;
  onStar: (invocation: string) => void;
  onInsert: (item: PluginItem) => void;
  onHover: (e: MouseEvent<HTMLDivElement>, item: PluginItem) => void;
}

function Row({ item, fav, disabled, onStar, onInsert, onHover }: RowProps) {
  return (
    <div
      className={`vl-plugin-row${disabled ? " disabled" : ""}`}
      onMouseEnter={(e) => onHover(e, item)}
    >
      <button
        className="vl-plugin-main"
        onClick={() => onInsert(item)}
        disabled={disabled}
        title={disabled ? "Aucune session active" : `Insérer ${item.invocation}`}
      >
        <span className="vl-plugin-inv">{item.invocation}</span>
      </button>
      <button
        className={`vl-plugin-star${fav ? " on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onStar(item.invocation);
        }}
        title={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
      >
        {fav ? "★" : "☆"}
      </button>
    </div>
  );
}
