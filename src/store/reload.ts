export type ReloadPhase = "recapping" | "clearing" | "done" | "error";

export interface ReloadEntry {
  sessionId: string;
  handoffPath: string;
  donePath: string;
  startedAt: number;
  phase: ReloadPhase;
  handoff: string | null;
  error: string | null;
}

export interface ReloadSignals {
  doneContent: string | null;
  handoffContent: string | null;
}

export type ReloadAction =
  | { type: "wait" }
  | { type: "clear"; handoff: string }
  | { type: "fail"; error: string };

export const RECAP_TIMEOUT_MS = 180_000;
export const RELOAD_POLL_MS = 800;

export function reloadPaths(home: string, claudeSessionId: string): { handoffPath: string; donePath: string } {
  const base = `${home.replace(/\/+$/, "")}/.vlaude/handoffs/${claudeSessionId}`;
  return { handoffPath: `${base}.md`, donePath: `${base}.done` };
}

export function buildHandoffPrompt(handoffPath: string, donePath: string): string {
  return [
    "Le contexte de cette session est saturé. Avant que je reparte sur une session vierge,",
    "fais exactement ceci, dans cet ordre, sans me poser de question :",
    "",
    `1. Écris un handoff de reprise dans ${handoffPath} (écrase s'il existe). Court mais`,
    "   actionnable — c'est le PROMPT qui démarrera la prochaine session, pas un journal.",
    "   Contenu : objectif en cours, état/avancement réel, fichiers clés touchés (chemin:ligne),",
    "   prochaine étape concrète, pièges/contraintes à ne pas réoublier.",
    "",
    "2. Persiste dans le vault Obsidian uniquement le savoir durable, selon tes critères",
    "   habituels (trap résolu, décision d'archi, mécanisme du codebase, contournement de",
    "   limitation) — une note = une claim, rien de trivial. S'il n'y a rien qui mérite, skip.",
    "",
    `3. EN TOUT DERNIER, une fois 1 et 2 faits, écris ${donePath} (contenu : ok).`,
  ].join("\n");
}

export function planReload(entry: ReloadEntry, signals: ReloadSignals, now: number): ReloadAction {
  if (entry.phase !== "recapping") return { type: "wait" };
  if (signals.doneContent === null) {
    if (now - entry.startedAt >= RECAP_TIMEOUT_MS) {
      return { type: "fail", error: "timeout : claude n'a pas terminé le récap" };
    }
    return { type: "wait" };
  }
  const handoff = signals.handoffContent;
  if (handoff === null || handoff.trim() === "") {
    return { type: "fail", error: "handoff vide ou illisible" };
  }
  return { type: "clear", handoff };
}
