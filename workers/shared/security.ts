import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { encryptedSessionSchema, grantSchema, type EncryptedSession, type WorkerGrant } from "./contracts";

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function requireSecret(value: string | undefined, name: string): string {
  if (!value || value.length < 32) throw new Error(`configuration_required:${name}`);
  return value;
}
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function signGrant(grant: WorkerGrant, secret: string): string {
  requireSecret(secret, "grant_secret");
  const payload = Buffer.from(JSON.stringify(grantSchema.parse(grant))).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export function verifyGrant(token: string, secret: string, now = Date.now()): WorkerGrant {
  requireSecret(secret, "grant_secret");
  if (token.length > 8192) throw new Error("invalid_grant");
  const parts = token.split(".");
  if (parts.length !== 2 || !safeEqual(createHmac("sha256", secret).update(parts[0]).digest("base64url"), parts[1])) throw new Error("invalid_grant");
  const grant = grantSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
  if (grant.exp <= now || grant.exp > now + 5 * 60_000) throw new Error("expired_or_unbounded_grant");
  return grant;
}

const cookieSchema = z.object({
  name: z.enum(["auth_token", "ct0"]), value: z.string().min(1).max(4096),
  domain: z.enum([".x.com", "x.com", ".twitter.com", "twitter.com"]), path: z.literal("/"),
  expires: z.number(), httpOnly: z.boolean(), secure: z.literal(true), sameSite: z.enum(["Strict", "Lax", "None"]),
}).strict();
export const storageStateSchema = z.object({ cookies: z.array(cookieSchema).min(2).max(4), origins: z.array(z.never()).max(0) }).strict()
  .superRefine((state, ctx) => {
    for (const name of ["auth_token", "ct0"]) if (!state.cookies.some(c => c.name === name)) ctx.addIssue({ code: "custom", message: `missing_${name}` });
    if (new Set(state.cookies.map(c => `${c.domain}:${c.name}`)).size !== state.cookies.length) ctx.addIssue({ code: "custom", message: "duplicate_cookie" });
  });
export type SessionState = z.infer<typeof storageStateSchema>;
type Binding = Pick<EncryptedSession, "workspaceId" | "accountId" | "connectionId" | "connectionVersion">;
const aad = (binding: Binding) => Buffer.from(JSON.stringify([binding.workspaceId, binding.accountId, binding.connectionId, binding.connectionVersion]));
function keyBytes(key: string): Buffer {
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32) throw new Error("configuration_required:session_key_32_bytes_base64");
  return bytes;
}
export function encryptSession(state: SessionState, binding: Binding, key: string, keyVersion: string): EncryptedSession {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keyBytes(key), nonce);
  cipher.setAAD(aad(binding));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(storageStateSchema.parse(state)), "utf8"), cipher.final()]);
  return { algorithm: "AES-256-GCM", keyVersion, nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64"), workspaceId: binding.workspaceId, accountId: binding.accountId, connectionId: binding.connectionId, connectionVersion: binding.connectionVersion };
}
export function decryptSession(raw: EncryptedSession, binding: Binding, keys: Record<string, string>): SessionState {
  const encrypted = encryptedSessionSchema.parse(raw);
  if (!safeEqual(aad(encrypted).toString(), aad(binding).toString())) throw new Error("session_binding_mismatch");
  const key = keys[encrypted.keyVersion];
  if (!key) throw new Error("session_key_version_unavailable");
  const nonce = Buffer.from(encrypted.nonce, "base64"), tag = Buffer.from(encrypted.tag, "base64");
  if (nonce.length !== 12 || tag.length !== 16) throw new Error("invalid_ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), nonce);
  decipher.setAAD(aad(binding)); decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]);
  try { return storageStateSchema.parse(JSON.parse(plaintext.toString("utf8"))); } finally { plaintext.fill(0); }
}
export function callbackSignature(body: string, timestamp: string, secret: string): string {
  requireSecret(secret, "callback_secret");
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}
export function verifyCallback(body: string, timestamp: string, signature: string, secret: string, now = Date.now()): boolean {
  return Number.isFinite(Number(timestamp)) && Math.abs(now - Number(timestamp)) <= 60_000 && safeEqual(callbackSignature(body, timestamp, secret), signature);
}
