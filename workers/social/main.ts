import { createSetupPendingServer } from "../shared/setup-pending";
import { HttpWorkerBridge } from "./bridge";
import { createWorkerServer } from "./service";
import { requireSecret } from "../shared/security";

const keyVersion = process.env.SESSION_KEY_VERSION ?? "v1";
const server = process.env.WORKER_SETUP_PENDING === "true" ? createSetupPendingServer("social") : createWorkerServer({
  grantSecret: requireSecret(process.env.SOCIAL_GRANT_SECRET, "SOCIAL_GRANT_SECRET"),
  allowedOrigin: new URL(process.env.CONTROL_APP_ORIGIN ?? "configuration_required").origin,
  encryptionKeys: { ...JSON.parse(process.env.SESSION_PREVIOUS_KEYS_JSON ?? "{}"), [keyVersion]: requireSecret(process.env.SESSION_ENCRYPTION_KEY, "SESSION_ENCRYPTION_KEY") },
  currentKeyVersion: keyVersion, xPermissionApproved: process.env.X_PLATFORM_PERMISSION_APPROVED === "true",
  reddit: { permissionApproved: process.env.REDDIT_API_APPROVED === "true", clientId: process.env.REDDIT_CLIENT_ID, clientSecret: process.env.REDDIT_CLIENT_SECRET, userAgent: process.env.REDDIT_USER_AGENT, redirectUri: process.env.REDDIT_REDIRECT_URI, allowedSubreddits: (process.env.REDDIT_ALLOWED_SUBREDDITS ?? "").split(",").map(value => value.trim()).filter(Boolean) },
}, { bridge: new HttpWorkerBridge(process.env.CONVEX_SITE_URL ?? "configuration_required", requireSecret(process.env.SOCIAL_CALLBACK_SECRET, "SOCIAL_CALLBACK_SECRET")) });
server.requestTimeout = 125_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", () => process.stdout.write("social_worker_listening\n"));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => process.exit(0)));
