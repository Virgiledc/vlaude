import { describe, it, expect, beforeEach } from "vitest";
import { useSessions } from "./sessions";

const reset = () =>
  useSessions.setState({ sessions: [], focusId: null, counter: 0 });

describe("sessions store", () => {
  beforeEach(reset);

  it("createSession adds an open, focused running session with auto name", () => {
    const id = useSessions.getState().createSession("/home/v/dt/x");
    const st = useSessions.getState();
    expect(st.sessions).toHaveLength(1);
    expect(st.sessions[0]).toMatchObject({
      id, cwd: "/home/v/dt/x", name: "session-1", status: "running", openInCanvas: true,
    });
    expect(st.focusId).toBe(id);
  });

  it("createSession honors an explicit name", () => {
    useSessions.getState().createSession("/home/v/dt/x", "fix-bug");
    expect(useSessions.getState().sessions[0].name).toBe("fix-bug");
  });

  it("removeFromCanvas keeps the session but hides it", () => {
    const id = useSessions.getState().createSession("/home/v/dt/x");
    useSessions.getState().removeFromCanvas(id);
    const sess = useSessions.getState().sessions.find((s) => s.id === id)!;
    expect(sess.openInCanvas).toBe(false);
    expect(useSessions.getState().sessions).toHaveLength(1);
  });

  it("openInCanvas re-shows and focuses", () => {
    const id = useSessions.getState().createSession("/home/v/dt/x");
    useSessions.getState().removeFromCanvas(id);
    useSessions.getState().openInCanvas(id);
    expect(useSessions.getState().sessions.find((s) => s.id === id)!.openInCanvas).toBe(true);
    expect(useSessions.getState().focusId).toBe(id);
  });

  it("closeSession removes the session entirely", () => {
    const id = useSessions.getState().createSession("/home/v/dt/x");
    useSessions.getState().closeSession(id);
    expect(useSessions.getState().sessions).toHaveLength(0);
  });
});
