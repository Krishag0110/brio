import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasControlAccess } from "./access-token";
import { assertSameOrigin } from "./http";

export function assertControlAccess(request: Request): void {
  assertSameOrigin(request);
  if (!hasControlAccess(request)) throw new Error("unauthorized");
}
export async function requireControlAccess(): Promise<void> {
  const incoming = await headers();
  const protocol = incoming.get("x-forwarded-proto") === "https" ? "https" : "http";
  const request = new Request(`${protocol}://${incoming.get("host") || "unconfigured.invalid"}/`, { headers: incoming });
  if (!hasControlAccess(request)) redirect("/access");
}
