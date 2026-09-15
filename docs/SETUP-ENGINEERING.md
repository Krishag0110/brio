# brio setup: GitHub jobs and the first weather deployment

This continues [Step 9 of the setup guide](SETUP-GUIDE.md#step-9). Complete the main guide's account steps first. Keep that guide open for your private file locations and deployment addresses.

**Why this part exists:** GitHub will generate and check a weather fix. Before that can work, it needs permission to report checks, a prepared environment in which to run code, and an actual deployed starting version of the weather app.

Follow sections 1–6 in order. The existing signing keys and PR credential are already installed; leave them in place.

**Existing installation update:** Checks App `4934302` is configured, the first controller PR merged at `8a7636e2709d039773afa73857e6cb66f08a7d6f`, and the weather bootstrap passed before weather PR #1 merged normally. [Weather production](https://mend-weather.vercel.app) now serves weather main `161835dba251f9739d25194ec21db0f2461df989`, tree `2fc58d5c57da18d60ff7ece9952faf273117f22d`. Both staged and production identities were verified by `/api/version` and 34-check Cloud Run browser runs; the intentional `20°C → 20°F` defect remains. The sandbox image and GitHub keyless pull variables are configured; use [GCP sandbox notes](SETUP-CODING-SANDBOX-GCP.md). Production `GITHUB_CONTROLLER_SHA` tracks the latest reviewed controller `main` commit, synchronized after each merge. The brio rename is deployed, tested and pushed; its reviewed merge is pending. The real signed Build remains to be exercised. [Deployment evidence](../artifacts/weather-main-baseline-deployment.json) and [remaining checklist](SETUP-REMAINING.md) record the current state; sections below retain the setup procedure.

## 1. Create the GitHub App that reports test results

**This is a GitHub App, not a new repository.** It only reports checks on the weather repository.

1. Sign in as `Aarush-Dubey` and open [GitHub Apps settings](https://github.com/settings/apps).
2. Click **New GitHub App**.
3. Enter a unique name, for example `brio Weather Checks Aarush`. If the name is taken, add a suffix.
4. In **Homepage URL**, enter `https://github.com/Aarush-Dubey/hackathon`. The brio website does not have to be online yet.
5. Under **Webhook**, uncheck **Active**. You do not need a webhook URL or an OAuth callback URL for this app.
6. Expand **Repository permissions**. Find **Checks** and select **Read and write**. Leave other optional permissions at their defaults.
7. Under **Where can this GitHub App be installed?**, choose **Only on this account**. Click **Create GitHub App**.
8. On the app's settings page, copy the numeric **App ID**. Do not copy the Client ID.
9. Scroll to **Private keys → Generate a private key**. Your browser downloads a `.pem` file. Keep it private.
10. In the app's left menu, select **Install App**. Install it on `Aarush-Dubey`, choose **Only select repositories**, and select **`hackathon-weather`**. Confirm installation.

### Save those two values in the controller repository

1. Open [controller repository environments](https://github.com/Aarush-Dubey/hackathon/settings/environments).
2. Click **engineering-pr-writer**.
3. Under **Environment variables**, click **Add environment variable**. Name it `WEATHER_CHECKS_APP_ID`; paste the numeric App ID as its Value; save.
4. Under **Environment secrets**, click **Add environment secret**. Name it `WEATHER_CHECKS_APP_PRIVATE_KEY`.
5. Open the downloaded `.pem` in a text editor. Copy **all** its text, including its `BEGIN` and `END` lines, into the secret Value and save.

**Done when:** the app is installed on weather and both names appear in the `engineering-pr-writer` environment. GitHub hides the secret value after saving; that is expected. There is no need to send the key to anyone in chat.

Official references: [GitHub App registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) and [private keys](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps).

## 2. Publish the reviewed controller and weather setup changes

A **pull request / PR** proposes code changes. A **check** is the recorded result of testing a specific commit. The protected repositories require checks before merging.

### 2A. Controller first

1. Open [controller pull requests](https://github.com/Aarush-Dubey/hackathon/pulls).
2. Find the implementation PR from `codex/hackathon-mvp`. If it has not been published yet, the implementation work is still in progress; you can finish the other account setup while it is prepared.
3. Review the changes and the **Checks** tab. The required controller check is named **checks**.
4. When the PR is ready and its checks pass, use **Ready for review** if it is a draft, then merge it through GitHub.

### 2B. Weather's Bun setup

The weather app starts with an intentional bug, so its initial setup needs a check that verifies **the seed remains intact**. It must not pretend that the bug is already fixed.

1. Confirm section 1's Checks App is configured and section 2A's controller changes have merged.
2. Open the controller repository's **Actions** tab.
3. Select **Validate reviewed weather Bun bootstrap** in the left sidebar. If missing, the workflow is not yet on the controller's `main` branch.
4. Click **Run workflow**, select branch **main**, and run it. There is no SHA field to fill: the reviewed workflow pins the original seed and the exact Bun setup commit.
5. Open the run and wait for completion. It validates the narrow Bun changes, builds the app and reproduces the intentionally wrong Fahrenheit reading before writing the required check.
6. Open [weather PR #1](https://github.com/Aarush-Dubey/hackathon-weather/pull/1). Confirm **Protected weather** passes for the PR's current commit. The check description should explicitly say the seeded defect remains.
7. Review the PR, click **Ready for review** if needed, then merge it.

**Current implementation status:** [bootstrap run 34786278162](https://github.com/Aarush-Dubey/hackathon/actions/runs/34786278162) passed on the merged controller. Checks App `4934302` attached `Protected weather` check `103802492064` to exact Bun PR head `a96c50ee70b0a97171b03cde8ea10df6a2f008c8`. Its receipt truthfully records the seeded defect and all 34 checks. Weather PR #1 then merged normally at `161835dba251f9739d25194ec21db0f2461df989`, with its reviewed tree unchanged. This bootstrap step is complete for the existing installation.

If someone changes weather PR #1's commit, this pinned bootstrap check should refuse it. Have the changed baseline reviewed and the bootstrap pins updated; do not mark an unrelated commit as passed or remove branch protection.

**Done when:** both reviewed changes are on their repositories' `main` branches. The weather conversion defect is still present. The later generated fix uses a separate PR and actual passing regression tests.

## 3. Build the environment that runs generated code

This is a **Docker image**: a prepared runtime with Bun and browser-test dependencies. GitHub downloads it to run the candidate in isolation. It is not the brio website or the weather website.

### 3A. Make sure Docker works

1. Open Terminal and run `docker info`.
2. If it prints Docker's server information, continue.
3. If it says permission denied or cannot connect to the daemon, complete the [official Docker installation for your operating system](https://docs.docker.com/engine/install/) or use another machine with working Docker. The current laptop account has not yet been able to access its Docker daemon. Do not continue as if the image was built.

### 3B. Create a registry token and sign in

1. Open [GitHub token settings](https://github.com/settings/tokens).
2. Choose **Generate new token → Generate new token (classic)**.
3. Name it `brio image upload`, choose an expiry covering setup, and grant **write:packages**. This token is for uploading the image; it does not replace the app's existing GitHub credentials.
4. Generate and copy the token.
5. Run this in Terminal:

```sh
docker login ghcr.io -u Aarush-Dubey
```

6. At the **Password** prompt, paste the token and press Enter. The terminal may show no characters while you paste. Do not put the token directly into the command line.

### 3C. Build and upload

Use the reviewed controller checkout. If `git status --short` lists source changes, finish/review those changes before calling the image reviewed.

```sh
cd /home/big-daddy/Desktop/hackathon
git status --short
docker build --platform linux/amd64 -f workers/engineering/Dockerfile -t ghcr.io/aarush-dubey/fde-weather-sandbox:bun-1.4.2 .
docker push ghcr.io/aarush-dubey/fde-weather-sandbox:bun-1.4.2
```

Wait for each command to succeed before running the next. A failed build means there is nothing ready to publish.

1. Open your [GitHub packages](https://github.com/Aarush-Dubey?tab=packages) and select `fde-weather-sandbox`.
2. Open **Package settings → Change visibility → Public** and follow GitHub's confirmation.
3. This reviewed Dockerfile contains runtime dependencies, not your `.env`, app secrets or private weather source. Public visibility lets the current workflow download the image without a registry credential. A private image would require an additional registry-login implementation.
4. Run:

```sh
docker pull ghcr.io/aarush-dubey/fde-weather-sandbox:bun-1.4.2
```

5. Copy the `sha256:...` value printed after **Digest**. This is the fixed identity of the uploaded image.
6. In [controller environments](https://github.com/Aarush-Dubey/hackathon/settings/environments), open **engineering-controller → Environment variables → Add environment variable**.
7. Set the name to `CODING_SANDBOX_IMAGE`. Its value must be the complete address in this form, using the real digest you copied:

```text
ghcr.io/aarush-dubey/fde-weather-sandbox@sha256:YOUR_ACTUAL_DIGEST
```

Do not save the literal words `YOUR_ACTUAL_DIGEST` or the mutable `:bun-1.4.2` tag as the setting.

**Done when:** the image can be downloaded and the full immutable address is saved in `engineering-controller`. A real signed Build in the final test is still needed to verify execution inside it.

Official reference: [GitHub Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

<a id="seed-deployment"></a>
## 4. Deploy the deliberately buggy starting weather version

**Prerequisites:** weather Bun PR merged, separate weather Vercel project created, automatic production-domain assignment disabled as described in main guide Step 7.

### 4A. Get the exact source version

Open a new terminal:

```sh
export PATH="/home/big-daddy/.bun/bin:$PATH"
cd /home/big-daddy/Desktop/hackathon-weather
git status --short
```

The status should print no changed files. If it lists changes, preserve/review them before switching branches. Do not discard them to follow this guide.

Then run each command:

```sh
git switch main
git pull --ff-only
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
bunx vercel login
bunx vercel link
```

`git rev-parse HEAD` prints the **commit ID**, the identity of this source version. The next command prints its **tree ID**, the identity of its file contents. Save both strings in your private address note. They are public identifiers, not passwords.

The Vercel commands open a browser login and ask you to choose the account/project. Select the existing **weather** project, never `mend-control`. Linking creates local project metadata; it does not deploy yet.

### 4B. Add the public identity values

Open **weather Vercel project → Settings → Environment Variables**. Add these for **Production**:

| Name | Value |
| --- | --- |
| `WEATHER_RUN_ID` | `seed-2026-09-14` |
| `WEATHER_CANDIDATE_ID` | `seed-baseline` |
| `WEATHER_HEAD_SHA` | The complete commit ID from 4A. |
| `WEATHER_TREE_DIGEST` | The complete tree ID from 4A. |
| `WEATHER_TRUSTED_TEST_REVISION` | `weather-protected-v1` |
| `WEATHER_BUILD_CONFIG_REVISION` | `weather-build-v1` |
| `WEATHER_DEPLOYMENT_MODE` | `live` |

These seven values are safe public identity information. Do not add OpenAI, Slack, GitHub, controller or social credentials to weather.

### 4C. Upload that same source and promote it

Keep the terminal in the weather folder. This block reads the commit and tree IDs itself, so you do not need to paste them into the command:

```sh
weather_setup_commit="$(git rev-parse HEAD)"
weather_setup_tree="$(git rev-parse 'HEAD^{tree}')"
bunx vercel deploy --prod --skip-domain   --meta runId=seed-2026-09-14   --meta candidateId=seed-baseline   --meta headSha="$weather_setup_commit"   --meta treeDigest="$weather_setup_tree"   --meta trustedTestRevision=weather-protected-v1   --meta buildConfigRevision=weather-build-v1
```

1. Wait for **Ready** and copy the deployment URL printed by Vercel.
2. Open that URL with `/api/version` appended. It shows a JSON object. Confirm its run ID, candidate ID, commit/tree IDs and test/build revisions match the table. `mode` must be `live`.
3. If the values are blank or different, fix the weather project's Production variables and redeploy the same reviewed source before continuing.
4. Back in Terminal, type `bunx vercel promote `, paste the actual deployment URL after the space, and press Enter. Confirm the **weather** project/domain when prompted.
5. Open the stable weather domain and repeat the `/api/version` check. On the weather page, confirm `20°C` switches to the intentionally wrong `20°F`.
6. In **Convex Production**, set `FDE_BASE_SHA` to that exact deployed commit ID. Update the same field in your local `.env` worksheet.

**Done when:** the production domain serves the identified seed commit and the seeded bug is visible. Later fixes are promoted only through current Slack Go approval and the application's protected release path.

Official reference: [Vercel staged deployment commands](https://vercel.com/docs/cli/deploying-from-cli).

## 5. Add the final callback addresses and code revision

### GitHub environment variables

1. Open [controller environments](https://github.com/Aarush-Dubey/hackathon/settings/environments).
2. In **engineering-controller**, add `CONVEX_SITE_URL` with your actual `https://….convex.site` address.
3. In **engineering-pr-writer**, add the same `CONVEX_SITE_URL`.
4. Keep the existing `WEATHER_TARGET_REPOSITORY=Aarush-Dubey/hackathon-weather` and `WEATHER_DEFAULT_BRANCH=main` values.

### Convex Production

1. Open the controller repository on GitHub, select `main`, and open its latest reviewed commit. Copy its full 40-character commit SHA.
2. Save that value as `GITHUB_CONTROLLER_SHA` in Convex Production and local `.env`.
3. Confirm the following values exist in Convex:

| Name | Value |
| --- | --- |
| `GITHUB_CONTROLLER_REPOSITORY` | `Aarush-Dubey/hackathon` |
| `GITHUB_CONTROLLER_BRANCH` | `main` |
| `GITHUB_CONTROLLER_SHA` | Latest reviewed controller `main` commit; synchronize production after each merge. |
| `FDE_WEATHER_REPOSITORY` | `Aarush-Dubey/hackathon-weather` |
| `GITHUB_DEFAULT_BRANCH` | `main` |
| `GITHUB_REQUIRED_CHECKS` | `Protected weather` |
| `FDE_BASE_SHA` | Exact deployed weather seed commit from section 4. |
| `GITHUB_DISPATCH_TOKEN` | Existing credential from the private prepared Convex bundle. |
| `GITHUB_READ_TOKEN` | Existing credential from that bundle. |
| `GITHUB_RELEASE_TOKEN` | Existing credential from that bundle. |

The controller commit and weather commit are **two different values**. The separate GitHub repository variable `WEATHER_BASELINE_SHA` selects the CI fixture; it does not automatically update the live seed setting.

After every reviewed merge into controller `main`, synchronize production `GITHUB_CONTROLLER_SHA` to the exact resulting commit before requesting a new Build. Existing approvals refer to their original scope and can become stale.

## 6. Final engineering checklist

- [ ] Checks App installed on weather; ID and complete PEM saved in `engineering-pr-writer`.
- [ ] Reviewed controller implementation merged and its checks passed.
- [ ] Weather Bun bootstrap check passed for its exact head; reviewed Bun PR merged.
- [ ] Reviewed Docker image uploaded and its immutable digest saved in `engineering-controller`.
- [ ] Both GitHub environments contain the hosted Convex `.site` callback address.
- [ ] Weather production serves the exact seeded commit and public identity.
- [ ] Convex contains the separate exact controller and weather revision values.
- [ ] Verifier and Linear are ready from the main guide.

Return to [Step 10: Connect X](SETUP-GUIDE.md#step-10), then perform the real approval/build/release tests in Step 11. This guide's configuration checklist is not a claim that those live actions have already succeeded.
