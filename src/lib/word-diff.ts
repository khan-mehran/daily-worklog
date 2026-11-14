export interface DiffPart {
  text: string;
  kind: "same" | "removed" | "added";
}

/**
 * A word-level diff by longest common subsequence. Inputs are capped at 1000 characters, so the
 * quadratic table stays small.
 */
export function wordDiff(before: string, after: string): { before: DiffPart[]; after: DiffPart[] } {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const left: DiffPart[] = [];
  const right: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      left.push({ text: a[i]!, kind: "same" });
      right.push({ text: b[j]!, kind: "same" });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      left.push({ text: a[i++]!, kind: "removed" });
    } else {
      right.push({ text: b[j++]!, kind: "added" });
    }
  }
  while (i < a.length) left.push({ text: a[i++]!, kind: "removed" });
  while (j < b.length) right.push({ text: b[j++]!, kind: "added" });
  return { before: left, after: right };
}
