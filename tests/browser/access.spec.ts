import { expect, test } from "@playwright/test";

test("hosted pages and APIs require workspace access; wrong codes do not set a cookie", async ({
  page,
}) => {
  await page.goto("/controls");
  await expect(page).toHaveURL(/\/access$/);
  await expect(
    page.getByRole("heading", { name: "Workspace access" }),
  ).toBeVisible();
  const denied = await page.request.get("/api/control");
  expect([401, 403]).toContain(denied.status());
  const deniedStream = await page.request.get("/api/control/stream", { timeout: 5000 });
  expect([401, 403]).toContain(deniedStream.status());
  await page.getByLabel("Workspace access code").fill("incorrect-access-code");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "access code was not accepted" }),
  ).toContainText("access code was not accepted");
  await expect(page.getByLabel("Workspace access code")).toHaveValue("");
  expect(await page.context().cookies()).toEqual([]);
});

test("correct hosted code opens the workspace with an HttpOnly cookie and keeps secrets server-only", async ({
  page,
}) => {
  await page.goto("/access");
  await page
    .getByLabel("Workspace access code")
    .fill("browser-test-access-code");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3101/");
  await expect(
    page.getByRole("link", { name: "Open the board", exact: true }),
  ).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
  });
  expect(await page.evaluate(() => document.cookie)).toBe("");
  expect(await page.content()).not.toContain("browser-test-service-key");
  const response = await page.request.get("/api/control");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.actor.name).toBe("Setup required");
  expect(body.actor.roles).toEqual([]);
  expect(JSON.stringify(body)).not.toContain("browser-test-service-key");
  expect(body.mode).toBe("live");
  await expect(page.getByLabel("Demo identity")).toHaveCount(0);
});

test("tampered cookies and cross-origin access-code submissions are rejected", async ({
  page,
}) => {
  const rejected = await page.request.post("/api/access", {
    headers: { Origin: "https://untrusted.example.test" },
    data: { code: "browser-test-access-code" },
  });
  expect(rejected.status()).toBe(403);
  expect(rejected.headers()["set-cookie"]).toBeUndefined();
  const accepted = await page.request.post("/api/access", {
    data: { code: "browser-test-access-code" },
  });
  expect(accepted.status()).toBe(200);
  const cookie = (await page.context().cookies())[0];
  await page
    .context()
    .addCookies([{ ...cookie, value: `${cookie.value}tampered` }]);
  await page.goto("/controls");
  await expect(page).toHaveURL(/\/access$/);
  const denied = await page.request.get("/api/control");
  expect([401, 403]).toContain(denied.status());
});
