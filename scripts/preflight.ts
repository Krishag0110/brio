import { loadEnvConfig } from "@next/env";
import { APP_MODEL } from "../src/core/domain";
import { createBudgetLedger } from "../src/core/budget";

type Scope = "next" | "convex" | "social" | "engineering" | "verifier";
type Mode = "demo" | "live";
type Check = {
  id: string;
  scope: Scope;
  keys: string[];
  required: boolean;
  anyOf?: boolean;
  detail: string;
  valid?: (values: string[]) => boolean;
  enabled?: (values: string[]) => boolean;
};
type Row = Omit<Check, "valid" | "enabled"> & {
  status: "present_unverified" | "missing" | "invalid" | "disabled";
};

const scopes: Scope[] = ["next", "convex", "social", "engineering", "verifier"];
const isSecret = (values: string[]) =>
  values.every((value) => value.length >= 32);
function validUrl(value: string, localAllowed = false, originOnly = false) {
  try {
    const url = new URL(value);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      (url.protocol === "https:" ||
        (localAllowed && local && url.protocol === "http:")) &&
      (!originOnly || url.pathname === "/")
    );
  } catch {
    return false;
  }
}
const httpsOrigin = (values: string[]) =>
  values.every((value) => validUrl(value, false, true));
const localOrHttpsOrigin = (values: string[]) =>
  values.every((value) => validUrl(value, true, true));
const key32 = (values: string[]) =>
  values.every(
    (value) =>
      /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
      Buffer.from(value, "base64").length === 32,
  );

function catalog(includeReddit: boolean): Check[] {
  return [
    {
      id: "hosted_workspace_access",
      scope: "next",
      keys: ["CONTROL_ACCESS_PASSWORD", "CONTROL_SERVICE_SECRET"],
      required: true,
      detail:
        "Hosted access code and server-only service key. Local no-login access requires explicit FDE_LOCAL_ACCESS=true and a loopback Host.",
      valid: (values) => values[0].length >= 12 && isSecret(values.slice(1)),
    },
    {
      id: "convex_server_endpoint",
      scope: "next",
      keys: ["NEXT_PUBLIC_CONVEX_URL"],
      required: true,
      detail: "HTTP function endpoint, not the .convex.site callback origin.",
      valid: localOrHttpsOrigin,
    },
    {
      id: "control_origin",
      scope: "next",
      keys: ["CONTROL_APP_ORIGIN"],
      required: true,
      detail: "Exact deployed UI origin used for session import grants.",
      valid: localOrHttpsOrigin,
    },
    {
      id: "session_import_target",
      scope: "next",
      keys: ["SOCIAL_WORKER_URL"],
      required: true,
      detail:
        "Configured worker address; no health or session request is made.",
      valid: httpsOrigin,
    },
    {
      id: "control_service_authentication",
      scope: "convex",
      keys: ["CONTROL_SERVICE_SECRET"],
      required: true,
      detail:
        "Same server-only service key as Next.js; never expose it to browser code.",
      valid: isSecret,
    },
    {
      id: "slack_approval_roles",
      scope: "convex",
      keys: ["SLACK_ENGINEER_USER_IDS", "SLACK_MARKETER_USER_IDS"],
      required: true,
      detail:
        "Comma-separated exact Slack member IDs for live Build and Go decisions; no external identity provider is used.",
      valid: (values) =>
        values.every((value) =>
          value.split(",").every((id) => /^[UW][A-Z0-9_]+$/.test(id.trim())),
        ),
    },
    {
      id: "slack_administrators",
      scope: "convex",
      keys: ["SLACK_ADMIN_USER_IDS"],
      required: false,
      detail:
        "Optional exact Slack administrator IDs; workspace access does not grant Slack approval authority.",
      valid: (values) =>
        values[0].split(",").every((id) => /^[UW][A-Z0-9_]+$/.test(id.trim())),
    },
    {
      id: "openai",
      scope: "convex",
      keys: ["OPENAI_API_KEY"],
      required: true,
      detail:
        "App-scoped credential presence only; model is fixed to gpt-5-mini.",
    },
    {
      id: "initial_infrastructure_commitment",
      scope: "convex",
      keys: ["FDE_INFRASTRUCTURE_COMMITTED_USD"],
      required: true,
      detail:
        "Explicit startup commitment from 0 to 100 USD. Existing stored commitments are changed through the audited admin control, not overwritten by environment changes.",
      valid: (values) =>
        Number.isFinite(Number(values[0])) &&
        Number(values[0]) >= 0 &&
        Number(values[0]) <= 100,
    },
    {
      id: "backend_control_links",
      scope: "convex",
      keys: ["CONTROL_APP_ORIGIN"],
      required: true,
      detail:
        "Public control app origin for canonical Slack and Linear case links.",
      valid: httpsOrigin,
    },
    {
      id: "slack",
      scope: "convex",
      keys: [
        "SLACK_BOT_TOKEN",
        "SLACK_SIGNING_SECRET",
        "SLACK_CHANNEL_ID",
        "SLACK_TEAM_ID",
      ],
      required: true,
      detail:
        "Bot access, signed interactivity, channel access, and verified user bindings need live tests.",
    },
    {
      id: "linear",
      scope: "convex",
      keys: ["LINEAR_API_KEY", "LINEAR_TEAM_ID", "LINEAR_RELEASED_STATE_ID"],
      required: true,
      detail:
        "Canonical engineering ticket capability still requires verification.",
    },
    {
      id: "github",
      scope: "convex",
      keys: ["FDE_WEATHER_REPOSITORY", "FDE_BASE_SHA", "GITHUB_CONTROLLER_SHA"],
      required: true,
      detail: "Scope to one owned repository and exact baseline revision.",
      valid: (values) =>
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values[0]) &&
        !values[0].startsWith("configure-") &&
        values.slice(1).every((value) => /^[a-fA-F0-9]{40}$/.test(value)),
    },
    {
      id: "github_controller_repository",
      scope: "convex",
      keys: ["GITHUB_CONTROLLER_REPOSITORY"],
      required: true,
      detail:
        "Separate trusted controller owner/repository; the weather repository remains the only candidate-change target.",
      valid: (values) =>
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values[0]) &&
        values[0] !== process.env.FDE_WEATHER_REPOSITORY,
    },
    {
      id: "github_dispatch",
      scope: "convex",
      keys: ["GITHUB_DISPATCH_TOKEN", "GITHUB_TOKEN"],
      anyOf: true,
      required: true,
      detail:
        "At least one dispatch credential. Prefer a scoped dispatch token; GITHUB_TOKEN is the compatibility fallback.",
    },
    {
      id: "github_release",
      scope: "convex",
      keys: ["GITHUB_RELEASE_TOKEN"],
      required: true,
      detail:
        "Separate trusted merge/release credential. It is never sent to candidate code.",
    },
    {
      id: "github_read",
      scope: "convex",
      keys: ["GITHUB_READ_TOKEN"],
      required: false,
      detail:
        "Optional scoped read credential; otherwise provider reads use the dispatch token.",
    },
    {
      id: "vercel",
      scope: "convex",
      keys: [
        "VERCEL_TOKEN",
        "VERCEL_PROJECT_ID",
        "VERCEL_PROJECT_NAME",
        "WEATHER_PRODUCTION_DOMAIN",
      ],
      required: true,
      detail:
        "Staged deployment, promotion, and live identity/behavior need actual provider checks.",
      valid: (values) =>
        validUrl(`https://${values[3]}`, false, true) &&
        new URL(`https://${values[3]}`).hostname === values[3],
    },
    {
      id: "social_controller",
      scope: "convex",
      keys: [
        "SOCIAL_WORKER_URL",
        "SOCIAL_GRANT_SECRET",
        "SOCIAL_CALLBACK_SECRET",
      ],
      required: true,
      detail:
        "Controller and worker must share distinct grant/callback secrets.",
      valid: (values) =>
        validUrl(values[0], false, true) && isSecret(values.slice(1)),
    },
    {
      id: "engineering_controller",
      scope: "convex",
      keys: ["ENGINEERING_GRANT_SECRET", "ENGINEERING_CALLBACK_SECRET"],
      required: true,
      detail: "Match the protected engineering-controller environment.",
      valid: isSecret,
    },
    {
      id: "protected_browser_verifier",
      scope: "convex",
      keys: ["ENGINEERING_WORKER_URL", "ENGINEERING_VERIFY_SECRET"],
      required: true,
      detail:
        "Authenticated protected browser-verification worker; no remote request is made.",
      valid: (values) =>
        validUrl(values[0], false, true) && isSecret(values.slice(1)),
    },
    {
      id: "x_controller_permission",
      scope: "convex",
      keys: ["X_AUTOMATION_PERMISSION_CONFIRMED"],
      required: true,
      detail:
        "Controller-side permission gate; independent of the worker-side flag and never evidence of platform approval.",
      valid: (values) => ["true", "false"].includes(values[0]),
      enabled: (values) => values[0] === "true",
    },
    {
      id: "reddit",
      scope: "convex",
      keys: ["REDDIT_API_APPROVED"],
      required: includeReddit,
      detail:
        "Conditional controller readiness flag. OAuth secrets belong only to the social worker; account and community permissions need live validation.",
      valid: (values) => ["true", "false"].includes(values[0]),
      enabled: (values) => values[0] === "true",
    },
    {
      id: "reddit_worker",
      scope: "social",
      keys: [
        "REDDIT_CLIENT_ID",
        "REDDIT_CLIENT_SECRET",
        "REDDIT_REDIRECT_URI",
        "REDDIT_USER_AGENT",
        "REDDIT_ALLOWED_SUBREDDITS",
      ],
      required: includeReddit,
      detail:
        "Worker-only OAuth, account verification and allowlisted polling; credentials do not establish official API or community approval.",
    },
    {
      id: "reddit_worker_permission",
      scope: "social",
      keys: ["REDDIT_API_APPROVED"],
      required: includeReddit,
      detail:
        "Keep false until the dedicated account and community capability is authorized.",
      valid: (values) => ["true", "false"].includes(values[0]),
      enabled: (values) => values[0] === "true",
    },
    {
      id: "worker_control_origin",
      scope: "social",
      keys: ["CONTROL_APP_ORIGIN"],
      required: true,
      detail: "Must exactly match the allowed control app origin.",
      valid: httpsOrigin,
    },
    {
      id: "worker_convex_callbacks",
      scope: "social",
      keys: ["CONVEX_SITE_URL"],
      required: true,
      detail:
        "Public HTTPS Convex HTTP-action origin. Local anonymous deployment is not remotely reachable.",
      valid: httpsOrigin,
    },
    {
      id: "worker_grants_and_callbacks",
      scope: "social",
      keys: ["SOCIAL_GRANT_SECRET", "SOCIAL_CALLBACK_SECRET"],
      required: true,
      detail: "Use separate random secrets of at least 32 characters.",
      valid: isSecret,
    },
    {
      id: "session_encryption",
      scope: "social",
      keys: ["SESSION_ENCRYPTION_KEY", "SESSION_KEY_VERSION"],
      required: true,
      detail:
        "Worker-only AES-256-GCM key: exactly 32 random bytes encoded as base64, plus a version label.",
      valid: (values) =>
        key32([values[0]]) && /^[A-Za-z0-9_-]{1,64}$/.test(values[1]),
    },
    {
      id: "x_permission",
      scope: "social",
      keys: ["X_PLATFORM_PERMISSION_APPROVED"],
      required: true,
      detail:
        "Keep false until authorized platform/account capability is established; setting true is not verification.",
      valid: (values) => ["true", "false"].includes(values[0]),
      enabled: (values) => values[0] === "true",
    },
    {
      id: "engineering_callbacks",
      scope: "engineering",
      keys: [
        "CONVEX_SITE_URL",
        "ENGINEERING_GRANT_SECRET",
        "ENGINEERING_CALLBACK_SECRET",
      ],
      required: true,
      detail:
        "Trusted controller callback origin and separately scoped grant/callback credentials.",
      valid: (values) =>
        validUrl(values[0], false, true) && isSecret(values.slice(1)),
    },
    {
      id: "engineering_sandbox",
      scope: "engineering",
      keys: ["CODING_SANDBOX_IMAGE"],
      required: true,
      detail:
        "Reviewed immutable image digest; preflight does not pull or launch containers.",
      valid: (values) => /^.+@sha256:[a-f0-9]{64}$/.test(values[0]),
    },
    {
      id: "engineering_target_repository",
      scope: "engineering",
      keys: ["WEATHER_TARGET_REPOSITORY"],
      required: true,
      detail:
        "Protected engineering-controller environment: exact owned target repository.",
      valid: (values) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values[0]),
    },
    {
      id: "engineering_target_checkout",
      scope: "engineering",
      keys: ["WEATHER_REPO_READ_SSH_KEY", "WEATHER_REPO_READ_TOKEN"],
      anyOf: true,
      required: true,
      detail:
        "Prefer the target repository's read-only SSH deploy key; read-only contents token is a fallback. Checkout never persists credentials.",
      valid: (values) =>
        values[0]
          ? /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/.test(values[0])
          : values[1].length >= 20,
    },
    {
      id: "engineering_pr_writer",
      scope: "engineering",
      keys: ["WEATHER_PR_TOKEN", "GITHUB_PR_TOKEN"],
      anyOf: true,
      required: true,
      detail:
        "GitHub secret WEATHER_PR_TOKEN maps to runtime GITHUB_PR_TOKEN in the trusted writer. Never expose it to the candidate container.",
    },
    {
      id: "engineering_checks_writer",
      scope: "engineering",
      keys: [
        "WEATHER_CHECKS_APP_ID",
        "WEATHER_CHECKS_APP_PRIVATE_KEY",
        "WEATHER_CHECKS_TOKEN",
        "GITHUB_CHECKS_TOKEN",
      ],
      anyOf: true,
      required: true,
      detail:
        "Prefer the installed Checks-write GitHub App ID/private key; the workflow mints a short-lived token. Optional WEATHER_CHECKS_TOKEN maps to runtime GITHUB_CHECKS_TOKEN.",
      valid: (values) =>
        values[0]
          ? /^\d+$/.test(values[0]) &&
            /-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(values[1])
          : Boolean(values[2] || values[3]),
    },
    {
      id: "verifier_authentication",
      scope: "verifier",
      keys: ["ENGINEERING_VERIFY_SECRET"],
      required: true,
      detail:
        "Match the controller's verification signing key; at least 32 random characters.",
      valid: isSecret,
    },
    {
      id: "verifier_target_policy",
      scope: "verifier",
      keys: ["WEATHER_ALLOWED_HOSTS", "WEATHER_ACCEPT_SIGNED_DEPLOYMENT_HOSTS"],
      anyOf: true,
      required: true,
      detail:
        "Use exact allowed hostnames and/or explicitly permit controller-signed deployment hosts. The worker still rejects private targets.",
      valid: (values) =>
        (Boolean(values[0]) &&
          values[0]
            .split(",")
            .every((value) => /^[a-zA-Z0-9.-]+$/.test(value.trim()))) ||
        values[1] === "true",
    },
  ];
}

function options(args: string[]) {
  const output = {
    scope: "all" as Scope | "all",
    mode: undefined as Mode | undefined,
    json: false,
    strict: false,
    envFiles: true,
    includeReddit: false,
    help: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") output.json = true;
    else if (arg === "--strict") output.strict = true;
    else if (arg === "--no-env-files") output.envFiles = false;
    else if (arg === "--include-reddit") output.includeReddit = true;
    else if (arg === "--help" || arg === "-h") output.help = true;
    else if (arg === "--scope") {
      const value = args[++index];
      if (!scopes.includes(value as Scope) && value !== "all")
        throw new Error("invalid_arguments");
      output.scope = value as Scope | "all";
    } else if (arg === "--mode") {
      const value = args[++index];
      if (value !== "live" && value !== "demo")
        throw new Error("invalid_arguments");
      output.mode = value;
    } else throw new Error("invalid_arguments");
  }
  return output;
}

function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(
      "Usage: bun run test:preflight [--scope next|convex|social|engineering|verifier|all] [--mode demo|live] [--json] [--strict] [--no-env-files] [--include-reddit]\nRead-only local configuration inventory. Never calls provider APIs, prints values, creates accounts, or provisions services.\nDefault is reporting-only (exit 0); --strict fails when required settings for the selected mode/scope are missing or invalid.\n",
    );
    return;
  }
  let parseErrors = false;
  if (opts.envFiles)
    loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
      info: () => {},
      error: () => {
        parseErrors = true;
      },
    });
  const mode =
    opts.mode ?? (process.env.FDE_DEMO_MODE === "true" ? "demo" : "live");
  const rows: Row[] = catalog(opts.includeReddit)
    .filter((check) => opts.scope === "all" || check.scope === opts.scope)
    .map((check) => {
      const values = check.keys.map((key) => process.env[key]?.trim() ?? "");
      const missing = check.anyOf
        ? values.every((value) => !value)
        : values.some((value) => !value);
      const placeholder = values.some((value) =>
        /^(?:replace[_-]|your[_-]|changeme|<|todo$)/i.test(value),
      );
      let valid = !placeholder;
      if (!missing && valid && check.valid) {
        try {
          valid = check.valid(values);
        } catch {
          valid = false;
        }
      }
      const { valid: _validator, enabled: _enabled, ...publicCheck } = check;
      void _validator;
      const disabled = !missing && valid && _enabled && !_enabled(values);
      return {
        ...publicCheck,
        status: missing
          ? "missing"
          : !valid
            ? "invalid"
            : disabled
              ? "disabled"
              : "present_unverified",
      };
    });
  const forbiddenPublicKeys = [
    "NEXT_PUBLIC_OPENAI_API_KEY",
    "NEXT_PUBLIC_CONTROL_SERVICE_SECRET",
    "NEXT_PUBLIC_CONTROL_ACCESS_PASSWORD",
    "NEXT_PUBLIC_GITHUB_TOKEN",
    "NEXT_PUBLIC_SLACK_BOT_TOKEN",
    "NEXT_PUBLIC_SESSION_ENCRYPTION_KEY",
    "NEXT_PUBLIC_VERCEL_TOKEN",
  ].filter((key) => Boolean(process.env[key]));
  const budget = createBudgetLedger();
  const invariantErrors = [
    ...(mode === "live" && process.env.FDE_DEMO_MODE === "true"
      ? ["demo_mode_enabled_for_live_check"]
      : []),
    ...(parseErrors ? ["environment_file_load_failed"] : []),
    ...(Number(process.versions.node.split(".")[0]) < 22
      ? ["node_22_or_newer_required"]
      : []),
    ...(forbiddenPublicKeys.length ? ["secret_in_public_environment"] : []),
    ...(APP_MODEL !== "gpt-5-mini" ||
    budget.ceilingUsd > 100 ||
    budget.discretionaryCeilingUsd > 90
      ? ["model_or_budget_invariant_failed"]
      : []),
  ];
  const missingLive = rows.filter(
    (row) => row.required && row.status !== "present_unverified",
  );
  const ready =
    invariantErrors.length === 0 &&
    (mode === "demo" || missingLive.length === 0);
  const report = {
    timestamp: new Date().toISOString(),
    scope: opts.scope,
    requestedMode: mode,
    configuredMode: process.env.FDE_DEMO_MODE === "true" ? "demo" : "live",
    status: ready
      ? "local_configuration_check_passed"
      : "configuration_blocked",
    liveReadiness: "unverified",
    networkRequests: 0,
    secretValuesPrinted: false,
    model: APP_MODEL,
    projectCeilingUsd: budget.ceilingUsd,
    discretionaryCeilingUsd: budget.discretionaryCeilingUsd,
    localEnvironmentOnly: true,
    remoteEnvironmentVerified: false,
    nodeMajor: Number(process.versions.node.split(".")[0]),
    invariantErrors,
    forbiddenPublicKeys,
    blockedLiveChecks: missingLive.map((row) => row.id),
    checks: rows,
    notes: [
      "Presence is not credential validity, service access, deployed configuration, or permission verification.",
      "Next.js .env.local is not automatically copied to Convex, GitHub Actions, or the social worker.",
      "Demo mode performs fixture work only. Missing live credentials remain listed even when the demo configuration check passes.",
      "No actual cost ledger or vendor billing is queried; displayed ceilings are application invariants, not a claim of total recorded spend.",
    ],
  };
  if (opts.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else {
    process.stdout.write(
      `Preflight: ${report.status}\nMode: ${mode} | Scope: ${opts.scope} | Model: ${APP_MODEL} | Ceiling: USD ${budget.ceilingUsd}\nLocal configuration only; no API requests or secret values.\n\n`,
    );
    for (const row of rows)
      process.stdout.write(
        `${row.status.padEnd(20)} ${row.scope.padEnd(12)} ${row.id} — ${row.keys.join(", ")}\n`,
      );
    for (const code of invariantErrors)
      process.stdout.write(`BLOCKED: ${code}\n`);
    process.stdout.write("\n" + report.notes.join("\n") + "\n");
  }
  if (opts.strict && !ready) process.exitCode = 1;
}

try {
  main();
} catch {
  process.stderr.write(
    "preflight_failed: invalid arguments or local configuration could not be read. Use --help. Secret values are omitted.\n",
  );
  process.exitCode = 2;
}
