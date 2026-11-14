import { Types } from "mongoose";
import { canViewPeople, projectScope, scopeFor, type Actor } from "@/lib/permissions";
import { dayString } from "@/lib/reports/iso-week";
import { escapeRegex } from "@/lib/utils";
import { Project, Task, User } from "@/models";

const PER_GROUP = 5;

/**
 * The command palette's search. Every group uses the same rules as its own page: projects the
 * person can open, people in their department (Team Leads and up), and their own tasks.
 */
export async function search(actor: Actor, selectedDepartmentId: string | null, query: string) {
  const pattern = { $regex: escapeRegex(query), $options: "i" };
  const [projects, people, tasks] = await Promise.all([
    Project.find({ ...projectScope(actor, selectedDepartmentId), $or: [{ name: pattern }, { code: pattern }] })
      .select("name code color")
      .limit(PER_GROUP)
      .lean(),
    canViewPeople(actor)
      ? User.find({ ...scopeFor(actor, selectedDepartmentId), role: { $ne: "CEO" }, $or: [{ name: pattern }, { email: pattern }] })
          .select("name role avatarColor")
          .limit(PER_GROUP)
          .lean()
      : Promise.resolve([]),
    actor.role === "CEO"
      ? Promise.resolve([])
      : Task.find({ userId: new Types.ObjectId(actor.id), details: pattern })
          .sort({ date: -1 })
          .select("details date")
          .limit(PER_GROUP)
          .lean(),
  ]);
  return {
    projects: projects.map((project) => ({
      id: String(project._id),
      title: project.name,
      subtitle: project.code,
      color: project.color,
      href: `/projects/${project._id}`,
    })),
    people: people.map((person) => ({
      id: String(person._id),
      title: person.name,
      subtitle: person.role,
      color: person.avatarColor,
      href: `/team?highlight=${person._id}`,
    })),
    tasks: tasks.map((task) => ({
      id: String(task._id),
      title: task.details.length > 80 ? `${task.details.slice(0, 80)}…` : task.details,
      subtitle: dayString(task.date),
      color: null,
      href: `/tasks?date=${dayString(task.date)}`,
    })),
  };
}

export type SearchResults = Awaited<ReturnType<typeof search>>;
