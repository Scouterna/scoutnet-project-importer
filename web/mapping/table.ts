import { groupKey, resembles } from "./values.ts";

export type ValueEntry = {
  key: string;
  value: string;
  variants: string[];
  rows: number;
  auto: string | null;
  suggestion: string | null;
};

const MAX_VARIANTS = 5;

/** `texts` has one entry per matched row; the caller leaves out empty cells (blank strings are ignored here too). */
export const buildValueTable = (
  texts: string[],
  options: { id: string; label: string }[],
): ValueEntry[] => {
  const groups = new Map<string, { rows: number; spellings: Map<string, number> }>();
  for (const raw of texts) {
    const text = raw.trim();
    if (text === "") continue;
    const key = groupKey(text);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { rows: 0, spellings: new Map() }));
    g.rows++;
    g.spellings.set(text, (g.spellings.get(text) ?? 0) + 1);
  }
  const keyed = options.map((o) => ({ id: o.id, key: groupKey(o.label) }));
  return [...groups]
    .map(([key, g]) => {
      const spellings = [...g.spellings].sort((a, b) => b[1] - a[1]).map(([s]) => s);
      const auto = key === "" ? null : (keyed.find((o) => o.key === key)?.id ?? null);
      let suggestion: string | null = null;
      if (auto === null && key !== "") {
        const hits = keyed.filter((o) => o.key !== "" && resembles(key, o.key));
        if (hits.length === 1) suggestion = hits[0]!.id;
      }
      return {
        key,
        value: spellings[0]!,
        variants: spellings.slice(1, 1 + MAX_VARIANTS),
        rows: g.rows,
        auto,
        suggestion,
      };
    })
    .sort((a, b) => b.rows - a.rows);
};
