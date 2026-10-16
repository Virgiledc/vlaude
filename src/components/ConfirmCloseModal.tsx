import "./ConfirmCloseModal.css";

interface Props {
  name: string | null;
  body?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmCloseModal({ name, body = "La session Claude sera terminée. Action irréversible.", onCancel, onConfirm }: Props) {
  if (!name) return null;
  return (
    <div className="vl-overlay" onMouseDown={onCancel} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <div className="vl-confirm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vl-confirm-title">Fermer « {name} » ?</div>
        <div className="vl-confirm-body">{body}</div>
        <div className="vl-modal-actions">
          <button className="ghost" onClick={onCancel}>Annuler</button>
          <button className="danger" autoFocus onClick={onConfirm}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
