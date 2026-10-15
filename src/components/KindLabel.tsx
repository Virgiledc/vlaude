import type { SessionLaunchKind } from "../store/sessions";

const LABEL: Partial<Record<SessionLaunchKind, string>> = {
  claudex: "gpt",
  codex: "codex",
  omp: "omp",
};

export function KindLabel({ kind }: { kind?: SessionLaunchKind }) {
  const label = kind ? LABEL[kind] : undefined;
  return label ? <span className="vl-kind">{label}</span> : null;
}
