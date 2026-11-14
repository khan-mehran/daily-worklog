import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { departmentCollectionScope, scopeFor, type Actor } from "@/lib/permissions";

const IT = new Types.ObjectId().toString();
const HR = new Types.ObjectId().toString();
const actor = (role: Actor["role"], departmentId: string | null): Actor => ({
  id: new Types.ObjectId().toString(),
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

  it("returns real ObjectIds, because aggregation pipelines do not cast strings", () => {
    expect(scopeFor(actor("MANAGER", IT)).departmentId).toBeInstanceOf(Types.ObjectId);
    expect(scopeFor(actor("CEO", null), HR).departmentId).toBeInstanceOf(Types.ObjectId);
  });

  it("gives an unassigned manager nothing, rather than everything with a null department", () => {
    expect(scopeFor(actor("MANAGER", null))).toEqual({ departmentId: { $in: [] } });
  });
});

describe("departmentCollectionScope", () => {
  it("is open for the CEO and limited to their own _id for others", () => {
    expect(departmentCollectionScope(actor("CEO", null))).toEqual({});
    expect(String(departmentCollectionScope(actor("DEVELOPER", IT))._id)).toBe(IT);
    expect(departmentCollectionScope(actor("MANAGER", null))).toEqual({ _id: { $in: [] } });
  });
});
