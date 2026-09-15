import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { WorkerGrant } from "../shared/contracts";
import { encryptedRedditCredentialSchema, redditCredentialSchema, type EncryptedRedditCredential, type RedditCredential } from "../shared/reddit-contracts";
import { safeEqual } from "../shared/security";

type Binding = Pick<WorkerGrant, "workspaceId" | "accountId" | "connectionId" | "connectionVersion">;
const aad = (binding: Binding) => Buffer.from(JSON.stringify(["reddit_oauth", binding.workspaceId, binding.accountId, binding.connectionId, binding.connectionVersion]));
function keyBytes(value: string) {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("configuration_required:session_key_32_bytes_base64");
  return key;
}
export function encryptRedditCredential(value: RedditCredential, binding: Binding, key: string, keyVersion: string): EncryptedRedditCredential {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keyBytes(key), nonce);
  cipher.setAAD(aad(binding));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(redditCredentialSchema.parse(value)), "utf8"), cipher.final()]);
  return { purpose: "reddit_oauth", algorithm: "AES-256-GCM", keyVersion, nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64"), workspaceId: binding.workspaceId, accountId: binding.accountId, connectionId: binding.connectionId, connectionVersion: binding.connectionVersion };
}
export function decryptRedditCredential(raw: EncryptedRedditCredential, binding: Binding, keys: Record<string, string>): RedditCredential {
  const encrypted = encryptedRedditCredentialSchema.parse(raw);
  if (!safeEqual(aad(encrypted).toString(), aad(binding).toString())) throw new Error("reddit_credential_binding_mismatch");
  const key = keys[encrypted.keyVersion];
  if (!key) throw new Error("session_key_version_unavailable");
  const nonce = Buffer.from(encrypted.nonce, "base64"), tag = Buffer.from(encrypted.tag, "base64");
  if (nonce.length !== 12 || tag.length !== 16) throw new Error("invalid_ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), nonce);
  decipher.setAAD(aad(binding)); decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]);
  try { return redditCredentialSchema.parse(JSON.parse(plaintext.toString("utf8"))); }
  finally { plaintext.fill(0); }
}
