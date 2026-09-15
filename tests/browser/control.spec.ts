import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { ControlState } from "../../src/control/types";
import type { Snapshot } from "../../src/shared/control-contract";

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const response = await fetch("/api/control");
    if (!response.ok) throw new Error(`Snapshot failed: ${response.status}`);
    return response.json();
  });
}
async function command(
  page: Page,
  action: string,
  values: Record<string, unknown> = {},
) {
  return page.evaluate(
    async ({ action, values }) => {
      const response = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...values }),
      });
      return { status: response.status, body: await response.json() };
    },
    { action, values },
  );
}
async function identity(page: Page, role: "engineer" | "marketer" | "admin") {
  expect((await command(page, "demo_role", { role })).status).toBe(200);
  await page.reload();
  if (/\/cases\/[^/]+$/.test(new URL(page.url()).pathname)) await openOperations(page);
  await expect
    .poll(async () => (await snapshot(page)).actor.roles[0])
    .toBe(role);
}

async function workspacePage(page: Page, name: "Connections" | "Persona" | "Controls & audit") {
  const menu = page.getByLabel("Workspace settings", { exact: true });
  if (await menu.count()) await menu.click();
  await page.getByRole("link", { name, exact: true }).click();
}
async function openOperations(page: Page) {
  const summary = page.locator("summary").filter({ hasText: "Operational controls" });
  await expect(summary).toBeVisible();
  if (!(await summary.locator("..").evaluate(node => node.hasAttribute("open")))) await summary.click();
}
async function openCase(page: Page, caseId: string) {
  await page.goto(`/cases/${caseId}`);
  await openOperations(page);
}

async function candidateCase(page: Page) {
  await identity(page, "engineer");
  const marker = `Temperature toggle broken ${randomUUID().replace(/[^a-z]/g, "")}`;
  const created = await command(page, "intake", {
    platform: "x",
    mode: "fixture",
    sourceUrl: `https://x.com/browsercustomer/status/${Date.now()}`,
    text: marker,
  });
  expect(created.status).toBe(200);
  const record = (created.body as Snapshot).cases.find(
    (item) => item.text === marker,
  )!;
  expect(record).toBeDefined();
  await openCase(page, record.id);
  await page.getByRole("button", { name: "Advance demo workflow" }).click();
  await expect(
    page.getByRole("button", { name: "Simulate Build", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Simulate Build", exact: true })
    .click();
  await page.getByRole("button", { name: "Advance demo workflow" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases.find((item) => item.id === record.id)!
          .phase,
    )
    .toBe("AWAITING_GO");
  return record.id;
}

async function approveAndVerify(page: Page, caseId: string) {
  await identity(page, "marketer");
  await page.getByRole("button", { name: "Simulate Go", exact: true }).click();
  await page.getByRole("button", { name: "Advance demo workflow" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases.find((item) => item.id === caseId)!
          .productionVerified,
    )
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/cases");
  await expect(page.getByLabel("Incident board", { exact: true })).toBeVisible();
});

test("keeps the presentation free of operator metadata; connection imports stay disabled", async ({
  page,
}) => {
  await expect(page.locator(".workspace-toolbar")).toHaveCount(0);
  await expect(page.getByLabel("Demo identity")).toHaveCount(0);
  await expect(page.getByText("Demo data", { exact: true })).toHaveCount(0);
  await expect(page.getByText("gpt-5-mini", { exact: true })).toHaveCount(0);
  await identity(page, "admin");
  await workspacePage(page, "Connections");
  await expect(
    page.getByRole("heading", { name: "Environment readiness" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import encrypted session" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Session import is disabled in local demo mode.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Official OAuth/API access and community authorization", {
      exact: false,
    }),
  ).toBeVisible();
  const xConnection = page
    .getByRole("heading", { name: "X", exact: true })
    .locator("..")
    .locator("..");
  await xConnection.getByLabel("Account identifier").fill("browser-brand");
  await xConnection
    .getByRole("button", { name: "Save account identifier" })
    .click();
  await xConnection
    .getByRole("button", { name: "Reset connection for reimport" })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).connections.find((item) => item.id === "x")!
          .status,
    )
    .toBe("reconnect_required");
  const rejectedImport = await page.evaluate(async () => {
    const response = await fetch("/api/connections/x/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "fixture-account",
        storageState: { cookies: [], origins: [] },
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(rejectedImport.status).toBeGreaterThanOrEqual(400);
  expect(rejectedImport.body.error).toContain("disabled_in_demo");
});

test("manual intake persists, deduplicates an interaction, and supports case filters", async ({
  page,
}) => {
  await identity(page, "engineer");
  const marker = `Browser conversion ${Date.now()}`;
  const url = `https://x.com/browsercustomer/status/${Date.now()}`;
  const message = `${marker}: 20°C becomes 20°F when I toggle the unit.`;
  await page.getByRole("button", { name: /^\+? ?Add signal$/, exact: true }).click();
  await page.getByLabel("Original URL", { exact: true }).fill(url);
  await page.getByLabel("Customer text").fill(message);
  await page.getByRole("button", { name: "Store signal" }).click();
  await expect(page.getByRole("status")).toContainText("Signal stored");
  const first = await snapshot(page);
  const record = first.cases.find((item) => item.text.includes(marker));
  expect(record).toBeDefined();
  expect(record!.sourceMode).toBe("fixture");
  await page.getByRole("button", { name: /^\+? ?Add signal$/, exact: true }).click();
  await page.getByLabel("Original URL", { exact: true }).fill(url);
  await page.getByLabel("Customer text").fill(message);
  await page.getByRole("button", { name: "Store signal" }).click();
  await expect(page.getByRole("status")).toContainText("Signal stored");
  expect(
    (await snapshot(page)).cases.filter((item) => item.text.includes(marker)),
  ).toHaveLength(1);
  await page.getByLabel("Search", { exact: true }).fill(marker);
  await expect(
    page.locator(`[data-case-id="${record!.id}"]`),
  ).toBeVisible();
  await page.locator("summary").filter({ hasText: "More filters" }).click();
  await page
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption("live");
  await expect(
    page.getByRole("heading", { name: "No incidents match", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption("fixture");
  await page.locator(`[data-case-id="${record!.id}"]`).click();
  await openOperations(page);
  await expect(
    page.getByRole("heading", { name: "Source interaction" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Source interaction", exact: true })
      .getByText(message, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await openOperations(page);
  await expect(
    page
      .getByRole("region", { name: "Source interaction", exact: true })
      .getByText(message, { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("role controls are enforced by the backend as well as the UI", async ({
  page,
}) => {
  await identity(page, "engineer");
  await workspacePage(page, "Controls & audit");
  await expect(
    page.getByText("Only an admin can pause or resume the workspace."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause workspace", exact: true }),
  ).toHaveCount(0);
  const before = await snapshot(page);
  const denied = await command(page, "pause", {
    paused: !before.workspace.paused,
    reason: "Browser test unauthorized engineer",
  });
  expect(denied.status).toBeGreaterThanOrEqual(400);
  expect((await snapshot(page)).workspace.paused).toBe(before.workspace.paused);
  await identity(page, "admin");
  await page
    .getByLabel("Operator reason")
    .fill("Browser test checks committed pause");
  await page
    .getByRole("button", {
      name: before.workspace.paused ? "Resume workspace" : "Pause workspace",
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await snapshot(page)).workspace.paused)
    .toBe(!before.workspace.paused);
  await page
    .getByLabel("Operator reason")
    .fill("Restore workspace after browser check");
  await page
    .getByRole("button", {
      name: before.workspace.paused ? "Pause workspace" : "Resume workspace",
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await snapshot(page)).workspace.paused)
    .toBe(before.workspace.paused);
});

test("persona edits create new inactive versions and test real complaints separately from banter", async ({
  page,
}) => {
  await identity(page, "marketer");
  await workspacePage(page, "Persona");
  await page.getByLabel("Policy version / preset").selectOption("challenger");
  const before = (await snapshot(page)).personas.find(
    (item) => item.id === "challenger",
  )!;
  await page
    .getByLabel("Audience", { exact: true })
    .fill(`Browser reviewed audience ${Date.now()}`);
  await expect(
    page.getByRole("button", { name: "Test saved persona" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save new persona version" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).personas.find(
          (item) => item.id === "challenger",
        )!.version,
    )
    .toBe(before.version + 1);
  expect(
    (await snapshot(page)).personas.find((item) => item.id === "challenger")!
      .status,
  ).not.toBe("active");
  await page.getByRole("button", { name: "Test saved persona" }).click();
  await expect(
    page.getByRole("heading", { name: "Decision:", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Real complaint example" }).click();
  await page.getByRole("button", { name: "Test saved persona" }).click();
  await expect(page.getByText("No autonomous reply proposed.")).toBeVisible();
  await page
    .getByRole("button", { name: "Request activation in Slack" })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).personas.find(
          (item) => item.id === "challenger",
        )!.status,
    )
    .not.toBe("active");
  await expect(
    page.getByRole("button", { name: "Simulate policy approval" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simulate policy approval" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).personas.find(
          (item) => item.id === "challenger",
        )!.status,
    )
    .toBe("active");
  await page.getByRole("button", { name: "Pause / revoke policy" }).click();
  await page
    .getByLabel("Revocation reason")
    .fill("Browser check revokes queued authority");
  await page.getByRole("button", { name: "Confirm policy revocation" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).personas.find(
          (item) => item.id === "challenger",
        )!.status,
    )
    .toBe("revoked");
});

test("local workspace access needs no login and keeps live decisions in Slack", async ({
  page,
}) => {
  await page.goto("/access");
  await expect(
    page.getByRole("heading", {
      name: "Local demo opens without a login",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Live Build, Go, reply, and policy approvals remain in Slack",
      {
        exact: false,
      },
    ),
  ).toBeVisible();
});

test("draft changes invalidate Go; manual composer requires a real receipt action", async ({
  page,
}) => {
  const caseId = await candidateCase(page);
  await identity(page, "marketer");
  await page.getByRole("button", { name: "Simulate Go", exact: true }).click();
  const approved = (await snapshot(page)).cases.find(
    (item) => item.id === caseId,
  )!;
  expect(approved.productionVerified).toBe(false);
  expect(
    approved.approvals.some(
      (item) => item.kind === "candidate_go" && item.status === "approved",
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page
    .getByLabel("Exact reply text")
    .fill(
      "Fixed: the temperature toggle now shows the verified conversion. Thanks for reporting it.",
    );
  await page.getByRole("button", { name: "Save new draft version" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases.find((item) => item.id === caseId)!
          .blockingReason,
    )
    .toBe("stale_approval");
  const revised = (await snapshot(page)).cases.find(
    (item) => item.id === caseId,
  )!;
  expect(revised.publications[0].version).toBe(2);
  expect(
    revised.approvals.some(
      (item) => item.kind === "candidate_go" && item.status === "approved",
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Request exact reply approval" })
    .click();
  await approveAndVerify(page, caseId);
  await identity(page, "admin");
  await page
    .getByLabel("Simulated failure scenario")
    .selectOption("reconnect_required");
  await page.getByRole("button", { name: "Inject demo failure" }).click();
  await identity(page, "marketer");
  await page.getByRole("button", { name: "Open manual composer" }).click();
  const pending = (await snapshot(page)).cases.find(
    (item) => item.id === caseId,
  )!;
  expect(pending.productionVerified).toBe(true);
  expect(pending.phase).not.toBe("COMPLETED");
  expect(pending.communicationStatus).not.toMatch(/confirmed|attested/);
  await page
    .getByLabel("Simulated receipt URL")
    .fill(`https://x.com/demobrand/status/${Date.now()}`);
  await page
    .getByLabel("I am recording a simulated publication for this fixture.")
    .check();
  await page
    .getByLabel("Receipt / attestation notes")
    .fill("Verified simulated exact reply at the fixture target and account.");
  await page
    .getByRole("button", { name: "Record publication receipt" })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases.find((item) => item.id === caseId)!.phase,
    )
    .toBe("COMPLETED");
  const completed = (await snapshot(page)).cases.find(
    (item) => item.id === caseId,
  )!;
  expect(completed.publications[0].attested).toBe(true);
  expect(completed.publications[0].mode).toBe("fixture");
  await expect(
    page.getByRole("button", { name: "Edit draft", exact: true }),
  ).toHaveCount(0);
});

test("unknown sends block duplicate retry and manual receipts until audited investigation", async ({
  page,
}) => {
  const caseId = await candidateCase(page);
  await approveAndVerify(page, caseId);
  await identity(page, "admin");
  await page
    .getByLabel("Simulated failure scenario")
    .selectOption("publication_unknown");
  await page.getByRole("button", { name: "Inject demo failure" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases.find((item) => item.id === caseId)!
          .blockingReason,
    )
    .toBe("publication_unknown");
  await identity(page, "engineer");
  await expect(
    page.getByRole("button", { name: "Request recovery", exact: true }),
  ).toBeDisabled();
  const retry = await command(page, "recover", {
    caseId,
    operation: "retry",
    reason: "Should be rejected until receipt reconciliation",
  });
  expect(retry.status).toBeGreaterThanOrEqual(400);
  await identity(page, "marketer");
  await expect(
    page.getByRole("button", { name: "Open manual composer" }),
  ).toHaveCount(0);
  const record = (await snapshot(page)).cases.find(
    (item) => item.id === caseId,
  )!;
  const duplicate = await command(page, "manual_receipt", {
    caseId,
    publicationId: record.publications[0].id,
    receiptUrl: `https://x.com/demobrand/status/${Date.now()}`,
    attested: true,
    reason: "This duplicate must be blocked while unknown",
  });
  expect(duplicate.status).toBeGreaterThanOrEqual(400);
  await page.getByLabel("Recovery action").selectOption("reconcile");
  await page
    .getByLabel("Recovery reason")
    .fill("Human fixture investigation confirms no public reply was sent.");
  await page
    .getByLabel("Investigation outcome")
    .selectOption("definitely_not_sent");
  await page
    .getByLabel("I attest that the stated outcome follows an investigation", {
      exact: false,
    })
    .check();
  await page
    .getByRole("button", { name: "Request recovery", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases.find((item) => item.id === caseId)!
          .publications[0].status,
    )
    .not.toBe("unknown");
  expect(
    (await snapshot(page)).cases.find((item) => item.id === caseId)!.phase,
  ).not.toBe("COMPLETED");
});

test("engineer can recover a simulated failed check without granting release approval", async ({
  page,
}) => {
  const caseId = await candidateCase(page);
  await identity(page, "admin");
  await page
    .getByLabel("Simulated failure scenario")
    .selectOption("checks_failed");
  await page.getByRole("button", { name: "Inject demo failure" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases.find((item) => item.id === caseId)!
          .blockingReason,
    )
    .toBe("checks_failed");
  await identity(page, "engineer");
  await page.getByLabel("Recovery action").selectOption("retry");
  await page
    .getByLabel("Recovery reason")
    .fill("Retry fixture checks after investigating the simulated failure.");
  await page
    .getByRole("button", { name: "Request recovery", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases.find((item) => item.id === caseId)!
          .blockingReason,
    )
    .not.toBe("checks_failed");
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases.find((item) => item.id === caseId)!.phase,
    )
    .toBe("BUILDING");
  await page.getByRole("button", { name: "Advance demo workflow" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases.find((item) => item.id === caseId)!.phase,
    )
    .toBe("AWAITING_GO");
  const record = (await snapshot(page)).cases.find(
    (item) => item.id === caseId,
  )!;
  expect(record.candidate?.checksPassed).toBe(true);
  expect(
    record.approvals.some(
      (item) => item.kind === "candidate_go" && item.status === "pending",
    ),
  ).toBe(true);
  expect(
    record.approvals.some(
      (item) => item.kind === "candidate_go" && item.status === "approved",
    ),
  ).toBe(false);
  expect(record.productionVerified).toBe(false);
  expect(record.communicationStatus).not.toMatch(/confirmed|attested/);
});

test("cross-origin control commands are rejected without changing state", async ({
  page,
}) => {
  await identity(page, "admin");
  const before = await snapshot(page);
  const rejected = await page.request.post("/api/control", {
    headers: { Origin: "https://untrusted.invalid" },
    data: {
      action: "pause",
      paused: !before.workspace.paused,
      reason: "Untrusted origin must not alter workspace dispatch",
    },
  });
  expect(rejected.status()).toBe(403);
  expect((await snapshot(page)).workspace.paused).toBe(before.workspace.paused);
});

test("admin records budget commitments with an audit reason while other roles are denied", async ({
  page,
}) => {
  await identity(page, "engineer");
  expect(
    (
      await command(page, "budget_commit", {
        usd: 35,
        reason: "Unauthorized budget attempt",
      })
    ).status,
  ).toBe(403);
  await page.goto("/controls");
  await expect(
    page.getByRole("button", { name: "Save infrastructure commitment" }),
  ).toHaveCount(0);
  await identity(page, "admin");
  await page.getByLabel("Total infrastructure commitment (USD)").fill("35");
  await page
    .getByLabel("Budget change reason")
    .fill("Browser test records bounded hosting commitment");
  await page
    .getByRole("button", { name: "Save infrastructure commitment" })
    .click();
  await expect
    .poll(
      async () => (await snapshot(page)).workspace.infrastructureCommittedUsd,
    )
    .toBe(35);
  expect((await snapshot(page)).workspace.reservedUsd).toBeGreaterThanOrEqual(
    35,
  );
  expect(
    (await command(page, "budget_commit", { usd: 0, reason: "" })).status,
  ).toBe(400);
  await page.getByLabel("Total infrastructure commitment (USD)").fill("0");
  await page
    .getByLabel("Budget change reason")
    .fill("Fixture costs removed after this simulated budget test");
  await page
    .getByRole("button", { name: "Save infrastructure commitment" })
    .click();
  await expect
    .poll(
      async () => (await snapshot(page)).workspace.infrastructureCommittedUsd,
    )
    .toBe(0);
  expect((await snapshot(page)).audit[0].detail).toContain("$35.00 to $0.00");
});

test("production evidence refresh is explicitly simulated and cannot claim communication completion", async ({
  page,
}) => {
  const caseId = await candidateCase(page);
  await approveAndVerify(page, caseId);
  const before = (await snapshot(page)).cases.find(
    (item) => item.id === caseId,
  )!;
  await page.getByRole("button", { name: "Simulate evidence refresh" }).click();
  await expect(
    page.getByText("Simulated live evidence refresh", { exact: true }),
  ).toBeVisible();
  const after = (await snapshot(page)).cases.find(
    (item) => item.id === caseId,
  )!;
  expect(after.communicationStatus).toBe(before.communicationStatus);
  expect(after.publications[0].receiptUrl).toBeUndefined();
  expect(after.outcome).toBeUndefined();
  expect(after.approvals).toEqual(before.approvals);
  await identity(page, "admin");
  await expect(
    page.getByRole("button", { name: "Simulate evidence refresh" }),
  ).toHaveCount(0);
  expect((await command(page, "reverify_live", { caseId })).status).toBe(403);
});

test("an expired Build can be requested again and still needs a new engineer decision", async ({
  page,
}) => {
  await identity(page, "engineer");
  const created = await command(page, "intake", {
    platform: "x",
    mode: "fixture",
    sourceUrl: `https://x.com/buildexpiry/status/${Date.now()}`,
    text: "Temperature toggle broken with an expired Build request",
  });
  expect(created.status).toBe(200);
  const caseId = (created.body as Snapshot).cases[0].id;
  await openCase(page, caseId);
  await page.getByRole("button", { name: "Advance demo workflow" }).click();
  await expect(
    page.getByRole("button", { name: "Request fresh Build approval" }),
  ).toBeDisabled();
  expect((await command(page, "request_build", { caseId })).status).toBe(400);

  // Age only this isolated fixture's pending request. Commands still use the
  // running production server's real authorization, persistence, and reducer.
  const file = path.resolve(".data/browser-tests.json");
  const release = await lockfile.lock(file, { realpath: false, retries: 10 });
  try {
    const state = JSON.parse(await fs.readFile(file, "utf8")) as ControlState;
    const approval = state.authorities.find(
      (item) =>
        item.caseId === caseId &&
        item.request.kind === "build" &&
        item.request.status === "pending",
    );
    expect(approval).toBeDefined();
    approval!.request.expiresAt = Date.now() - 1;
    await fs.writeFile(file, JSON.stringify(state), { mode: 0o600 });
  } finally {
    await release();
  }
  await page.reload();
  await openOperations(page);
  await page
    .getByRole("button", { name: "Request fresh Build approval" })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases
          .find((item) => item.id === caseId)!
          .approvals.filter(
            (item) => item.kind === "build" && item.status === "pending",
          ).length,
    )
    .toBe(1);
  const state = (await snapshot(page)).cases.find(
    (item) => item.id === caseId,
  )!;
  expect(state.phase).toBe("AWAITING_BUILD");
  expect(state.approvals.some((item) => item.status === "revoked")).toBe(true);
  expect(state.productionVerified).toBe(false);
  await expect(
    page.getByRole("button", { name: "Simulate Build", exact: true }),
  ).toBeVisible();
});

test("a supplemental human resolution preserves the earlier automatic receipt and needs exact approval", async ({
  page,
}) => {
  const resolutionCaseId = await candidateCase(page);
  await approveAndVerify(page, resolutionCaseId);
  const activation = await command(page, "persona_request_activation", {
    personaId: "friendly",
  });
  expect(activation.status).toBe(200);
  const persona = (activation.body as Snapshot).personas.find(
    (item) => item.id === "friendly",
  )!;
  expect(
    (
      await command(page, "demo_decide", {
        caseId: "policy:friendly",
        approvalId: persona.approvalId,
        decision: "approved",
      })
    ).status,
  ).toBe(200);
  const created = await command(page, "intake", {
    platform: "x",
    mode: "fixture",
    sourceUrl: `https://x.com/supplemental/status/${Date.now()}`,
    text: "opened the weather app to check if outside exists",
  });
  expect(created.status).toBe(200);
  const record = (created.body as Snapshot).cases[0];
  expect(record.route).toBe("social_engagement");
  const original = record.publications[0];
  expect(original.status).toBe("confirmed");
  await openCase(page, record.id);
  await page
    .getByRole("button", { name: "Prepare supplemental human resolution" })
    .click();
  await page
    .getByLabel("Verified resolution case")
    .selectOption(resolutionCaseId);
  await page
    .getByLabel("Exact supplemental reply")
    .fill(
      "The verified weather update now converts 20°C to 68°F. Thanks for checking.",
    );
  await page
    .getByRole("button", { name: "Request supplemental reply approval" })
    .click();
  await expect(
    page.getByText("Human publication only", { exact: true }),
  ).toBeVisible();
  let current = (await snapshot(page)).cases.find(
    (item) => item.id === record.id,
  )!;
  const followup = current.publications.find(
    (item) => item.supplementalToPublicationId === original.id,
  )!;
  expect(followup).toMatchObject({ manualOnly: true, resolutionCaseId });
  expect(followup.receiptUrl).toBeUndefined();
  expect(
    current.publications.find((item) => item.id === original.id)?.receiptUrl,
  ).toBe(original.receiptUrl);
  await page
    .getByRole("button", { name: "Simulate approval", exact: true })
    .click();
  await page.getByRole("button", { name: "Open manual composer" }).click();
  await page
    .getByLabel("Simulated receipt URL")
    .fill(`https://x.com/demo-brand/status/${Date.now()}`);
  await page
    .getByLabel("I am recording a simulated publication for this fixture.")
    .check();
  await page
    .getByLabel("Receipt / attestation notes")
    .fill(
      "Separate human-only fixture reply using verified resolution evidence",
    );
  await page
    .getByRole("button", { name: "Record publication receipt" })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).cases
          .find((item) => item.id === record.id)!
          .publications.find((item) => item.id === followup.id)?.status,
    )
    .toBe("manually_attested");
  current = (await snapshot(page)).cases.find((item) => item.id === record.id)!;
  expect(
    current.publications.find((item) => item.id === original.id)?.receiptUrl,
  ).toBe(original.receiptUrl);
  expect(
    current.publications.find((item) => item.id === original.id)?.status,
  ).toBe("confirmed");
});

test("case cancellation distinguishes before-dispatch from an unresolved publication", async ({
  page,
}) => {
  await identity(page, "engineer");
  const created = await command(page, "intake", {
    platform: "x",
    mode: "fixture",
    sourceUrl: `https://x.com/cancelearly/status/${Date.now()}`,
    text: "Temperature toggle broken; cancel before investigation dispatch",
  });
  expect(created.status).toBe(200);
  const caseId = (created.body as Snapshot).cases[0].id;
  await openCase(page, caseId);
  await page
    .getByLabel("Case cancellation reason")
    .fill("Operator cancels this case before work is dispatched");
  await page.getByRole("button", { name: "Cancel future case work" }).click();
  await expect(page.getByLabel("Case cancellation")).toContainText(
    "Canceled before dispatch",
  );
  expect((await command(page, "demo_advance", { caseId })).status).toBe(400);
  await expect(
    page.getByRole("button", { name: "Advance demo workflow" }),
  ).toHaveCount(0);
  await page.goto("/cases");
  const lateCaseId = await candidateCase(page);
  await approveAndVerify(page, lateCaseId);
  await identity(page, "admin");
  expect(
    (
      await command(page, "demo_fault", {
        caseId: lateCaseId,
        fault: "publication_unknown",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await command(page, "cancel_case", {
        caseId: lateCaseId,
        reason: "Admin is not an engineer or marketer",
      })
    ).status,
  ).toBe(403);
  await identity(page, "marketer");
  await page
    .getByLabel("Case cancellation reason")
    .fill("Cancel future work while the prior publication is investigated");
  await page.getByRole("button", { name: "Cancel future case work" }).click();
  await expect(page.getByLabel("Case cancellation")).toContainText(
    "Canceled with unresolved effects",
  );
  const late = (await snapshot(page)).cases.find(
    (item) => item.id === lateCaseId,
  )!;
  expect(late.outcome).toBe("canceled_with_unresolved_effects");
  expect(late.publications[0].status).toBe("unknown");
  await expect(page.getByLabel("Recovery action")).toHaveValue("reconcile");
  await expect(
    page.getByRole("button", { name: "Open manual composer" }),
  ).toHaveCount(0);
});

test("brio landing opens the board and preserves the selected theme", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("brio · Customer to Engineering");
  await expect(page.getByRole("link", { name: "brio drizzle · weather" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the board", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: "Open the board", exact: true }).first().click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByLabel("Incident board", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("another tab receives persisted card movement through the event stream without polling or reload", async ({ page, context }) => {
  await identity(page, "engineer");
  const observer = await context.newPage();
  try {
    const stream = observer.waitForResponse(response => new URL(response.url()).pathname === "/api/control/stream" && response.status() === 200);
    await observer.goto("/cases");
    expect((await stream).headers()["content-type"]).toContain("text/event-stream");
    await expect(observer.getByLabel("Incident board", { exact: true })).toBeVisible();
    await expect(observer.locator(".board-heading .listening")).toContainText("listening");
    // Block this observer's snapshot/command endpoint after its initial load.
    // Persisted changes must arrive on its existing stream, not through polling.
    await observer.route("**/api/control", route => route.abort());
    const marker = `Cross-tab temperature conversion ${randomUUID()}`;
    const created = await command(page, "intake", { platform: "x", mode: "fixture", sourceUrl: `https://x.com/streamfixture/status/${Date.now()}`, text: `${marker}: the temperature toggle is broken.` });
    expect(created.status).toBe(200);
    const record = (created.body as Snapshot).cases.find(item => item.text.includes(marker))!;
    const card = observer.locator(`[data-case-id="${record.id}"]`);
    await expect(card).toBeVisible();
    await expect(observer.getByRole("region", { name: "Triaged", exact: true }).locator(`[data-case-id="${record.id}"]`)).toBeVisible();
    expect((await command(page, "demo_advance", { caseId: record.id })).status).toBe(200);
    await expect(observer.getByRole("region", { name: "Build approval", exact: true }).locator(`[data-case-id="${record.id}"]`)).toBeVisible();
    await expect(card).toHaveAttribute("data-phase", "AWAITING_BUILD");
    await expect(observer.getByRole("region", { name: "Live event feed" })).toContainText(record.title);
    expect(observer.url()).toBe("http://127.0.0.1:3100/cases");
  } finally {
    await observer.close();
  }
});

test("stream failure shows a degraded status, falls back to HTTP updates, and reconnects without a reload", async ({ page, context }) => {
  await identity(page, "engineer");
  const observer = await context.newPage();
  let snapshotReads = 0;
  observer.on("request", request => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/control") snapshotReads++;
  });
  try {
    await observer.route("**/api/control/stream", route => route.fulfill({ status: 503, contentType: "text/plain", body: "Fixture event stream temporarily unavailable" }));
    await observer.goto("/cases");
    await expect(observer.getByLabel("Incident board", { exact: true })).toBeVisible();
    await expect(observer.locator(".board-heading .listening")).toContainText(/reconnecting|offline/);
    await expect(observer.locator(".board-heading .listening")).not.toContainText("listening");
    const before = snapshotReads;
    const marker = `Fallback temperature conversion ${randomUUID()}`;
    const created = await command(page, "intake", { platform: "x", mode: "fixture", sourceUrl: `https://x.com/fallbackfixture/status/${Date.now()}`, text: `${marker}: the temperature toggle is broken.` });
    expect(created.status).toBe(200);
    const record = (created.body as Snapshot).cases.find(item => item.text.includes(marker))!;
    await expect(observer.locator(`[data-case-id="${record.id}"]`)).toBeVisible();
    expect(snapshotReads).toBeGreaterThan(before);
    await expect(observer.locator(".board-heading .listening")).not.toContainText("listening");
    const reconnected = observer.waitForResponse(response => new URL(response.url()).pathname === "/api/control/stream" && response.status() === 200, { timeout: 15_000 });
    await observer.unroute("**/api/control/stream");
    expect((await reconnected).headers()["content-type"]).toContain("text/event-stream");
    await expect(observer.locator(".board-heading .listening")).toContainText("listening");
    await observer.route("**/api/control", route => route.abort());
    expect((await command(page, "demo_advance", { caseId: record.id })).status).toBe(200);
    await expect(observer.getByRole("region", { name: "Build approval", exact: true }).locator(`[data-case-id="${record.id}"]`)).toBeVisible();
  } finally {
    await observer.close();
  }
});

test("simulated autoplay pauses, resumes, completes with fixture receipts, and restarts as a fresh run", async ({ page }) => {
  test.setTimeout(75_000);
  await identity(page, "engineer");
  const controls = page.getByRole("region", { name: "Live demo controls" });
  await controls.getByRole("button", { name: /Run workflow$/ }).click();
  await expect.poll(async () => (await snapshot(page)).demoRun?.stepIndex).toBeGreaterThanOrEqual(2);
  await controls.getByRole("button", { name: /Pause$/ }).click();
  await expect.poll(async () => (await snapshot(page)).demoRun?.status).toBe("paused");
  const paused = (await snapshot(page)).demoRun!;
  await page.waitForTimeout(2500);
  const stillPaused = (await snapshot(page)).demoRun!;
  expect(stillPaused.stepIndex).toBe(paused.stepIndex);
  expect(stillPaused.events).toEqual(paused.events);
  await page.reload();
  await expect(controls.getByRole("button", { name: /Resume$/ })).toBeVisible();
  await controls.getByRole("button", { name: /Resume$/ }).click();
  await expect(page.getByRole("region", { name: "Resolved", exact: true }).locator(`[data-case-id="${paused.caseId}"]`)).toBeVisible({ timeout: 40_000 });
  const completed = await snapshot(page);
  expect(completed.demoRun?.status).toBe("completed");
  expect(completed.demoRun?.stepIndex).toBe(completed.demoRun?.totalSteps);
  expect(completed.demoRun?.events.map(event => event.title)).toContain("Reply confirmed");
  const result = completed.cases.find(item => item.id === paused.caseId)!;
  expect(result.sourceMode).toBe("fixture");
  expect(result.phase).toBe("COMPLETED");
  expect(result.publications[0]).toMatchObject({ mode: "fixture", status: "confirmed" });
  expect(result.approvals.every(item => item.simulated)).toBe(true);
  await expect(page.getByRole("region", { name: "Live event feed" })).toContainText("Reply confirmed");
  await expect(page.getByText("Demo data", { exact: true })).toHaveCount(0);
  await controls.getByRole("button", { name: /Restart$/ }).click();
  await expect.poll(async () => (await snapshot(page)).demoRun?.runId).not.toBe(paused.runId);
  await controls.getByRole("button", { name: /Pause$/ }).click();
  const restarted = await snapshot(page);
  expect(restarted.demoRun?.caseId).not.toBe(paused.caseId);
  expect(restarted.cases.find(item => item.id === paused.caseId)?.phase).toBe("COMPLETED");
  expect(restarted.demoRun?.status).toBe("paused");
});


test("rich workspace seed streams into the board and exposes persona conversations", async ({ page }) => {
  const result = JSON.parse(execFileSync("bun", ["--no-env-file", "scripts/seed-demo.ts"], {
    cwd: process.cwd(), encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH, FDE_DEMO_MODE: "true", FDE_DEMO_DATA_PATH: ".data/browser-tests.json" },
  }));
  expect(result.added).toBe(36);
  await expect(page.locator('[data-case-id="MND-1041"]')).toBeAttached();
  await expect(page.getByText("Demo data", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Live demo controls" })).not.toContainText(/simulated/i);
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("umbrella optimist");
  await expect(page.locator("[data-case-id]")).toHaveCount(1);
  await page.locator('[data-case-id="MND-1071"]').click();
  await expect(page.getByRole("heading", { name: "BRAND REPLY", exact: true })).toBeVisible();
  await expect(page.locator(".reply-preview")).toContainText("Playful Challenger");
  await expect(page.locator(".reply-preview")).toContainText("Respectfully: bruh.");
  await expect(page.locator(".ticket-timeline")).not.toContainText("Approve build");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/dashboard");
  await expect(page.locator(".metric-stats")).toContainText("Signals recorded");
  await expect(page.locator(".metric-stats")).not.toContainText(/simulated/i);
});
