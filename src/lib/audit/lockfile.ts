import { valid } from "semver";
import { AuditError } from "./errors";

/** Every installed version of every package: what the advisory lookup is asked about. */
export type InstalledPackages = Map<string, Set<string>>;

interface LockPackage {
  name?: string;
  version?: string;
  link?: boolean;
}

interface LegacyDependency {
  version?: string;
  dependencies?: Record<string, LegacyDependency>;
}

function add(installed: InstalledPackages, name: string, version: string | undefined) {
  // Git, file and tarball dependencies have no registry version, so no advisory can match them.
  if (!name || !version || !valid(version)) return;
  const versions = installed.get(name) ?? new Set<string>();
  versions.add(version);
  installed.set(name, versions);
}

function addLegacy(installed: InstalledPackages, dependencies: Record<string, LegacyDependency>) {
  for (const [key, entry] of Object.entries(dependencies)) {
    // An alias is stored as "npm:real-name@1.2.3".
    const alias = /^npm:(.+)@([^@]+)$/.exec(entry.version ?? "");
    if (alias) add(installed, alias[1]!, alias[2]);
    else add(installed, key, entry.version);
    if (entry.dependencies) addLegacy(installed, entry.dependencies);
  }
}

/**
 * Reads a package-lock.json (any lockfileVersion) or npm-shrinkwrap.json. Development
 * dependencies are included, as `npm audit` includes them. Throws on text that isn't a lockfile.
 */
export function installedPackages(lockfile: string): InstalledPackages {
  let lock: { packages?: Record<string, LockPackage>; dependencies?: Record<string, LegacyDependency> };
  try {
    lock = JSON.parse(lockfile);
  } catch {
    throw new AuditError("package-lock.json isn't valid JSON.");
  }
  if (!lock || typeof lock !== "object" || (!lock.packages && !lock.dependencies)) {
    throw new AuditError("package-lock.json lists no packages.");
  }

  const installed: InstalledPackages = new Map();
  if (lock.packages) {
    for (const [path, entry] of Object.entries(lock.packages)) {
      // "" is the project itself, a path outside node_modules is a workspace, and a link points
      // at one. None of them come from the registry.
      const marker = path.lastIndexOf("node_modules/");
      if (marker === -1 || entry.link) continue;
      // An aliased package carries its real name.
      add(installed, entry.name ?? path.slice(marker + "node_modules/".length), entry.version);
    }
  } else if (lock.dependencies) {
    addLegacy(installed, lock.dependencies);
  }
  return installed;
}
