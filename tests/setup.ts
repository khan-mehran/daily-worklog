import { vi } from "vitest";

// next-auth imports Next's server runtime, which isn't available here. Tests act as a user through
// signInAs in helpers.ts, which is the same session lookup handlers use in production.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

// No SMTP server in tests. Sent mail is inspected through this mock.
vi.mock("@/lib/email", () => ({ sendEmailSafely: vi.fn(async () => true) }));
