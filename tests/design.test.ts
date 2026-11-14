import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

describe("design system", () => {
  it("uses no gradients anywhere", () => {
    const offenders = sourceFiles(join(process.cwd(), "src")).filter((file) =>
      /gradient|bg-linear|bg-radial|bg-conic/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
