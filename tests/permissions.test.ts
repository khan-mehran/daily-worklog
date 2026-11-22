import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { departmentTableScope, scopeFor, type Actor } from "@/lib/permissions";

const IT = randomUUID();
const HR = randomUUID();
const actor = (role: Actor["role"], departmentId: string | null): Actor => ({
  id: randomUUID(),
  role,
  departmentId,
});

describe("scopeFor", () => {
  it("gives the CEO every department by default", () => {
    expect(scopeFor(actor("CEO", null))).toEqual({});
  });

  it("narrows the CEO to the department selected in the switcher", () => {
    expect(String(scopeFor(actor("CEO", null), HR).departmentId)).toBe(HR);
  });

  it("ignores a malformed selection instead of matching nothing or throwing", () => {
    expect(scopeFor(actor("CEO", null), "not-an-id")).toEqual({});
  });

  it.each(["MANAGER", "TEAM_LEAD", "DEVELOPER"] as const)(
    "locks a %s to their own department",
    (role) => {
      expect(String(scopeFor(actor(role, IT)).departmentId)).toBe(IT);
    },
  );

  it.each(["MANAGER", "TEAM_LEAD", "DEVELOPER"] as const)(
    "ignores a department requested by a %s",
    (role) => {
      expect(String(scopeFor(actor(role, IT), HR).departmentId)).toBe(IT);
    },
  );

  it("returns the id itself, ready for a Prisma where clause", () => {
    expect(scopeFor(actor("MANAGER", IT))).toEqual({ departmentId: IT });
    expect(scopeFor(actor("CEO", null), HR)).toEqual({ departmentId: HR });
  });

  it("gives an unassigned manager nothing, rather than everything with a null department", () => {
    expect(scopeFor(actor("MANAGER", null))).toEqual({ departmentId: { in: [] } });
  });
});

describe("departmentTableScope", () => {
  it("is open for the CEO and limited to their own id for others", () => {
    expect(departmentTableScope(actor("CEO", null))).toEqual({});
    expect(departmentTableScope(actor("DEVELOPER", IT))).toEqual({ id: IT });
    expect(departmentTableScope(actor("MANAGER", null))).toEqual({ id: { in: [] } });
  });
});
