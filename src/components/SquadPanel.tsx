import "./SquadPanel.css";

export type SquadTaskStatus = "todo" | "claimed" | "submitted" | "verified";

export interface SquadMember {
  name: string;
  role: "pere" | "fils";
  alive: boolean;
}

export interface SquadTask {
  id: number;
  title: string;
  ownedPaths: string[];
  status: SquadTaskStatus;
  claimedBy: string | null;
}

export interface SquadOverlap {
  titles: [string, string];
}

export interface SquadMessage {
  id: number;
  from: string | null;
  to: string;
  body: string;
}

export interface SquadState {
  name: string;
  members: SquadMember[];
  tasks: SquadTask[];
  overlaps: SquadOverlap[];
  messages: SquadMessage[];
}

const STATUS_LABEL: Record<SquadTaskStatus, string> = {
  todo: "à faire",
  claimed: "en cours",
  submitted: "soumis",
  verified: "validé",
};

export function SquadPanel({ squad }: { squad: SquadState }) {
  return (
    <aside className="vl-sq">
      <div className="vl-sq-head">
        <div className="vl-sq-eyebrow"><span className="vl-sq-thread" />Escouade</div>
        <div className="vl-sq-name">{squad.name}</div>
        <div className="vl-sq-members">
          {squad.members.map((m) => (
            <span key={m.name} className={`vl-sq-chip${m.role === "pere" ? " pere" : ""}`}>
              <span className={`vl-sq-mdot${m.alive ? " alive" : ""}`} />
              {m.name}
            </span>
          ))}
        </div>
      </div>

      <div className="vl-sq-board">
        {squad.overlaps.map((o, i) => (
          <div key={`ov-${i}`} className="vl-sq-overlap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            <span>Périmètres qui se chevauchent : <b>{o.titles[0]}</b> ∩ <b>{o.titles[1]}</b> — re-découpe avant de lancer.</span>
          </div>
        ))}

        <div className="vl-sq-section">Lots</div>
        {squad.tasks.length === 0 && (
          <div className="vl-sq-empty">Aucun lot. Le père n'a pas encore découpé la feature.</div>
        )}
        {squad.tasks.map((t, i) => {
          const flagged = squad.overlaps.some((o) => o.titles.includes(t.title));
          return (
            <div
              key={t.id}
              className={`vl-sq-task${flagged ? " flagged" : ""}`}
              style={{ animationDelay: `${i * 28}ms` }}
            >
              <div className="vl-sq-task-top">
                <span className="vl-sq-task-title">{t.title}</span>
                <span className={`vl-sq-pill ${t.status}`}>{STATUS_LABEL[t.status]}</span>
              </div>
              <div className="vl-sq-paths">
                {t.ownedPaths.map((p) => <span key={p} className="vl-sq-path">{p}</span>)}
              </div>
              {t.claimedBy && <div className="vl-sq-owner">pris par <b>{t.claimedBy}</b></div>}
            </div>
          );
        })}
      </div>

      <div className="vl-sq-feed">
        <div className="vl-sq-feed-title">Messages</div>
        {squad.messages.length === 0 && <div className="vl-sq-empty">—</div>}
        {squad.messages.map((m) =>
          m.from === null ? (
            <div key={m.id} className="vl-sq-msg system">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>
              <span>{m.body}</span>
            </div>
          ) : (
            <div key={m.id} className="vl-sq-msg"><b>{m.from}</b><span className="arrow">→</span><b>{m.to}</b> · {m.body}</div>
          )
        )}
      </div>
    </aside>
  );
}

export const MOCK_SQUAD: SquadState = {
  name: "feature/export-csv",
  members: [
    { name: "père", role: "pere", alive: true },
    { name: "fils-1", role: "fils", alive: true },
    { name: "fils-2", role: "fils", alive: true },
    { name: "fils-3", role: "fils", alive: false },
  ],
  tasks: [
    { id: 1, title: "Endpoint API /export", ownedPaths: ["src/api/export/**"], status: "verified", claimedBy: "fils-1" },
    { id: 2, title: "Bouton + modal export", ownedPaths: ["src/ui/export/**"], status: "submitted", claimedBy: "fils-2" },
    { id: 3, title: "Sérialiseur CSV", ownedPaths: ["src/lib/csv/**"], status: "claimed", claimedBy: "fils-1" },
    { id: 4, title: "Tests d'intégration", ownedPaths: ["tests/export/**"], status: "todo", claimedBy: null },
  ],
  overlaps: [{ titles: ["Sérialiseur CSV", "Tests d'intégration"] }],
  messages: [
    { id: 1, from: "fils-2", to: "fils-1", body: "quelle est la signature de serialize() ?" },
    { id: 2, from: null, to: "père", body: "lot #4 ré-ouvert : fils-3 perdu (bail expiré) — vérifier tests/export/**" },
  ],
};

export function SquadPanelPreview() {
  return <SquadPanel squad={MOCK_SQUAD} />;
}
