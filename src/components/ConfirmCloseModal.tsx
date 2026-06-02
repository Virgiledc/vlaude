import "./ConfirmCloseModal.css";

interface Props {
  name: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmCloseModal({ name, onCancel, onConfirm }: Props) {
  if (!name) return null;
  return (
    <div className="vl-overlay" onMouseDown={onCancel}>
      <div className="vl-confirm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vl-confirm-title">Fermer « {name} » ?</div>
        <div className="vl-confirm-body">La session Claude sera terminée. Action irréversible.</div>
        <div className="vl-modal-actions">
          <button className="ghost" onClick={onCancel}>Annuler</button>
          <button className="danger" onClick={onConfirm}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
