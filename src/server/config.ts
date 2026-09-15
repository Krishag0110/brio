import type { RuntimeConfig } from "../control/types";

/** Explicit server setting: demo state is stored in the isolated Convex namespace. */
export function hostedDemoEnabled(): boolean {
  return process.env.FDE_HOSTED_DEMO === "true";
}

export function runtimeConfig(): RuntimeConfig {
  const configured = (...keys: string[]) => keys.every((key) => Boolean(process.env[key]?.trim()));
  return {
    infrastructureCommittedUsd: process.env.FDE_INFRASTRUCTURE_COMMITTED_USD === undefined ? 0 : process.env.FDE_INFRASTRUCTURE_COMMITTED_USD.trim() === "" ? Number.NaN : Number(process.env.FDE_INFRASTRUCTURE_COMMITTED_USD),
    mode: hostedDemoEnabled() || process.env.FDE_DEMO_MODE === "true" ? "demo" : "live",
    repository: process.env.FDE_WEATHER_REPOSITORY ?? "configure-owner/weather-app",
    baseSha: process.env.FDE_BASE_SHA ?? "unverified-base",
    openaiConfigured: configured("OPENAI_API_KEY"), accessConfigured: (process.env.CONTROL_SERVICE_SECRET?.length ?? 0) >= 32 && (process.env.FDE_LOCAL_ACCESS === "true" || (process.env.CONTROL_ACCESS_PASSWORD?.length ?? 0) >= 12),
    convexConfigured: configured("NEXT_PUBLIC_CONVEX_URL"), slackConfigured: configured("SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"),
    linearConfigured: configured("LINEAR_API_KEY", "LINEAR_TEAM_ID"), githubConfigured: configured("GITHUB_DISPATCH_TOKEN") || configured("GITHUB_TOKEN"),
    vercelConfigured: configured("VERCEL_TOKEN", "VERCEL_PROJECT_ID"), workerConfigured: configured("SOCIAL_WORKER_URL", "SOCIAL_GRANT_SECRET", "SOCIAL_CALLBACK_SECRET"),
    redditConfigured: configured("SOCIAL_WORKER_URL", "SOCIAL_GRANT_SECRET", "SOCIAL_CALLBACK_SECRET") && process.env.REDDIT_API_APPROVED === "true",
  };
}
