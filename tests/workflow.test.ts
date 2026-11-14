import { describe, expect, it } from "vitest";
import type { ReportStatus, Role } from "@/lib/constants";
import { nextTransition, type WorkflowPerson, type WorkflowReport } from "@/lib/reports/workflow";

// The org: dev → lead → manager → ceo.
const ceo: WorkflowPerson = { id: "ceo", role: "CEO", reportsTo: null };
const manager: WorkflowPerson = { id: "manager", role: "MANAGER", reportsTo: "ceo" };
const lead: WorkflowPerson = { id: "lead", role: "TEAM_LEAD", reportsTo: "manager" };
const dev: WorkflowPerson = { id: "dev", role: "DEVELOPER", reportsTo: "lead" };
const stranger: WorkflowPerson = { id: "stranger", role: "TEAM_LEAD", reportsTo: "manager" };

const report = (status: ReportStatus, currentApproverId: string | null = null): WorkflowReport => ({
  status,
  currentApproverId,
});

describe("submitting", () => {
  it.each([
    ["DRAFT", dev, "lead"],
    ["CHANGES_REQUESTED", dev, "lead"],
    ["DRAFT", lead, "manager"],
    ["DRAFT", manager, "ceo"],
  ] as const)("a %s report by %o goes to %s", (status, owner, approver) => {
    expect(nextTransition(report(status), owner, owner, "submit")).toEqual({
      status: "SUBMITTED",
      currentApproverId: approver,
      trailAction: "SUBMITTED",
      timestamp: "submittedAt",
    });
  });

  it("can only be done by the owner", () => {
    expect(() => nextTransition(report("DRAFT"), dev, lead, "submit")).toThrow(
      expect.objectContaining({ code: "NOT_ALLOWED" }),
    );
  });

  it.each(["SUBMITTED", "LEAD_APPROVED", "MANAGER_APPROVED"] as const)(
    "can't happen again once %s",
    (status) => {
      expect(() => nextTransition(report(status, "lead"), dev, dev, "submit")).toThrow(
        expect.objectContaining({ code: "INVALID_TRANSITION" }),
      );
    },
  );

  it("needs someone to submit to", () => {
    expect(() => nextTransition(report("DRAFT"), ceo, ceo, "submit")).toThrow(
      expect.objectContaining({ code: "NO_APPROVER" }),
    );
  });
});

describe("approving", () => {
  it("passes a developer's report from the Team Lead to the Manager", () => {
    expect(nextTransition(report("SUBMITTED", "lead"), dev, lead, "approve")).toEqual({
      status: "LEAD_APPROVED",
      currentApproverId: "manager",
      trailAction: "LEAD_APPROVED",
      timestamp: "leadApprovedAt",
    });
  });

  it("finishes a developer's report when the Manager approves", () => {
    expect(nextTransition(report("LEAD_APPROVED", "manager"), dev, manager, "approve")).toEqual({
      status: "MANAGER_APPROVED",
      currentApproverId: null,
      trailAction: "MANAGER_APPROVED",
      timestamp: "managerApprovedAt",
    });
  });

  it("finishes a Team Lead's report in one step", () => {
    expect(nextTransition(report("SUBMITTED", "manager"), lead, manager, "approve")).toMatchObject({
      status: "MANAGER_APPROVED",
      currentApproverId: null,
      trailAction: "MANAGER_APPROVED",
    });
  });

  it("records the CEO's step on a Manager's report as an acknowledgement", () => {
    expect(nextTransition(report("SUBMITTED", "ceo"), manager, ceo, "approve")).toMatchObject({
      status: "MANAGER_APPROVED",
      trailAction: "CEO_ACKNOWLEDGED",
    });
  });

  it.each([
    ["the owner", dev],
    ["another Team Lead", stranger],
    ["the Manager, before the Team Lead", manager],
    ["the CEO", ceo],
  ])("is refused for %s", (_label, actor) => {
    expect(() => nextTransition(report("SUBMITTED", "lead"), dev, actor, "approve")).toThrow(
      expect.objectContaining({ code: "NOT_ALLOWED" }),
    );
  });

  it.each(["DRAFT", "CHANGES_REQUESTED", "MANAGER_APPROVED"] as const)(
    "is refused for a %s report",
    (status) => {
      expect(() => nextTransition(report(status, "lead"), dev, lead, "approve")).toThrow(
        expect.objectContaining({ code: "INVALID_TRANSITION" }),
      );
    },
  );

  it("needs a Manager above the Team Lead", () => {
    const orphanLead = { ...lead, reportsTo: null };
    expect(() =>
      nextTransition(report("SUBMITTED", "lead"), dev, orphanLead, "approve"),
    ).toThrow(expect.objectContaining({ code: "NO_APPROVER" }));
  });
});

describe("requesting changes", () => {
  it.each([
    ["SUBMITTED", "lead", lead],
    ["LEAD_APPROVED", "manager", manager],
  ] as const)("sends a %s report back to its owner", (status, approver, actor) => {
    expect(nextTransition(report(status, approver), dev, actor, "requestChanges", "Fix Tuesday")).toEqual({
      status: "CHANGES_REQUESTED",
      currentApproverId: null,
      trailAction: "CHANGES_REQUESTED",
      timestamp: null,
    });
  });

  it.each([undefined, "", "   "])("requires a comment (%o)", (comment) => {
    expect(() =>
      nextTransition(report("SUBMITTED", "lead"), dev, lead, "requestChanges", comment),
    ).toThrow(expect.objectContaining({ code: "COMMENT_REQUIRED" }));
  });

  it("is only for the current approver", () => {
    expect(() =>
      nextTransition(report("SUBMITTED", "lead"), dev, manager, "requestChanges", "No"),
    ).toThrow(expect.objectContaining({ code: "NOT_ALLOWED" }));
  });
});

describe("whole chains", () => {
  function run(owner: WorkflowPerson, approvers: WorkflowPerson[]) {
    let state = report("DRAFT");
    const statuses: string[] = [];
    const apply = (actor: WorkflowPerson, action: "submit" | "approve") => {
      const next = nextTransition(state, owner, actor, action);
      state = { status: next.status, currentApproverId: next.currentApproverId };
      statuses.push(next.status);
    };
    apply(owner, "submit");
    for (const approver of approvers) apply(approver, "approve");
    return statuses;
  }
  const chains: [string, WorkflowPerson, WorkflowPerson[], string[]][] = [
    ["Developer", dev, [lead, manager], ["SUBMITTED", "LEAD_APPROVED", "MANAGER_APPROVED"]],
    ["Team Lead", lead, [manager], ["SUBMITTED", "MANAGER_APPROVED"]],
    ["Manager", manager, [ceo], ["SUBMITTED", "MANAGER_APPROVED"]],
  ];
  it.each(chains)("%s: the full chain ends approved", (_label, owner, approvers, expected) => {
    expect(run(owner, approvers)).toEqual(expected);
  });

  it("a report sent back can be resubmitted and approved", () => {
    const back = nextTransition(report("LEAD_APPROVED", "manager"), dev, manager, "requestChanges", "x");
    const again = nextTransition(
      { status: back.status, currentApproverId: back.currentApproverId },
      dev,
      dev,
      "submit",
    );
    expect(again).toMatchObject({ status: "SUBMITTED", currentApproverId: "lead" });
  });
});

// Keeps the role type referenced so the fixtures above stay in sync with it.
const roles: Role[] = [ceo.role, manager.role, lead.role, dev.role];
void roles;
