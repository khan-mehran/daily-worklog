import bcrypt from "bcryptjs";

const ROUNDS = 12;
// Compared against when the account doesn't exist, so response time doesn't reveal which emails do.
const DUMMY_HASH = "$2b$12$CwTycUXWue0Thq9StjUM0uJ8Zf1Y6m3C0o1v0m8vK1QG1n9oWQq2a";

export const hashPassword = (password: string) => bcrypt.hash(password, ROUNDS);

export async function verifyPassword(password: string, hash: string | null | undefined) {
  const matches = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return Boolean(hash) && matches;
}
