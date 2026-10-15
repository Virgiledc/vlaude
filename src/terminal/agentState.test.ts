import { describe, it, expect } from "vitest";
import { detectAgentState, displayState, nextSessionState } from "./agentState";
import type { Session } from "../store/sessions";

const PROMPT_BOX = [
  "────────────────────────────────────────",
  "❯ ",
  "────────────────────────────────────────",
  "  ⏵⏵ accept edits on (shift+tab to cycle)",
];

describe("detectAgentState — claude", () => {
  it("reads the braille spinner in the OSC title as working", () => {
    expect(detectAgentState("claude", "⠐ Refactor auth", PROMPT_BOX)).toBe("working");
  });

  it("reads the half-circle spinner (>= 2.1.228) as working", () => {
    expect(detectAgentState("claude", "◐ Refactor auth", PROMPT_BOX)).toBe("working");
  });

  it("is idle on the resting title with an empty prompt box", () => {
    expect(detectAgentState("claude", "✳ Refactor auth", PROMPT_BOX)).toBe("idle");
  });

  it("reads the live spinner line as working when the title is silent", () => {
    const lines = ["● Je lis TerminalView.tsx", "", "✻ Pondering… (12s · ↑ 1.2k tokens · esc to interrupt)", "", ...PROMPT_BOX];
    expect(detectAgentState("claude", "", lines)).toBe("working");
  });

  it("does not read a finished-turn summary as working", () => {
    const lines = ["● Fini.", "", "✻ Worked for 2m 3s", "", ...PROMPT_BOX];
    expect(detectAgentState("claude", "", lines)).toBe("idle");
  });

  it("detects a bash permission prompt as blocked", () => {
    const lines = [
      "────────────────────────────────────────",
      " Bash command",
      "",
      "   npm test",
      "   Run the test suite",
      "",
      " Do you want to proceed?",
      " ❯ 1. Yes",
      "   2. Yes, and don't ask again for npm test commands in /home/x/app",
      "   3. No, and tell Claude what to do differently (esc)",
      "",
    ];
    expect(detectAgentState("claude", "✳ Tests", lines)).toBe("blocked");
  });

  it("detects a question form as blocked", () => {
    const lines = [
      "☐ Approche",
      "",
      "Quelle approche ?",
      "",
      "❯ 1. Hooks",
      "  2. Lecture d'écran",
      "",
      "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
    ];
    expect(detectAgentState("claude", "✳ Question", lines)).toBe("blocked");
  });

  it("keeps the title spinner above a stale blocker, like herdr", () => {
    const lines = ["Do you want to proceed?", "❯ 1. Yes", "  2. No", ...PROMPT_BOX];
    expect(detectAgentState("claude", "⠂ Tests", lines)).toBe("working");
  });

  it("is idle on an empty screen", () => {
    expect(detectAgentState("claude", "", ["", "", ""])).toBe("idle");
  });

  it("applies the claude rules to claudex", () => {
    expect(detectAgentState("claudex", "⠐ x", PROMPT_BOX)).toBe("working");
  });
});

describe("detectAgentState — codex", () => {
  it("reads Action Required in the title as blocked", () => {
    expect(detectAgentState("codex", "Action Required · codex", [])).toBe("blocked");
  });

  it("reads the braille spinner in the title as working", () => {
    expect(detectAgentState("codex", "⠋ codex", [])).toBe("working");
  });

  it("reads the live timer line as working", () => {
    const lines = ["• Working (5s • esc to interrupt)", "", "› Ask Codex to do anything"];
    expect(detectAgentState("codex", "", lines)).toBe("working");
  });

  it("detects the directory trust prompt as blocked", () => {
    const lines = ["> You are in /home/x/app", "", "  Do you trust the contents of this directory?", "› 1. Yes, continue", "  2. No, quit"];
    expect(detectAgentState("codex", "", lines)).toBe("blocked");
  });

  it("is idle at the prompt", () => {
    expect(detectAgentState("codex", "", ["› Ask Codex to do anything"])).toBe("idle");
  });
});

describe("detectAgentState — omp", () => {
  it("only trusts a braille spinner in the title", () => {
    expect(detectAgentState("omp", "⠋ omp", [])).toBe("working");
    expect(detectAgentState("omp", "omp", ["Do you want to proceed?", "❯ 1. Yes"])).toBe("idle");
  });
});

describe("nextSessionState", () => {
  it("maps working and blocked directly", () => {
    expect(nextSessionState("idle", "working", "idle", false)).toBe("working");
    expect(nextSessionState("working", "blocked", "working", true)).toBe("attention");
  });

  it("flags a finished turn nobody looked at as waiting", () => {
    expect(nextSessionState("working", "idle", "working", false)).toBe("waiting");
    expect(nextSessionState("attention", "idle", "blocked", false)).toBe("waiting");
  });

  it("goes straight to idle when the turn finishes under the user's eyes", () => {
    expect(nextSessionState("working", "idle", "working", true)).toBe("idle");
  });

  it("does not flag the first idle reading after boot", () => {
    expect(nextSessionState("working", "idle", null, false)).toBe("idle");
  });

  it("keeps waiting sticky until seen", () => {
    expect(nextSessionState("waiting", "idle", "idle", false)).toBe("waiting");
  });
});

describe("displayState", () => {
  const base = { id: "a", name: "a", cwd: "/a", workspaceId: "ws-1", order: 0, claudeSessionId: "u", kind: "claude" } as const;

  it("shows a session removed from the canvas as paused, whatever its last state", () => {
    const s: Session = { ...base, state: "attention", openInCanvas: false };
    expect(displayState(s)).toBe("exited");
  });

  it("shows the live state of an open session", () => {
    const s: Session = { ...base, state: "waiting", openInCanvas: true };
    expect(displayState(s)).toBe("waiting");
  });
});
