import { redirect } from "next/navigation";

// The analyst dashboard is now the console's Overview.
export default async function Details({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const q = new URLSearchParams(await searchParams).toString();
  redirect(q ? `/?${q}` : "/");
}
