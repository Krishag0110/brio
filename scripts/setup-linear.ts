import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";
import { z } from "zod";

export const LINEAR_SETUP_FILE = ".env";
const teamsQuery = `query MendSetupTeams($after: String) {
  teams(first: 50, after: $after) {
    nodes { id name key }
    pageInfo { hasNextPage endCursor }
  }
}`;
const statesQuery = `query MendSetupStates($teamId: String!, $after: String) {
  team(id: $teamId) {
    states(first: 50, after: $after) {
      nodes { id name type }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const teamSchema = z.object({ id: z.string().uuid(), name: z.string(), key: z.string() });
const stateSchema = z.object({ id: z.string().uuid(), name: z.string(), type: z.string() });
const teamsSchema = z.object({ data: z.object({ teams: z.object({ pageInfo, nodes: z.array(teamSchema) }) }) });
const statesSchema = z.object({ data: z.object({ team: z.object({ states: z.object({ pageInfo, nodes: z.array(stateSchema) }) }) }) });
type Options = { readEnv?: () => Promise<string>; request?: typeof fetch; output?: (message: string) => void; error?: (message: string) => void };

class SetupFailure extends Error {}

/** Provider text is inspected only to choose a fixed diagnostic; it is never printed. */
function responseFailure(status: number, body: unknown): string | undefined {
  const hasErrors = typeof body === "object" && body !== null && "errors" in body && (!Array.isArray(body.errors) || body.errors.length > 0);
  const errors = z.object({ errors: z.array(z.object({ message: z.string().optional(), extensions: z.object({ code: z.string().optional() }).passthrough().optional() }).passthrough()) }).safeParse(body);
  const list = errors.success ? errors.data.errors : [];
  const hasCode = (code: string) => list.some(item => item.extensions?.code === code);
  if (list.some(item => /query too complex|complexity limit/i.test(item.message ?? ""))) return "Linear rejected the lookup because its query is too complex. Update scripts/setup-linear.ts to the version that reads teams and statuses in separate pages; changing the API key will not fix this query.";
  if (status === 429 || hasCode("RATELIMITED")) return "Linear temporarily rate-limited this lookup. Wait for the API limit to reset, then retry; do not regenerate the key.";
  if (status === 401 || status === 403 || hasCode("AUTHENTICATION_ERROR") || hasCode("FORBIDDEN")) return "Linear rejected access. Check LINEAR_API_KEY in .env, its Read permission, and its allowed teams in Linear settings.";
  if (hasCode("GRAPHQL_VALIDATION_FAILED") || hasCode("GRAPHQL_PARSE_FAILED")) return "Linear rejected the setup helper's query. Its GraphQL fields need updating; this does not establish an invalid API key.";
  if (status >= 500) return "Linear is currently unavailable. Retry this lookup later.";
  if (status >= 400 || hasErrors) return `Linear rejected the metadata lookup (HTTP ${status}). This does not establish an invalid API key. Check the helper version and Linear service status before changing credentials.`;
}

async function collectPages<T>(readPage: (after: string | null) => Promise<{ nodes: T[]; pageInfo: z.infer<typeof pageInfo> }>, limit: number): Promise<T[]> {
  const nodes: T[] = [], seen = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const result = await readPage(after);
    nodes.push(...result.nodes);
    if (nodes.length > limit) throw new SetupFailure("This key can see too many teams or statuses for this setup lookup. Restrict its access to the weather team, then retry.");
    if (!result.pageInfo.hasNextPage) return nodes;
    const cursor = result.pageInfo.endCursor;
    if (!cursor || seen.has(cursor)) throw new SetupFailure("Linear returned an invalid pagination cursor. No incomplete IDs were printed; retry later.");
    seen.add(cursor); after = cursor;
  }
  throw new SetupFailure("Linear returned too many pages for this setup lookup. Restrict the key to the weather team, then retry.");
}

/** Reads metadata only. Loads the controller's .env explicitly, without .env.local or ambient-key fallback. */
export async function runSetupLinear(options: Options = {}): Promise<number> {
  const output = options.output ?? console.log, error = options.error ?? console.error;
  let envText: string;
  try { envText = await (options.readEnv ?? (() => readFile(resolve(LINEAR_SETUP_FILE), "utf8")))(); }
  catch { error(`Cannot read ${LINEAR_SETUP_FILE}. Run this command from the controller folder and add LINEAR_API_KEY=your_personal_api_key to its .env file, then retry.`); return 1; }
  const key = parse(envText).LINEAR_API_KEY?.trim();
  if (!key || /^(YOUR_|replace|configure-)/i.test(key)) { error(`Add your Linear personal API key to LINEAR_API_KEY in ${LINEAR_SETUP_FILE}, save the file, then run this command again.`); return 1; }
  let teams: (z.infer<typeof teamSchema> & { states: z.infer<typeof stateSchema>[] })[];
  try {
    let requests = 0;
    const query = async <T>(text: string, variables: Record<string, string | null>, schema: z.ZodType<T>): Promise<T> => {
      if (++requests > 200) throw new SetupFailure("This setup lookup reached its request limit. Restrict the key to the weather team, then retry.");
      const response = await (options.request ?? fetch)("https://api.linear.app/graphql", {
        method: "POST", headers: { Authorization: key, "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, variables }), redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      const body: unknown = await response.json().catch(() => null);
      const failure = responseFailure(response.status, body);
      if (failure) throw new SetupFailure(failure);
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new SetupFailure("Linear returned an unexpected response. No incomplete IDs were printed; check the helper version and retry.");
      return parsed.data;
    };
    const metadata = await collectPages(async after => (await query(teamsQuery, { after }, teamsSchema)).data.teams, 100);
    teams = [];
    for (const team of metadata) {
      const states = await collectPages(async after => (await query(statesQuery, { teamId: team.id, after }, statesSchema)).data.team.states, 500);
      teams.push({ ...team, states });
    }
  } catch (failure) {
    error((failure instanceof SetupFailure ? failure.message : "Could not read Linear team information. Check your internet connection, then retry.") + " No credentials or response body were printed.");
    return 1;
  }
  if (!teams.length) { error("No teams are visible to this key. Give the key access to your weather team in Linear settings, then retry."); return 1; }
  const label = (value: string) => Array.from(value.replaceAll(key, "[redacted]")).filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join("").slice(0, 200);
  output("Read-only lookup succeeded. Choose your weather team and one completed status from that same team.");
  for (const team of teams) {
    output(`\nTeam: ${label(team.name)} (${label(team.key)})\nLINEAR_TEAM_ID=${team.id}`);
    for (const state of team.states) output(`  ${label(state.name)} [${label(state.type)}]: ${state.id}`);
    const completed = team.states.filter(state => state.type === "completed");
    if (!completed.length) output("  No completed status found. In Linear: Settings → Teams → your team → Issue statuses; add a status in the Completed category.");
    for (const state of completed) output(`  For completed status '${label(state.name)}':\n  LINEAR_RELEASED_STATE_ID=${state.id}`);
  }
  output(`\nCopy the two chosen LINEAR_* ID assignments into ${LINEAR_SETUP_FILE} and the matching Convex deployment's Environment Variables. This helper does not save anything or create/update issues.`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runSetupLinear();
