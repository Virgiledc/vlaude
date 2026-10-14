export interface Recent { path: string; at: number }
export interface DirHit { path: string; score: number; hits: number[]; recent?: Recent }

export const RECENTS_MAX = 40;

export const parseRecents = (raw: string | null): Recent[] => {
  let data: unknown;
  try { data = JSON.parse(raw || "[]"); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: Recent[] = [];
  for (const d of data) {
    const r: Recent | null =
      typeof d === "string" ? { path: d, at: 0 }
      : d && typeof d.path === "string" ? { path: d.path, at: Number(d.at) || 0 }
      : null;
    if (!r || !r.path || seen.has(r.path)) continue;
    seen.add(r.path);
    out.push(r);
  }
  return out;
};

export const addRecent = (list: Recent[], path: string, now: number): Recent[] =>
  [{ path, at: now }, ...list.filter((r) => r.path !== path)].slice(0, RECENTS_MAX);

const BOUNDARY = "/-_. ";
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

const locate = (q: string, p: string, base: number): number[] | null => {
  const inName = p.indexOf(q, base);
  if (inName >= 0) return range(inName, q.length);
  const inPath = p.lastIndexOf(q);
  if (inPath >= 0) return range(inPath, q.length);
  const hits: number[] = [];
  let j = p.length - 1;
  for (let i = q.length - 1; i >= 0; i--) {
    while (j >= 0 && p[j] !== q[i]) j--;
    if (j < 0) return null;
    hits.push(j--);
  }
  return hits.reverse();
};

export const fuzzyMatch = (query: string, path: string): { score: number; hits: number[] } | null => {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return null;
  const p = path.toLowerCase();
  const base = p.lastIndexOf("/") + 1;
  const hits = locate(q, p, base);
  if (!hits) return null;
  const name = p.slice(base);
  let score = 0;
  hits.forEach((h, k) => {
    score += 1;
    if (k > 0 && hits[k - 1] === h - 1) score += 5;
    if (h === 0 || BOUNDARY.includes(p[h - 1])) score += 4;
    if (h >= base) score += 2;
  });
  if (name === q) score += 50;
  else if (name.startsWith(q)) score += 25;
  else if (name.includes(q)) score += 12;
  score -= path.split("/").length * 0.5 + path.length * 0.02;
  return { score, hits };
};

export const searchDirs = (query: string, recents: Recent[], index: string[], limit = 60): DirHit[] => {
  const byPath = new Map(recents.map((r) => [r.path, r]));
  const seen = new Set<string>();
  const out: DirHit[] = [];
  for (const path of [...byPath.keys(), ...index]) {
    if (seen.has(path)) continue;
    seen.add(path);
    const m = fuzzyMatch(query, path);
    if (!m) continue;
    const recent = byPath.get(path);
    out.push({ path, hits: m.hits, score: m.score + (recent ? 15 : 0), recent });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
};

const DAY = 24 * 3600_000;

export const recencyBucket = (at: number, now: number): string => {
  if (!at) return "Plus ancien";
  if (new Date(at).toDateString() === new Date(now).toDateString()) return "Aujourd'hui";
  if (now - at < 7 * DAY) return "Cette semaine";
  return "Plus ancien";
};

export const timeAgo = (at: number, now: number): string => {
  if (!at) return "";
  const m = Math.floor((now - at) / 60_000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "hier";
  if (d < 7) return `${d} j`;
  if (d < 30) return `${Math.floor(d / 7)} sem`;
  return `${Math.floor(d / 30)} mois`;
};

export const tildify = (path: string, home: string): string => {
  if (!home) return path;
  if (path === home) return "~";
  return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
};
