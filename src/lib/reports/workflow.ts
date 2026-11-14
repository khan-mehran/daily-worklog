// The weekly report state machine. Pure, so every rule is unit-tested without a database.
//
//   DRAFT ──submit──▶ SUBMITTED ──approve──▶ LEAD_APPROVED ──approve──▶ MANAGER_APPROVED
//     ▲                   │                        │
//     └── (owner edits) ◀─┴──request changes───────┘  CHANGES_REQUESTED
//
// Who approves follows reportsTo. A Developer's report needs the Team Lead, then the Manager. A
// Team Lead's report needs only the Manager. A Manager's report goes straight to the CEO, who
// acknowledges it.

import { EDITABLE_STATUSES, type ReportStatus, type Role } from "@/lib/constants";
import type { TrailAction } from "@/models/WeeklyReport";

export type WorkflowAction = "submit" | "approve" | "requestChanges";

export interface WorkflowPerson {
  id: string;
  role: Role;
  reportsTo: string | null;
}

export interface WorkflowReport {
  status: ReportStatus;
  currentApproverId: string | null;
}

export type Timestamp = "submittedAt" | "leadApprovedAt" | "managerApprovedAt";

export interface Transition {
  status: ReportStatus;
  currentApproverId: string | null;
  trailAction: TrailAction;
  timestamp: Timestamp | null;
}

export class WorkflowError extends Error {
  constructor(
    readonly code: "NOT_ALLOWED" | "INVALID_TRANSITION" | "COMMENT_REQUIRED" | "NO_APPROVER",
    message: string,
  ) {
    super(message);
  }
}

export const isEditableStatus = (status: ReportStatus) => EDITABLE_STATUSES.includes(status);

const AWAITING_REVIEW: readonly ReportStatus[] = ["SUBMITTED", "LEAD_APPROVED"];
export const isAwaitingReview = (status: ReportStatus) => AWAITING_REVIEW.includes(status);

/**
 * Works out the next state, or throws. `actor` is the person acting; `owner` owns the report.
 * The caller must still apply the result atomically, conditioned on the state it read.
 */
export function nextTransition(
  report: WorkflowReport,
  owner: WorkflowPerson,
  actor: WorkflowPerson,
  action: WorkflowAction,
  comment?: string | null,
): Transition {
  if (action === "submit") {
    if (actor.id !== owner.id) throw new WorkflowError("NOT_ALLOWED", "Only the owner can submit a report.");
    if (!isEditableStatus(report.status)) {
      throw new WorkflowError("INVALID_TRANSITION", "This week has already been submitted.");
    }
    if (!owner.reportsTo) throw new WorkflowError("NO_APPROVER", "You have no approver to submit to.");
    return {
      status: "SUBMITTED",
      currentApproverId: owner.reportsTo,
      trailAction: "SUBMITTED",
      timestamp: "submittedAt",
    };
  }

  if (report.currentApproverId !== actor.id) {
    throw new WorkflowError("NOT_ALLOWED", "This report isn't waiting for your review.");
  }
  if (!isAwaitingReview(report.status)) {
    throw new WorkflowError("INVALID_TRANSITION", "This report isn't waiting for review.");
  }

  if (action === "requestChanges") {
    if (!comment?.trim()) {
      throw new WorkflowError("COMMENT_REQUIRED", "Say what needs to change.");
    }
    return {
      status: "CHANGES_REQUESTED",
      currentApproverId: null,
      trailAction: "CHANGES_REQUESTED",
      timestamp: null,
    };
  }

  // A Developer's report goes from the Team Lead to the Manager. Every other approval is final.
  if (report.status === "SUBMITTED" && owner.role === "DEVELOPER") {
    if (!actor.reportsTo) {
      throw new WorkflowError("NO_APPROVER", "There's no Manager to pass this report to.");
    }
    return {
      status: "LEAD_APPROVED",
      currentApproverId: actor.reportsTo,
      trailAction: "LEAD_APPROVED",
      timestamp: "leadApprovedAt",
    };
  }
  return {
    status: "MANAGER_APPROVED",
    currentApproverId: null,
    trailAction: owner.role === "MANAGER" ? "CEO_ACKNOWLEDGED" : "MANAGER_APPROVED",
    timestamp: "managerApprovedAt",
  };
}
