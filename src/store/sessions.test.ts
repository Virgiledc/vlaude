import { beforeEach, describe, expect, it } from "vitest";
import { useSessions } from "./sessions";

const reset = () =>
  useSessions.setState({
    workspaces: [{ id: "ws-1", name: "Workspace 1" }],
    activeWorkspaceId: "ws-1",
    sessions: [],
    focusId: null,
    counter: 0,
    workspaceCounter: 1,
  });

describe("sessions store", () => {
  beforeEach(reset);

  it("creates a session in the active workspace with order 0 and state working", () => {
    const id = useSessions.getState().createSession("/home/v/a");
    const s = useSessions.getState().sessions[0];
    expect(s.id).toBe(id);
    expect(s.workspaceId).toBe("ws-1");
    expect(s.order).toBe(0);
    expect(s.state).toBe("working");
    expect(s.openInCanvas).toBe(true);
  });

  it("assigns increasing order within the same workspace+cwd", () => {
    const st = useSessions.getState();
    st.createSession("/home/v/a");
    st.createSession("/home/v/a");
    const orders = useSessions.getState().sessions.map((s) => s.order);
    expect(orders).toEqual([0, 1]);
  });

  it("reorderInZone rewrites order by position", () => {
    const st = useSessions.getState();
    const a = st.createSession("/home/v/a");
    const b = st.createSession("/home/v/a");
    useSessions.getState().reorderInZone("ws-1", "/home/v/a", [b, a]);
    const byId = Object.fromEntries(useSessions.getState().sessions.map((s) => [s.id, s.order]));
    expect(byId[b]).toBe(0);
    expect(byId[a]).toBe(1);
  });

  it("setSessionState updates only the targeted session", () => {
    const a = useSessions.getState().createSession("/home/v/a");
    useSessions.getState().setSessionState(a, "waiting");
    expect(useSessions.getState().sessions[0].state).toBe("waiting");
  });

  it("createWorkspace becomes active; switchWorkspace changes active", () => {
    const ws2 = useSessions.getState().createWorkspace("Boulot");
    expect(useSessions.getState().activeWorkspaceId).toBe(ws2);
    useSessions.getState().switchWorkspace("ws-1");
    expect(useSessions.getState().activeWorkspaceId).toBe("ws-1");
  });

  it("closeWorkspace removes its sessions and never closes the last workspace", () => {
    const st = useSessions.getState();
    const ws2 = st.createWorkspace("Boulot");
    useSessions.getState().createSession("/home/v/a"); // in ws2 (active)
    useSessions.getState().closeWorkspace(ws2);
    expect(useSessions.getState().workspaces.map((w) => w.id)).toEqual(["ws-1"]);
    expect(useSessions.getState().sessions).toHaveLength(0);
    expect(useSessions.getState().activeWorkspaceId).toBe("ws-1");
    useSessions.getState().closeWorkspace("ws-1");
    expect(useSessions.getState().workspaces).toHaveLength(1);
  });

  it("snapshot/hydrate round-trips and resets state to working", () => {
    const a = useSessions.getState().createSession("/home/v/a");
    useSessions.getState().setSessionState(a, "waiting");
    const snap = useSessions.getState().snapshot();
    reset();
    useSessions.getState().hydrate(snap);
    expect(useSessions.getState().sessions[0].state).toBe("working");
    expect(useSessions.getState().sessions[0].cwd).toBe("/home/v/a");
  });
});
