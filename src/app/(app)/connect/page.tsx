import type { Metadata } from "next";
import { ConnectDevice } from "@/components/settings/connect-device";
import { requirePageUser } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Connect this computer" };

type Query = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Where `worklog-sync.mjs --setup` sends the browser. The token is only ever posted to 127.0.0.1
 * on the port the script is listening on, so a link from anywhere else can't collect it.
 */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requirePageUser();
  const query = await searchParams;
  const port = Number(first(query.port));
  const state = first(query.state);
  const valid =
    Number.isInteger(port) && port >= 1024 && port <= 65535 && /^[A-Za-z0-9_-]{16,128}$/.test(state);
  const name = first(query.name).trim().slice(0, 60) || "My computer";

  return <ConnectDevice target={valid ? { port, state } : null} name={name} />;
}
