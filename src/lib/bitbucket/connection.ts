import { badRequest, forbidden } from "@/lib/api/errors";
import { listRepositories, siteCredentials, workspaceList, type BitbucketCredentials } from "@/lib/audit/bitbucket";
import { AuditError } from "@/lib/audit/errors";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db/prisma";
import type { Actor, DepartmentScope } from "@/lib/permissions";
import type { BitbucketConnectionInput } from "@/validators/bitbucket";

// A department's own Bitbucket account. Its manager saves a token on the Settings page; the token
// is stored encrypted and never sent back to the browser. It reads the department's lockfiles for
// the dependency audit and lists the repositories to import as projects. A department without one
// falls back to the organisation-wide token from Site settings, for the audit only.

/**
 * The department whose Bitbucket connection the actor looks after: their own for a Manager, and
 * the one they lead for a Super Admin. Nobody else gets near the token.
 */
export async function bitbucketDepartmentOf(actor: Actor): Promise<string | null> {
  if (actor.role === "MANAGER") return actor.departmentId;
  if (actor.role !== "SUPER_ADMIN") return null;
  const led = await prisma.department.findFirst({ where: { managerId: actor.id }, select: { id: true } });
  return led?.id ?? null;
}

async function requireDepartment(actor: Actor) {
  const departmentId = await bitbucketDepartmentOf(actor);
  if (!departmentId) throw forbidden("Only a department's manager connects its Bitbucket account.");
  return departmentId;
}

const UNREADABLE = "The saved Bitbucket token can't be read any more. Enter it again in Settings.";

/** What the Settings page shows. Never the token. */
export async function getBitbucketConnection(actor: Actor) {
  const departmentId = await bitbucketDepartmentOf(actor);
  if (!departmentId) return null;
  const connection = await prisma.bitbucketConnection.findUnique({ where: { departmentId } });
  if (!connection) return { connected: false as const };
  return {
    connected: true as const,
    username: connection.username,
    workspace: connection.workspace,
    updatedAt: connection.updatedAt.toISOString(),
    /** False after AUTH_SECRET changed: the token has to be entered again. */
    readable: decryptSecret(connection.tokenCipher) !== null,
  };
}

export type BitbucketConnectionView = NonNullable<Awaited<ReturnType<typeof getBitbucketConnection>>>;

/** Saves the connection once Bitbucket has accepted it, so a mistyped token is caught here. */
export async function saveBitbucketConnection(actor: Actor, input: BitbucketConnectionInput) {
  const departmentId = await requireDepartment(actor);
  const existing = await prisma.bitbucketConnection.findUnique({ where: { departmentId } });
  const token = input.token ?? (existing ? decryptSecret(existing.tokenCipher) : null);
  if (!token) throw badRequest(existing ? "Enter the token again." : "Enter a Bitbucket token.");
  const username = input.username === undefined ? (existing?.username ?? null) : input.username;
  const workspace = input.workspace === undefined ? (existing?.workspace ?? null) : input.workspace;

  try {
    // Each named workspace is tried, so a mistyped one is caught here and not at the import.
    const named = workspaceList(workspace);
    for (const each of named.length > 0 ? named.map((one) => [one]) : [[]]) {
      await listRepositories({ token, username }, each, 1);
    }
  } catch (error) {
    if (error instanceof AuditError) throw badRequest(error.message, "BITBUCKET_REJECTED");
    throw error;
  }

  const data = { username, workspace, tokenCipher: encryptSecret(token), connectedBy: actor.id };
  await prisma.bitbucketConnection.upsert({ where: { departmentId }, create: { departmentId, ...data }, update: data });
  // Never the token, nor anything derived from it.
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "bitbucket.connect",
      targetType: "Department",
      targetId: departmentId,
      meta: { username, workspace, tokenChanged: Boolean(input.token) },
    },
  });
}

export async function deleteBitbucketConnection(actor: Actor) {
  const departmentId = await requireDepartment(actor);
  const { count } = await prisma.bitbucketConnection.deleteMany({ where: { departmentId } });
  if (count === 0) return;
  await prisma.auditLog.create({
    data: { actorId: actor.id, action: "bitbucket.disconnect", targetType: "Department", targetId: departmentId, meta: {} },
  });
}

/**
 * The department's own account, for importing: credentials and the workspaces to import from.
 * Null when it hasn't connected one.
 */
export async function departmentConnection(departmentId: string) {
  const connection = await prisma.bitbucketConnection.findUnique({ where: { departmentId } });
  if (!connection) return null;
  const token = decryptSecret(connection.tokenCipher);
  if (token === null) throw new AuditError(UNREADABLE);
  const credentials: BitbucketCredentials = { token, username: connection.username };
  return { credentials, workspaces: workspaceList(connection.workspace) };
}

/** What the audit reads a department's repositories with: its own account, or else the site's. */
export async function credentialsFor(departmentId: string): Promise<BitbucketCredentials | null> {
  return (await departmentConnection(departmentId))?.credentials ?? siteCredentials();
}

/** Whether anything in this scope can be audited at all. */
export async function bitbucketConfigured(scope: DepartmentScope = {}) {
  if (siteCredentials()) return true;
  return (await prisma.bitbucketConnection.count({ where: scope })) > 0;
}

/** The departments the daily run can check: all of them with a site token, or those connected. */
export async function auditableDepartments(): Promise<"all" | string[]> {
  if (siteCredentials()) return "all";
  const connections = await prisma.bitbucketConnection.findMany({ select: { departmentId: true } });
  return connections.map((connection) => connection.departmentId);
}
