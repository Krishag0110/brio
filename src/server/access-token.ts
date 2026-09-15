import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "fde_workspace_access";
export const ACCESS_TTL_SECONDS = 12 * 60 * 60;
const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
export function localAccessAllowed(request: Request): boolean {
  if (process.env.FDE_LOCAL_ACCESS !== "true" && process.env.FDE_DEMO_MODE !== "true") return false;
  const url = new URL(request.url);
  const host = request.headers.get("host");
  try { return loopback(url.hostname) && (!host || loopback(new URL(`http://${host}`).hostname)); } catch { return false; }
}
export function serviceSecret(): string {
  const secret = process.env.CONTROL_SERVICE_SECRET;
  if (!secret || secret.length < 32) throw new Error("access_configuration_required");
  return secret;
}
export function verifyAccessCode(code: unknown): boolean {
  const expected = process.env.CONTROL_ACCESS_PASSWORD;
  serviceSecret();
  if (!expected || expected.length < 12) throw new Error("access_configuration_required");
  if (typeof code !== "string" || code.length > 1024) return false;
  return timingSafeEqual(createHash("sha256").update(code).digest(), createHash("sha256").update(expected).digest());
}
export function createAccessToken(now = Date.now()): string {
  // Binding the signature to the password invalidates existing sessions when it changes.
  const payload = String(Math.floor(now / 1000) + ACCESS_TTL_SECONDS);
  const signature = createHmac("sha256", serviceSecret()).update(`access:v1:${process.env.CONTROL_ACCESS_PASSWORD}:${payload}`).digest("hex");
  return `${payload}.${signature}`;
}
export function hasControlAccess(request: Request, now = Date.now()): boolean {
  if (localAccessAllowed(request)) return true;
  if (process.env.FDE_DEMO_MODE === "true") return false;
  const password = process.env.CONTROL_ACCESS_PASSWORD;
  if (!password || password.length < 12 || !process.env.CONTROL_SERVICE_SECRET || process.env.CONTROL_SERVICE_SECRET.length < 32) return false;
  const token = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${ACCESS_COOKIE}=`))?.slice(ACCESS_COOKIE.length + 1);
  if (!token || !/^\d{10,11}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expires, signature] = token.split(".");
  const seconds = Math.floor(now / 1000);
  if (Number(expires) <= seconds || Number(expires) > seconds + ACCESS_TTL_SECONDS) return false;
  const expected = createHmac("sha256", serviceSecret()).update(`access:v1:${password}:${expires}`).digest();
  return timingSafeEqual(Buffer.from(signature, "hex"), expected);
}
