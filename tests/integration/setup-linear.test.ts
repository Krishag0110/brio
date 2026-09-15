import { describe, expect, it, vi } from "vitest";
import { runSetupLinear } from "../../scripts/setup-linear";

const key = "lin_api_fake_only_for_mocked_tests";
const teamId = "11111111-1111-4111-8111-111111111111";
const doneId = "22222222-2222-4222-8222-222222222222";
const backlogId = "33333333-3333-4333-8333-333333333333";
const finalPage = { hasNextPage: false, endCursor: null };
const team = { id: teamId, name: "Weather", key: "WTH" };
const done = { id: doneId, name: "Done", type: "completed" };
const backlog = { id: backlogId, name: "Backlog", type: "backlog" };
const teams = { data: { teams: { pageInfo: finalPage, nodes: [team] } } };
const states = { data: { team: { states: { pageInfo: finalPage, nodes: [done, backlog] } } } };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const readEnv = async () => `LINEAR_API_KEY=${key}`;

describe("beginner Linear ID discovery", () => {
  it("discovers IDs even when the provider rejects nested team/status query complexity", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      if (payload.query.includes("teams(") && payload.query.includes("states(")) return response({ errors: [{ message: "Query too complex", extensions: { code: "INPUT_ERROR" } }] }, 400);
      return response(payload.query.includes("teams(") ? teams : states);
    });
    const output = vi.fn(), error = vi.fn();
    expect(await runSetupLinear({ readEnv, request, output, error })).toBe(0);
    expect(error).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(2);
    for (const [url, init] of request.mock.calls) {
      expect(url).toBe("https://api.linear.app/graphql"); expect(init?.headers).toMatchObject({ Authorization: key });
      const payload = JSON.parse(String(init?.body)); expect(payload.query).toMatch(/^query MendSetup/); expect(payload.query).not.toContain("mutation");
      expect(payload.query).toContain("first: 50");
    }
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).variables).toEqual({ teamId, after: null });
    const printed = output.mock.calls.flat().join("\n"); expect(printed).toContain(`LINEAR_TEAM_ID=${teamId}`); expect(printed).toContain(`LINEAR_RELEASED_STATE_ID=${doneId}`);
    expect(printed).not.toContain(`LINEAR_RELEASED_STATE_ID=${backlogId}`); expect(printed).not.toContain(key);
  });

  it.each(["", "LINEAR_API_KEY=", "LINEAR_API_KEY=YOUR_KEY"])("explains which .env to edit when the key is missing (%j)", async envText => {
    const request = vi.fn<typeof fetch>(), error = vi.fn();
    expect(await runSetupLinear({ readEnv: async () => envText, request, error })).toBe(1);
    expect(request).not.toHaveBeenCalled(); expect(error.mock.calls.flat().join("\n")).toContain("in .env,");
  });

  it("does not expose credentials or partial results when provider errors occur", async () => {
    const output = vi.fn(), error = vi.fn();
    for (const reply of [new Response(`private body ${key}`, { status: 401 }), response({ errors: [{ message: key }], ...teams }), response({ errors: [null], ...teams })]) {
      expect(await runSetupLinear({ readEnv, request: vi.fn<typeof fetch>().mockResolvedValue(reply), output, error })).toBe(1);
    }
    expect(output).not.toHaveBeenCalled(); expect(error.mock.calls.flat().join("\n")).not.toContain(key);
  });

  it("reads later team and status pages before suggesting completed IDs", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: { teams: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "team-page-2" } } } }))
      .mockResolvedValueOnce(response(teams))
      .mockResolvedValueOnce(response({ data: { team: { states: { nodes: [backlog], pageInfo: { hasNextPage: true, endCursor: "state-page-2" } } } } }))
      .mockResolvedValueOnce(response({ data: { team: { states: { nodes: [done], pageInfo: finalPage } } } }));
    const output = vi.fn(), error = vi.fn();
    expect(await runSetupLinear({ readEnv, request, output, error })).toBe(0);
    expect(request).toHaveBeenCalledTimes(4);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).variables.after).toBe("team-page-2");
    expect(JSON.parse(String(request.mock.calls[3][1]?.body)).variables).toEqual({ teamId, after: "state-page-2" });
    expect(output.mock.calls.flat().join("\n")).toContain(`LINEAR_RELEASED_STATE_ID=${doneId}`);
  });

  it.each([null, "repeated"])("stops malformed or repeated pagination without partial IDs (%j)", async cursor => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => response({ data: { teams: { nodes: [team], pageInfo: { hasNextPage: true, endCursor: cursor } } } }));
    const output = vi.fn(), error = vi.fn();
    expect(await runSetupLinear({ readEnv, request, output, error })).toBe(1);
    expect(request.mock.calls.length).toBeLessThanOrEqual(2); expect(output).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join("\n")).toContain("pagination cursor");
  });

  it("explains query complexity instead of telling the user their key is wrong", async () => {
    const error = vi.fn();
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ errors: [{ message: `Query too complex ${key}`, extensions: { code: "INPUT_ERROR" } }] }, 400));
    expect(await runSetupLinear({ readEnv, request, error })).toBe(1);
    const message = error.mock.calls.flat().join("\n"); expect(message).toContain("changing the API key will not fix"); expect(message).not.toContain(key);
  });

  it("reports throttling without automatic retries or partial suggestions", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(teams)).mockResolvedValueOnce(response({ errors: [{ message: key, extensions: { code: "RATELIMITED" } }] }, 429));
    const output = vi.fn(), error = vi.fn();
    expect(await runSetupLinear({ readEnv, request, output, error })).toBe(1);
    expect(request).toHaveBeenCalledTimes(2); expect(output).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join("\n")).toContain("rate-limited"); expect(error.mock.calls.flat().join("\n")).not.toContain(key);
  });
});
