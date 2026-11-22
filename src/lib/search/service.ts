import { ORG_WIDE_ROLES, seesAllDepartments } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { canViewPeople, projectScope, scopeFor, type Actor } from "@/lib/permissions";
import { dayString } from "@/lib/reports/iso-week";

const PER_GROUP = 5;

/**
 * The command palette's search. Every group uses the same rules as its own page: projects the
 * person can open, people in their department (Team Leads and up), and their own tasks.
 */
export async function search(actor: Actor, selectedDepartmentId: string | null, query: string) {
  const matches = { contains: query, mode: "insensitive" } as const;
  const [projects, people, tasks] = await Promise.all([
    prisma.project.findMany({
      where: { ...projectScope(actor, selectedDepartmentId), OR: [{ name: matches }, { code: matches }] },
      select: { id: true, name: true, code: true, color: true },
      take: PER_GROUP,
    }),
    canViewPeople(actor)
      ? prisma.user.findMany({
          where: {
            ...scopeFor(actor, selectedDepartmentId),
            role: { notIn: [...ORG_WIDE_ROLES] },
            approval: "APPROVED",
            OR: [{ name: matches }, { email: matches }],
          },
          select: { id: true, name: true, role: true, avatarColor: true },
          take: PER_GROUP,
        })
      : Promise.resolve([]),
    seesAllDepartments(actor.role)
      ? Promise.resolve([])
      : prisma.task.findMany({
          where: { userId: actor.id, details: matches },
          orderBy: { date: "desc" },
          select: { id: true, details: true, date: true },
          take: PER_GROUP,
        }),
  ]);
  return {
    projects: projects.map((project) => ({
      id: project.id,
      title: project.name,
      subtitle: project.code,
      color: project.color,
      href: `/projects/${project.id}`,
    })),
    people: people.map((person) => ({
      id: person.id,
      title: person.name,
      subtitle: person.role as string,
      color: person.avatarColor,
      href: `/team?highlight=${person.id}`,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.details.length > 80 ? `${task.details.slice(0, 80)}…` : task.details,
      subtitle: dayString(task.date),
      color: null,
      href: `/tasks?date=${dayString(task.date)}`,
    })),
  };
}

export type SearchResults = Awaited<ReturnType<typeof search>>;
