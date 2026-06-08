import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { mapView, useSquad } from "./squad";
import { useSessions } from "./sessions";
import { newInjectionEntry, ACK_TIMEOUT_MS } from "./injection";
import { wakePayload } from "./wake";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = invoke as unknown as Mock;

describe("mapView", () => {
  it("maps the bus view to a SquadState", () => {
    const raw = {
      squad: { squad_id: "sq1", cwd: "/home/x/my-proj" },
      members: [
        { name: "pere", role: "pere" as const, alive: true, last_seen: 100 },
        { name: "fils-1", role: "fils" as const, alive: false, last_seen: 50 },
      ],
      tasks: [
        { id: 1, title: "API", status: "claimed" as const, owned_paths: ["src/**"], claimed_by: "fils-1" },
      ],
    };
    const s = mapView(raw)!;
    expect(s.name).toBe("my-proj");
    expect(s.members).toHaveLength(2);
    expect(s.members[1]).toEqual({ name: "fils-1", role: "fils", alive: false, lastSeen: 50 });
    expect(s.tasks[0].ownedPaths).toEqual(["src/**"]);
    expect(s.tasks[0].claimedBy).toBe("fils-1");
    expect(s.tasks[0].status).toBe("claimed");
  });

  it("returns null when there is no squad row", () => {
    expect(mapView({ squad: null, members: [], tasks: [] })).toBeNull();
    expect(mapView(null)).toBeNull();
  });
});

describe("startPoll", () => {
  afterEach(() => {
    useSquad.getState().disband();
    vi.useRealTimers();
    invokeMock.mockReset();
  });

  it("never overlaps two in-flight view calls", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(() => new Promise<never>(() => {}));
    useSquad.getState().startPoll("/r");
    await vi.advanceTimersByTimeAsync(2400);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("keeps polling once the previous call resolves", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(JSON.stringify({ squad: null, members: [], tasks: [] }));
    useSquad.getState().startPoll("/r");
    await vi.advanceTimersByTimeAsync(1600);
    expect(invokeMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe("panelCollapsed", () => {
  it("toggles and resets on disband", () => {
    expect(useSquad.getState().panelCollapsed).toBe(false);
    useSquad.getState().togglePanel();
    expect(useSquad.getState().panelCollapsed).toBe(true);
    useSquad.getState().disband();
    expect(useSquad.getState().panelCollapsed).toBe(false);
  });
});

describe("auto-disband", () => {
  afterEach(() => {
    useSquad.getState().disband();
  });

  it("disbands when the last member session closes", () => {
    const id = useSessions.getState().createSession("/r", "père");
    useSquad.setState({ active: { squadId: "sq1", cwd: "/r" }, roleById: { [id]: "pere" } });
    useSessions.getState().closeSession(id);
    expect(useSquad.getState().active).toBeNull();
    expect(useSquad.getState().roleById).toEqual({});
  });

  it("stays active while a member session remains", () => {
    const pere = useSessions.getState().createSession("/r", "père");
    const fils = useSessions.getState().createSession("/r", "fils-1");
    useSquad.setState({
      active: { squadId: "sq1", cwd: "/r" },
      roleById: { [pere]: "pere", [fils]: "fils" },
    });
    useSessions.getState().closeSession(fils);
    expect(useSquad.getState().active).not.toBeNull();
    useSessions.getState().closeSession(pere);
    expect(useSquad.getState().active).toBeNull();
  });
});

describe("runInjection", () => {
  afterEach(() => {
    useSquad.getState().disband();
    invokeMock.mockReset();
  });

  const raw = (tasks: { id: number; title: string; status: "todo" | "claimed" | "submitted" | "verified"; owned_paths: string[]; claimed_by: string | null }[], lastSeen = 100) => ({
    squad: { squad_id: "sq1", cwd: "/r" },
    members: [
      { name: "pere", role: "pere" as const, alive: true, last_seen: lastSeen },
      { name: "fils-1", role: "fils" as const, alive: true, last_seen: lastSeen },
    ],
    tasks,
  });

  it("injects \\x15/squad-pere\\r once the pere tile is ready and goes pending-ack", () => {
    invokeMock.mockResolvedValue(undefined);
    const id = useSessions.getState().createSession("/r", "père");
    useSquad.setState({
      active: { squadId: "sq1", cwd: "/r" },
      roleById: { [id]: "pere" },
      injection: { [id]: { ...newInjectionEntry("pere", "pere", 1_000), readyAt: 2_000 } },
    });
    useSquad.getState().runInjection(raw([]), 3_000);
    expect(invokeMock).toHaveBeenCalledWith("pty_write", {
      id,
      data: Array.from(new TextEncoder().encode("\x15/squad-pere\r")),
    });
    const e = useSquad.getState().injection[id];
    expect(e.phase).toBe("pending-ack");
    expect(e.attempts).toBe(1);
    expect(e.baselineLastSeen).toBe(100);
    useSessions.getState().closeSession(id);
  });

  it("holds a ready fils until a todo task exists, then injects", () => {
    invokeMock.mockResolvedValue(undefined);
    const pereId = useSessions.getState().createSession("/r", "père");
    const filsId = useSessions.getState().createSession("/r", "fils-1");
    useSquad.setState({
      active: { squadId: "sq1", cwd: "/r" },
      roleById: { [pereId]: "pere", [filsId]: "fils" },
      injection: { [filsId]: { ...newInjectionEntry("fils", "fils-1", 1_000), readyAt: 2_000 } },
    });
    useSquad.getState().runInjection(raw([]), 3_000);
    expect(useSquad.getState().injection[filsId].phase).toBe("waiting-lots");
    expect(invokeMock).not.toHaveBeenCalledWith("pty_write", expect.anything());
    useSquad.getState().runInjection(raw([{ id: 1, title: "API", status: "todo", owned_paths: ["src/**"], claimed_by: null }]), 4_000);
    expect(invokeMock).toHaveBeenCalledWith("pty_write", {
      id: filsId,
      data: Array.from(new TextEncoder().encode("\x15/squad-fils\r")),
    });
    expect(useSquad.getState().injection[filsId].phase).toBe("pending-ack");
    useSessions.getState().closeSession(filsId);
    useSessions.getState().closeSession(pereId);
  });

  it("activates only when last_seen advances past the injection baseline", () => {
    invokeMock.mockResolvedValue(undefined);
    const id = useSessions.getState().createSession("/r", "père");
    useSquad.setState({
      active: { squadId: "sq1", cwd: "/r" },
      roleById: { [id]: "pere" },
      injection: {
        [id]: { ...newInjectionEntry("pere", "pere", 1_000), readyAt: 2_000, phase: "pending-ack", attempts: 1, lastInjectAt: 3_000, baselineLastSeen: 100 },
      },
    });
    useSquad.getState().runInjection(raw([], 100), 4_000);
    expect(useSquad.getState().injection[id].phase).toBe("pending-ack");
    useSquad.getState().runInjection(raw([], 101), 5_000);
    expect(useSquad.getState().injection[id].phase).toBe("active");
    useSessions.getState().closeSession(id);
  });

  it("re-injects after the ack timeout and fails after three silent attempts", () => {
    invokeMock.mockResolvedValue(undefined);
    const id = useSessions.getState().createSession("/r", "père");
    useSquad.setState({
      active: { squadId: "sq1", cwd: "/r" },
      roleById: { [id]: "pere" },
      injection: {
        [id]: { ...newInjectionEntry("pere", "pere", 1_000), readyAt: 2_000, phase: "pending-ack", attempts: 1, lastInjectAt: 3_000, baselineLastSeen: 100 },
      },
    });
    useSquad.getState().runInjection(raw([]), 3_000 + ACK_TIMEOUT_MS);
    expect(useSquad.getState().injection[id].attempts).toBe(2);
    useSquad.getState().runInjection(raw([]), 3_000 + 2 * ACK_TIMEOUT_MS);
    expect(useSquad.getState().injection[id].attempts).toBe(3);
    useSquad.getState().runInjection(raw([]), 3_000 + 3 * ACK_TIMEOUT_MS);
    expect(useSquad.getState().injection[id].phase).toBe("failed");
    useSessions.getState().closeSession(id);
  });

  it("prunes the injection entry of a closed fils tile", () => {
    invokeMock.mockResolvedValue(undefined);
    const pereId = useSessions.getState().createSession("/r", "père");
    const filsId = useSessions.getState().createSession("/r", "fils-1");
    useSquad.setState({
      active: { squadId: "sq1", cwd: "/r" },
      roleById: { [pereId]: "pere", [filsId]: "fils" },
      injection: {
        [pereId]: { ...newInjectionEntry("pere", "pere", 1_000), phase: "active" },
        [filsId]: { ...newInjectionEntry("fils", "fils-1", 1_000), readyAt: 2_000, phase: "waiting-lots" },
      },
    });
    useSessions.getState().closeSession(filsId);
    useSquad.getState().runInjection(raw([{ id: 1, title: "API", status: "todo", owned_paths: ["src/**"], claimed_by: null }]), 4_000);
    expect(useSquad.getState().injection[filsId]).toBeUndefined();
    expect(invokeMock).not.toHaveBeenCalledWith("pty_write", expect.objectContaining({ id: filsId }));
    useSessions.getState().closeSession(pereId);
  });
});

describe("notifySpawn / markReady / manualInject", () => {
  afterEach(() => {
    useSquad.getState().disband();
    invokeMock.mockReset();
  });

  it("markReady stamps readyAt once and only in booting", () => {
    useSquad.setState({ injection: { a: newInjectionEntry("pere", "pere", 1_000) } });
    useSquad.getState().markReady("a");
    const stamped = useSquad.getState().injection.a.readyAt;
    expect(stamped).not.toBeNull();
    useSquad.getState().markReady("a");
    expect(useSquad.getState().injection.a.readyAt).toBe(stamped);
    useSquad.setState({ injection: { a: { ...newInjectionEntry("pere", "pere", 1_000), phase: "active" } } });
    useSquad.getState().markReady("a");
    expect(useSquad.getState().injection.a.readyAt).toBeNull();
  });

  it("notifySpawn resets the full cycle after a tile respawn", () => {
    useSquad.setState({
      injection: { a: { ...newInjectionEntry("fils", "fils-1", 1_000), readyAt: 2_000, phase: "active", attempts: 2, lastInjectAt: 3_000, baselineLastSeen: 100 } },
    });
    useSquad.getState().notifySpawn("a");
    const e = useSquad.getState().injection.a;
    expect(e.phase).toBe("booting");
    expect(e.readyAt).toBeNull();
    expect(e.attempts).toBe(0);
    expect(e.memberName).toBe("fils-1");
  });

  it("manualInject writes the cleared payload and re-arms pending-ack", () => {
    invokeMock.mockResolvedValue(undefined);
    useSquad.setState({
      injection: { a: { ...newInjectionEntry("pere", "pere", 1_000), phase: "failed", attempts: 3 } },
      view: { name: "r", members: [{ name: "pere", role: "pere", alive: true, lastSeen: 200 }], tasks: [], overlaps: [], messages: [] },
    });
    useSquad.getState().manualInject("a");
    expect(invokeMock).toHaveBeenCalledWith("pty_write", {
      id: "a",
      data: Array.from(new TextEncoder().encode("\x15/squad-pere\r")),
    });
    const e = useSquad.getState().injection.a;
    expect(e.phase).toBe("pending-ack");
    expect(e.attempts).toBe(1);
    expect(e.baselineLastSeen).toBe(200);
  });
});

describe("sendFeature", () => {
  afterEach(() => {
    useSquad.getState().disband();
    invokeMock.mockReset();
  });

  it("writes the feature as a bracketed paste into the pere terminal when its role is active", () => {
    invokeMock.mockResolvedValue(undefined);
    const id = useSessions.getState().createSession("/r", "père");
    useSquad.setState({
      active: { squadId: "sq1", cwd: "/r" },
      roleById: { [id]: "pere" },
      injection: { [id]: { ...newInjectionEntry("pere", "pere", 1_000), phase: "active" } },
    });
    useSquad.getState().sendFeature("export CSV\navec filtres");
    expect(invokeMock).toHaveBeenCalledWith("pty_write", {
      id,
      data: Array.from(new TextEncoder().encode("\x15\x1b[200~export CSV\ravec filtres\x1b[201~\r")),
    });
    useSessions.getState().closeSession(id);
  });

  it("does nothing while the pere is not active or the text is blank", () => {
    invokeMock.mockResolvedValue(undefined);
    const id = useSessions.getState().createSession("/r", "père");
    useSquad.setState({
      active: { squadId: "sq1", cwd: "/r" },
      roleById: { [id]: "pere" },
      injection: { [id]: { ...newInjectionEntry("pere", "pere", 1_000), phase: "pending-ack" } },
    });
    useSquad.getState().sendFeature("export CSV");
    useSquad.setState({ injection: { [id]: { ...newInjectionEntry("pere", "pere", 1_000), phase: "active" } } });
    useSquad.getState().sendFeature("   ");
    expect(invokeMock).not.toHaveBeenCalledWith("pty_write", expect.anything());
    useSessions.getState().closeSession(id);
  });
});

describe("runWake", () => {
  afterEach(() => {
    useSquad.getState().disband();
    invokeMock.mockReset();
  });

  const raw = (status: "todo" | "claimed" | "submitted" | "verified") => ({
    squad: { squad_id: "sq1", cwd: "/r" },
    members: [{ name: "pere", role: "pere" as const, alive: true, last_seen: 100 }],
    tasks: [{ id: 1, title: "API", status, owned_paths: ["src/**"], claimed_by: "fils-1" }],
  });

  it("nudges the active pere once when a lot turns submitted, then stays silent", () => {
    invokeMock.mockResolvedValue(undefined);
    const id = useSessions.getState().createSession("/r", "père");
    useSquad.setState({
      active: { squadId: "sq1", cwd: "/r" },
      roleById: { [id]: "pere" },
      injection: { [id]: { ...newInjectionEntry("pere", "pere", 1_000), phase: "active" } },
    });
    useSquad.getState().runWake(raw("claimed"), 10_000);
    expect(invokeMock).not.toHaveBeenCalled();
    useSquad.getState().runWake(raw("submitted"), 11_000);
    expect(invokeMock).toHaveBeenCalledWith("pty_write", {
      id,
      data: Array.from(new TextEncoder().encode(wakePayload([1]))),
    });
    invokeMock.mockClear();
    useSquad.getState().runWake(raw("submitted"), 12_000);
    expect(invokeMock).not.toHaveBeenCalled();
    useSessions.getState().closeSession(id);
  });

  it("stays mute while the pere role is not confirmed active", () => {
    invokeMock.mockResolvedValue(undefined);
    const id = useSessions.getState().createSession("/r", "père");
    useSquad.setState({
      active: { squadId: "sq1", cwd: "/r" },
      roleById: { [id]: "pere" },
      injection: { [id]: { ...newInjectionEntry("pere", "pere", 1_000), phase: "pending-ack" } },
    });
    useSquad.getState().runWake(raw("submitted"), 10_000);
    expect(invokeMock).not.toHaveBeenCalled();
    useSessions.getState().closeSession(id);
  });

  it("disband clears the wake memory so a recreated squad re-notifies reused ids", () => {
    invokeMock.mockResolvedValue(undefined);
    const first = useSessions.getState().createSession("/r", "père");
    useSquad.setState({
      active: { squadId: "sq1", cwd: "/r" },
      roleById: { [first]: "pere" },
      injection: { [first]: { ...newInjectionEntry("pere", "pere", 1_000), phase: "active" } },
    });
    useSquad.getState().runWake(raw("submitted"), 10_000);
    useSessions.getState().closeSession(first);
    useSquad.getState().disband();
    invokeMock.mockClear();
    const second = useSessions.getState().createSession("/r", "père");
    useSquad.setState({
      active: { squadId: "sq2", cwd: "/r" },
      roleById: { [second]: "pere" },
      injection: { [second]: { ...newInjectionEntry("pere", "pere", 1_000), phase: "active" } },
    });
    useSquad.getState().runWake(raw("submitted"), 20_000);
    expect(invokeMock).toHaveBeenCalledWith("pty_write", {
      id: second,
      data: Array.from(new TextEncoder().encode(wakePayload([1]))),
    });
    useSessions.getState().closeSession(second);
  });
});
