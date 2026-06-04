import type { Terminal } from "@xterm/xterm";

const registry = new Map<string, Terminal>();

export function registerTerm(id: string, term: Terminal): void {
  registry.set(id, term);
}

export function unregisterTerm(id: string): void {
  registry.delete(id);
}

export function getTerm(id: string): Terminal | undefined {
  return registry.get(id);
}
