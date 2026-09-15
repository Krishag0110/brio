import { createSetupPendingServer } from "../shared/setup-pending";
import { createWeatherVerificationServer } from "./weather-service";
import { requireSecret } from "../shared/security";

const server = process.env.WORKER_SETUP_PENDING === "true" ? createSetupPendingServer("verifier") : createWeatherVerificationServer({ verifySecret: requireSecret(process.env.ENGINEERING_VERIFY_SECRET, "ENGINEERING_VERIFY_SECRET"), allowedHosts: (process.env.WEATHER_ALLOWED_HOSTS ?? "").split(",").map(host => host.trim()).filter(Boolean), acceptSignedDeploymentHosts: process.env.WEATHER_ACCEPT_SIGNED_DEPLOYMENT_HOSTS === "true", protectionBypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
server.requestTimeout = 125_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.PORT ?? 8081), "0.0.0.0", () => process.stdout.write("engineering_verifier_listening\n"));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => process.exit(0)));
