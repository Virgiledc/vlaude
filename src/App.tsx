import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { ConfirmCloseModal } from "./components/ConfirmCloseModal";
import { useSessions } from "./store/sessions";
import "./App.css";

export default function App() {
  const createSession = useSessions((s) => s.createSession);
  const closeSession = useSessions((s) => s.closeSession);
  const sessions = useSessions((s) => s.sessions);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [closeId, setCloseId] = useState<string | null>(null);

  const closeName = closeId ? sessions.find((s) => s.id === closeId)?.name ?? null : null;

  return (
    <div className="vl-app">
      <Sidebar onNewSession={() => setDialogOpen(true)} />
      <Canvas onRequestClose={setCloseId} />
      <NewSessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={(cwd, name) => createSession(cwd, name)}
      />
      <ConfirmCloseModal
        name={closeName}
        onCancel={() => setCloseId(null)}
        onConfirm={() => { if (closeId) closeSession(closeId); setCloseId(null); }}
      />
    </div>
  );
}
