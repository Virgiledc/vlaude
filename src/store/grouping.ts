import type { Session } from "./sessions";

export interface PathGroup {
  cwd: string;
  label: string;
  sessions: Session[];
}

export function prettyCwd(cwd: string): string {
  return cwd.replace(/^\/home\/[^/]+/, "~");
}

export function groupByPath(sessions: Session[]): PathGroup[] {
  const order: string[] = [];
  const map = new Map<string, Session[]>();
  for (const sess of sessions) {
    if (!map.has(sess.cwd)) {
      map.set(sess.cwd, []);
      order.push(sess.cwd);
    }
    map.get(sess.cwd)!.push(sess);
  }
  return order.map((cwd) => ({ cwd, label: prettyCwd(cwd), sessions: map.get(cwd)! }));
}
