import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { WorkspaceTabs } from "./components/WorkspaceTabs";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { ConfirmCloseModal } from "./components/ConfirmCloseModal";
import { PluginsPanel } from "./components/PluginsPanel";
import { SidebarResizer } from "./components/SidebarResizer";
import { useSessions } from "./store/sessions";
import { loadLayout, startAutoSave } from "./store/persistence";
import { useImageDrop } from "./terminal/useImageDrop";
import { useDictationEvents } from "./terminal/useDictationEvents";
import { SquadPanel } from "./components/SquadPanel";
import { useSquad } from "./store/squad";
import "./App.css";

export default function App() {
  const createSession = useSessions((s) => s.createSession);
  const closeSession = useSessions((s) => s.closeSession);
  const closeWorkspace = useSessions((s) => s.closeWorkspace);
  const sessions = useSessions((s) => s.sessions);
  const workspaces = useSessions((s) => s.workspaces);
  const sidebarWidth = useSessions((s) => s.sidebarWidth);
  const createSquad = useSquad((s) => s.createSquad);
  const [dialogMode, setDialogMode] = useState<null | "session" | "squad">(null);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [closeWsId, setCloseWsId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useImageDrop();
  useDictationEvents();

  useEffect(() => {
    let unsub: (() => void) | undefined;
    loadLayout().finally(() => {
      setReady(true);
      unsub = startAutoSave();
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--vl-side-w", `${sidebarWidth}px`);
  }, [sidebarWidth]);

  const closeName = closeId ? sessions.find((s) => s.id === closeId)?.name ?? null : null;
  const closeWsName = closeWsId ? workspaces.find((w) => w.id === closeWsId)?.name ?? null : null;
  const wsSessionCount = closeWsId ? sessions.filter((s) => s.workspaceId === closeWsId).length : 0;

  if (!ready) return <div className="vl-app vl-booting" />;

  return (
    <div className="vl-app">
      <div className="vl-left">
        <Sidebar onNewSession={() => setDialogMode("session")} onNewSquad={() => setDialogMode("squad")} />
        <PluginsPanel />
      </div>
      <SidebarResizer />
      <div className="vl-main">
        <WorkspaceTabs onRequestCloseWorkspace={setCloseWsId} />
        <Canvas onRequestClose={setCloseId} />
      </div>
      <SquadPanel />
      <NewSessionDialog
        open={dialogMode !== null}
        mode={dialogMode ?? "session"}
        onClose={() => setDialogMode(null)}
        onCreate={(cwd, name) => { if (dialogMode === "squad") createSquad(cwd, name); else createSession(cwd, name); }}
      />
      <ConfirmCloseModal
        name={closeName}
        onCancel={() => setCloseId(null)}
        onConfirm={() => { if (closeId) closeSession(closeId); setCloseId(null); }}
      />
      <ConfirmCloseModal
        name={closeWsId ? `${closeWsName} (${wsSessionCount} session${wsSessionCount > 1 ? "s" : ""})` : null}
        onCancel={() => setCloseWsId(null)}
        onConfirm={() => { if (closeWsId) closeWorkspace(closeWsId); setCloseWsId(null); }}
      />
    </div>
  );
}
