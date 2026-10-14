import type { Session, SessionLaunchKind, SessionState } from "../store/sessions";

export type DetectedState = "working" | "blocked" | "idle";

const BRAILLE_TITLE = /^[⠀-⣿] /;
const CLAUDE_TITLE_WORKING = /^[⠀-⣿◐-◓] /;
const CLAUDE_SPINNER_LINE = /^\s*[*·✢✳✶✻✽]\s+\S.*…(?:\s+\(\d+[smh](?:\s|·)|\s*$)/;
const CLAUDE_YES_OPTION = /^\s*❯?\s*1\.\s*yes\b/i;
const CODEX_TITLE_WORKING = /(?:^| )[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏](?: |$)/;
const CODEX_TIMER_LINE = /\((?:\d+[hm]\s+)*\d+s\s+•[^)]*to interrupt\)/i;

const CODEX_BLOCKERS = [
  "press enter to confirm or esc to cancel",
  "enter to submit answer",
  "enter to submit all",
  "allow command?",
  "do you trust the contents of this directory",
  "[y/n]",
];

const bottomNonEmpty = (lines: string[], n: number): string[] =>
  lines.filter((l) => l.trim() !== "").slice(-n);

function detectClaude(title: string, lines: string[]): DetectedState {
  if (CLAUDE_TITLE_WORKING.test(title)) return "working";
  const recent = bottomNonEmpty(lines, 20);
  const text = recent.join("\n").toLowerCase();
  const form = text.includes("esc to cancel") &&
    (text.includes("enter to confirm") || text.includes("enter to select") || text.includes("do you want to proceed?"));
  const permission = text.includes("do you want to proceed?") && recent.some((l) => CLAUDE_YES_OPTION.test(l));
  if (form || permission || text.includes("waiting for permission") || text.includes("do you want to allow this connection?")) {
    return "blocked";
  }
  const live = bottomNonEmpty(lines, 12);
  if (live.some((l) => /esc to interrupt/i.test(l) || CLAUDE_SPINNER_LINE.test(l))) return "working";
  return "idle";
}

function detectCodex(title: string, lines: string[]): DetectedState {
  if (title.includes("Action Required")) return "blocked";
  if (CODEX_TITLE_WORKING.test(title)) return "working";
  const recent = bottomNonEmpty(lines, 20);
  const text = recent.join("\n").toLowerCase();
  if (CODEX_BLOCKERS.some((b) => text.includes(b))) return "blocked";
  if (recent.some((l) => CODEX_TIMER_LINE.test(l))) return "working";
  return "idle";
}

export function detectAgentState(kind: SessionLaunchKind, title: string, lines: string[]): DetectedState {
  if (kind === "claude" || kind === "claudex") return detectClaude(title, lines);
  if (kind === "codex") return detectCodex(title, lines);
  return BRAILLE_TITLE.test(title) ? "working" : "idle";
}

export function nextSessionState(
  current: SessionState,
  detected: DetectedState,
  prevDetected: DetectedState | null,
  seen: boolean
): SessionState {
  if (detected === "working") return "working";
  if (detected === "blocked") return "attention";
  if (prevDetected === "working" || prevDetected === "blocked") return seen ? "idle" : "waiting";
  return current === "waiting" ? "waiting" : "idle";
}

const URGENCY: SessionState[] = ["attention", "waiting", "working", "idle", "exited"];

export function rollupState(states: SessionState[]): SessionState | null {
  for (const s of URGENCY) if (states.includes(s)) return s;
  return null;
}

export const STATE_LABEL: Record<SessionState, string> = {
  working: "Travaille…",
  attention: "Attend ta décision",
  waiting: "A fini · à toi",
  idle: "Au repos",
  exited: "En pause",
};

export const displayState = (s: Session): SessionState => (s.openInCanvas ? s.state : "exited");

export const needsYou = (state: SessionState): boolean => state === "attention" || state === "waiting";
