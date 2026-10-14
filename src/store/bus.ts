import { invoke } from "@tauri-apps/api/core";
import { useSessions, type Session } from "./sessions";

export interface BusTile {
  id: string;
  name: string;
  kind: Session["kind"];
  state: Session["state"];
  cwd: string;
}

export const busTiles = (sessions: Session[]): BusTile[] =>
  sessions
    .filter((s) => s.openInCanvas && s.state !== "exited")
    .map(({ id, name, kind, state, cwd }) => ({ id, name, kind, state, cwd }));

export function startBusPublish(): () => void {
  let last = "";
  const publish = (sessions: Session[]) => {
    const json = JSON.stringify(busTiles(sessions));
    if (json === last) return;
    last = json;
    invoke("bus_publish_tiles", { json }).catch((e) => console.error("bus_publish_tiles failed", e));
  };
  publish(useSessions.getState().sessions);
  return useSessions.subscribe((s) => publish(s.sessions));
}
