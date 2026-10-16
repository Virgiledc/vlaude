import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { ConfirmCloseModal } from "./components/ConfirmCloseModal";
import { SidebarResizer } from "./components/SidebarResizer";
import { useSessions } from "./store/sessions";
import { loadLayout, startAutoSave } from "./store/persistence";
import { useImageDrop } from "./terminal/useImageDrop";
import { SquadPanel } from "./components/SquadPanel";
import { useSquad } from "./store/squad";
import { startBusPublish } from "./store/bus";
import { useTheme } from "./store/theme";
import "./App.css";

export default function App() {
  const createSessions = useSessions((s) => s.createSessions);
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
  const [quitAsk, setQuitAsk] = useState(false);

  useImageDrop();

  useEffect(() => {
    if (!ready) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWindow()
      .onCloseRequested((e) => {
        e.preventDefault();
        setQuitAsk(true);
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      })
      .catch((e) => console.error("onCloseRequested failed", e));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ready]);

  useEffect(() => {
    const refresh = () => { useTheme.getState().refresh(); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.shiftKey && e.code === "KeyN") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setDialogMode("session");
        return;
      }
      const digit = !e.shiftKey && /^Digit[1-9]$/.test(e.code) ? Number(e.code.slice(5)) : 0;
      if (!digit) return;
      const { workspaces: list, switchWorkspace } = useSessions.getState();
      const target = list[digit - 1];
      if (!target) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      switchWorkspace(target.id);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let unsubBus: (() => void) | undefined;
    loadLayout().finally(() => {
      setReady(true);
      unsub = startAutoSave();
      unsubBus = startBusPublish();
    });
    return () => { unsub?.(); unsubBus?.(); };
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
        <Sidebar
          onNewSession={() => setDialogMode("session")}
          onNewSquad={() => setDialogMode("squad")}
          onRequestCloseWorkspace={setCloseWsId}
        />
      </div>
      <SidebarResizer />
      <div className="vl-main">
        <Canvas onRequestClose={setCloseId} onNewSession={() => setDialogMode("session")} />
      </div>
      <SquadPanel />
      <NewSessionDialog
        open={dialogMode !== null}
        mode={dialogMode ?? "session"}
        onClose={() => setDialogMode(null)}
        onCreate={(cwd, name, kind, count) => { if (dialogMode === "squad") createSquad(cwd, name); else createSessions(cwd, count ?? 1, name, kind); }}
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
      <ConfirmCloseModal
        name={quitAsk ? `Vlaude (${sessions.length} session${sessions.length > 1 ? "s" : ""})` : null}
        body="Tous les agents en cours seront arrêtés."
        onCancel={() => setQuitAsk(false)}
        onConfirm={() => { getCurrentWindow().destroy(); }}
      />
    </div>
  );
}
