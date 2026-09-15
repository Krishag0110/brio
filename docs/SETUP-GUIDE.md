# brio setup guide — start here

Updated: **14 September 2026**. Written for the person setting up the accounts, even if you have never configured an API before.

**Product name:** brio, previously Mend. Existing `mend-*` project IDs, URLs, service names and paths remain valid. The Slack app is still registered as `Mend`; the examples below distinguish new setup from that existing registration.

**For this existing installation, start with the [remaining setup checklist](SETUP-REMAINING.md). Do not recreate the completed projects.** For a new installation, start with Step 1 and follow the numbered steps in order. Each step tells you what to open, what to enter, where to save it, and how to check it. You do not need to read the PRD or understand the code first.

## What you are setting up

brio is the website with the Kanban board. It receives a complaint, asks an engineer in Slack whether to build a fix, verifies the fix, asks the marketer in Slack whether to release it, and then publishes the approved reply. The weather website is a **second, separate app** used to demonstrate that process.

| Service | Plain-English job | Do you need to create anything? |
| --- | --- | --- |
| GitHub | Stores both apps and runs the code-fixing jobs | Controller merged; Checks App and sandbox image exist. Both repositories merged and pinned; signed execution verification remains. |
| OpenAI | Generates classifications, patches and persona replies | Your key is already saved and tested. Reuse it. |
| Convex | Stores cases and runs brio's background work | Done: mend-hackathon / resilient-perch-131. |
| Vercel | Makes the two websites available on the internet | Done: mend-hackathon and mend-weather; API token verified. |
| Slack | Where the engineer clicks Build and marketer clicks Go | Existing app registered as `Mend`, hosted callback and roles configured; actual human decisions remain to be tested. |
| Linear | Stores the engineering ticket | Key and Drizzle/Done IDs configured; live issue write still unverified. |
| Google Cloud (GCP) | Runs the two automated browsers on Cloud Run | Workers active; weather browser baseline and sandbox runtime verified. |
| X | The brand account that receives and sends replies | @Vinaychamoc5 is ready after operator-authorized enablement; polling off, real posting check remains. |
| Reddit | An additional reply destination | Skipped by user. Disabled and paused; no setup action required. |

**No Clerk account, weather API key, or ChatGPT connector installation is needed.** The weather readings are fixed test data. Application model calls use `gpt-5-mini`. The existing application model ledger retains its configured limit. Per the later instruction, no GCP budget or alert policy was created.

### Choose how far to go

- **See the seeded hosted demo:** open [the brio board](https://mend-hackathon.vercel.app/cases), enter the privately shared workspace access code, and click **Run workflow**. No new service setup is required.
- **See the demo on this laptop:** do Step 1 only. It simulates the external services and clearly labels that fact.
- **Finish this existing installation:** use the [remaining checklist](SETUP-REMAINING.md), then the live checks in Step 11.
- **Create a new installation:** Steps 2–11 provide the full reference procedure; completed account steps do not need repeating here.
- **Reddit:** deferred by the user. For the requested demo recording, use the [recording handoff](brio-RECORDING-HANDOFF.md).

### Jump to a step

1. [Open the local demo](#step-1)
2. [Understand where keys go](#step-2)
3. [Create the Convex backend](#step-3)
4. [Put brio on Vercel](#step-4)
5. [Set up Slack decisions](#step-5)
6. [Set up Linear tickets](#step-6)
7. [Set up the weather website](#step-7)
8. [Create the two browser workers](#step-8)
9. [Finish GitHub's code-fixing setup](#step-9)
10. [Connect the X account](#step-10)
11. [Check everything in order](#step-11)
12. [Troubleshooting](#troubleshooting)

<a id="step-1"></a>
## Step 1 — Open the demo on this laptop

**You need:** this computer. No new account or API key.

1. Open the Terminal application. On Ubuntu, **Ctrl + Alt + T** opens it.
2. Copy this whole block, paste it into Terminal, and press Enter:

```sh
export PATH="/home/big-daddy/.bun/bin:$PATH"
cd /home/big-daddy/Desktop/hackathon
bun run dev:demo
```

3. Wait for the terminal to say **Ready**. Leave that terminal open; it is running the website.
4. Open the **Local** address printed in the terminal, normally [http://127.0.0.1:3000](http://127.0.0.1:3000). If it prints port `3002`, open that address instead.
5. Open the board and use its demo controls. Keep a second tab open on the board to watch the same case move between columns.

**You are done when:** the brio page opens and identifies the session as a demo. Simulated Slack decisions and publication receipts are expected here.

To open the separate weather app, open a **second** terminal and run:

```sh
export PATH="/home/big-daddy/.bun/bin:$PATH"
cd /home/big-daddy/Desktop/hackathon-weather
bun run dev
```

Open the Local address it prints, normally [http://127.0.0.1:3001](http://127.0.0.1:3001). Switching the initial `20°C` reading to Fahrenheit shows `20°F`. **That is the intentionally planted bug.** The demonstration's goal is to repair it to `68°F`.

To stop a server that you started, select its terminal and press **Ctrl + C**. If a server is already running, use its printed address instead of launching another copy.

If `bun` or dependencies are missing, see [Troubleshooting](#troubleshooting). These paths refer to this laptop's actual folders.

<a id="step-2"></a>
## Step 2 — Know where to paste the keys

An **API key/token** is a password that lets one application use another service. An **environment variable** is simply a named setting. For example:

```text
CONTROL_APP_ORIGIN=https://my-mend.vercel.app
```

In a website's environment-variable form, enter `CONTROL_APP_ORIGIN` in **Name/Key** and `https://my-mend.vercel.app` in **Value**. Do not put the entire line in the Value box. In an `.env` file, keep the entire `NAME=value` line. Do not add spaces around `=` or include example text such as `PASTE_HERE` in a final value.

**A setting saved on your laptop is not automatically copied to Vercel, Convex, or GCP.** The steps below tell you each destination explicitly.

### Open the private files already prepared for you

1. Open the Files application.
2. Press **Ctrl + L**, paste this folder path, and press Enter:

```text
/home/big-daddy/Desktop/hackathon/.data/deployment-secrets
```

3. Right-click the file you need and choose **Open With → Text Editor**. The files contain passwords; keep their contents out of screenshots, chat messages and Git commits.

| File in that folder | What to do with it |
| --- | --- |
| `next-hosted.env` | Current hosted brio settings; already installed in Vercel. |
| `convex-hosted.env` | Hosted production settings; already imported. Keep later targeted credential updates synchronized before reimporting. `convex.env` is the older preparation bundle. |
| `social.env` | Current worker settings are installed in Cloud Run; use this private bundle only for coordinated future updates. |
| `verifier.env` | Current verifier settings are installed in Cloud Run; use this private bundle only for coordinated future updates. |
| `engineering.env` | Signing keys already installed in GitHub. Keep them; do not replace them with new random values. |

The generated passwords already match across these files. Copy them exactly. The directory is excluded from Git. Do not put real values in this guide or in a new Markdown file inside `docs/`.

### Your main file for entering new values

Open `/home/big-daddy/Desktop/hackathon/.env` in your text editor when an authorized configuration change is needed. Slack, Linear, Vercel and worker settings are already configured; blank optional fields do not mean those services need recreating. Preserve the existing values. Vercel linking added an OIDC value to `.env.local`; it does not replace the application settings. Keep both files private.

The private service bundles above are starting values for hosting. When you add a new value to `.env`, also copy it into the particular online service named in its step. Nothing synchronizes these files automatically. Do not import all of `.env` into a provider: it contains settings for several different services and local URLs.

### Keep a note of these addresses

Create a private note on your computer and fill it in as you go. These are addresses, not passwords.

```text
brio website:                  [filled in at Step 4]
Convex function URL (.cloud):   [filled in at Step 3]
Convex callback URL (.site):    [filled in at Step 3]
Weather website:               [filled in at Step 7]
Weather hostname only:         [same address without https://]
Cloud Run verifier URL:           [filled in at Step 8]
Cloud Run social-worker URL:      [filled in at Step 8]
```

For example, `https://calm-fox-123.convex.cloud` is a Convex function URL and `https://calm-fox-123.convex.site` is its callback address. **Copy both from your actual deployment.** Do not use these made-up examples or the laptop's `127.0.0.1` address for an online service.

### What is already done

Both private repositories exist: [brio/controller](https://github.com/Aarush-Dubey/hackathon) and [weather](https://github.com/Aarush-Dubey/hackathon-weather). Their branch protections, read-only weather checkout key, GitHub signing keys and PR-writing credential are configured. Your OpenAI key has also been tested.

**Publication history:** initial controller CI [34785978933](https://github.com/Aarush-Dubey/hackathon/actions/runs/34785978933) passed on `e8f2dd0`; controller [PR #1](https://github.com/Aarush-Dubey/hackathon/pull/1) merged to protected `main` as `8a7636e2709d039773afa73857e6cb66f08a7d6f`. Hosted brio runs lowercase-brand source `872c226`, and production Convex and the verifier run source `6981750`, and the social worker runs `872c226`. Weather bootstrap passed and weather PR #1 merged as `161835dba251f9739d25194ec21db0f2461df989`. Production `GITHUB_CONTROLLER_SHA` tracks the latest reviewed controller `main` commit and is synchronized after each merge; the merged weather baseline is deployed and verified at staged and stable URLs, and production `FDE_BASE_SHA` is pinned to `161835dba251f9739d25194ec21db0f2461df989`. The lowercase brio rename is deployed, tested and pushed to GitHub; its reviewed publication to protected `main` is pending. See [remaining setup](SETUP-REMAINING.md) for the latest remaining work.

<a id="step-3"></a>
## Step 3 — Create the hosted Convex backend

**Existing installation: complete.** Production `resilient-perch-131` is deployed with hosted settings and authenticated access verified. Skip this step for the current project. The instructions below are for a new installation.

**For a new CLI login:** run these commands from the brio folder and finish browser sign-in when prompted:

```bash
export PATH="/home/big-daddy/.bun/bin:$PATH"
cd /home/big-daddy/Desktop/hackathon
bun --no-env-file x --no-install convex login --login-flow poll --device-name mend-development
bun --no-env-file x --no-install convex login status
```

A successful status check identifies your account/team. Do not share access tokens in chat. Device login links expire; rerun the login command for a fresh link if needed.


**Purpose:** gives brio an online database and a place to run background tasks. The existing local Convex instance does not accept callbacks from Slack or GitHub.

### 3A. Create the project and copy its addresses

1. Open [dashboard.convex.dev](https://dashboard.convex.dev) and sign in. Using the same GitHub account is convenient.
2. Choose **Create Project**. Name it `mend`. If it asks for a team, select your own team.
3. Open the project. Select **Production** in the deployment selector. Stay on Production for this guide.
4. Open **Settings → General (called URL & Deploy Key in older dashboards)**. Copy the deployment's `.convex.cloud` URL and `.convex.site` URL into your private address note.
5. Under **Deploy keys**, generate a **Production deploy key** named `mend-setup` with `deployment:deploy` permission. It lets the command in 3C upload the backend code to this exact project. Do not choose a Preview deploy key.
6. In the private folder from Step 2, create a plain-text file named `convex-deploy.env`. Put this one line in it, replacing only the text after `=` with the key you just copied:

```dotenv
CONVEX_DEPLOY_KEY=PASTE_YOUR_PRODUCTION_DEPLOY_KEY_HERE
```

Save it. Do not paste this key into Vercel, the weather app, or a chat message.

### 3B. Add the backend settings

1. Open the current private `convex-hosted.env` file in your text editor. Preserve later targeted credential updates before importing an older bundle.
2. In the Convex **Production** deployment, open **Settings → Environment Variables**.
3. For each non-empty `NAME=value` line in that file, add one environment variable using the Name and Value fields. Skip any line starting with `#`.
4. Confirm `OPENAI_API_KEY` is included. It is the working key you supplied; you do not need a second one.
5. Leave `FDE_SOCIAL_POLLING_ENABLED=false` and `REDDIT_API_APPROVED=false` for now. These keep automatic intake and optional Reddit inactive while you finish setup.
6. Set `FDE_INFRASTRUCTURE_COMMITTED_USD` to the hosting/build amount already committed in US dollars. Use `0` only if you have committed nothing. This records the budget; it does not pay the provider or cancel charges.

Some URLs and provider credentials will be added in later steps. You can upload the backend before completing those connections.

### 3C. Upload the code to this project

From Terminal, run:

```sh
export PATH="/home/big-daddy/.bun/bin:$PATH"
cd /home/big-daddy/Desktop/hackathon
chmod 600 .data/deployment-secrets/convex-deploy.env
bun --no-env-file x --no-install convex deploy --env-file .data/deployment-secrets/convex-deploy.env
```

The command uses the private deployment key to select the hosted project. It does not need you to replace the existing local anonymous development configuration. If it shows a target confirmation, verify it is the Production project you created.

**You are done when:** the command succeeds, the Production **Functions** page contains brio functions such as `control`, and both Convex addresses are in your note. The hosted database starts separately; local demo records, evaluations and ledger history are not copied by this command.

**If it fails:** `Unauthorized` usually means the wrong deploy key or an extra space/newline inside the value. A missing backend key is fixed in **Convex Production**, not in the weather project.

Official reference: [Convex environment settings](https://docs.convex.dev/production/environment-variables) and [deployment command](https://docs.convex.dev/cli/reference/deploy).

<a id="step-4"></a>
## Step 4 — Put the brio website on Vercel

**Existing installation: complete.** [Hosted brio](https://mend-hackathon.vercel.app) is deployed with shared-code admission verified. Skip project creation for this installation.

**CLI alternative for a new installation:** Vercel CLI is installed. Run `vercel login`, complete browser sign-in, then verify your account with `vercel whoami` before creating projects.


**You need:** the Convex `.cloud` address and private `next-hosted.env` file. This project is for **brio**, not weather.

1. Open [vercel.com/new](https://vercel.com/new) and sign in with GitHub.
2. Under **Import Git Repository**, find `Aarush-Dubey/hackathon` and click **Import**. If it is absent, use **Adjust GitHub App Permissions** and allow Vercel access to that repository.
3. Use project name `mend-control` if available. Keep the detected **Next.js** framework and root directory `./`.
4. Expand **Build and Output Settings** and turn on the command overrides. Enter:

| Field | Exact value |
| --- | --- |
| Install Command | `bunx bun@1.4.2 install --frozen-lockfile --ignore-scripts` |
| Build Command | `bunx bun@1.4.2 run build` |

5. Expand **Environment Variables**. Add each line from `next-hosted.env`, then add the following settings. For later edits, the same form is under **Project → Settings → Environment Variables**. Select **Production** as the target environment.

| Name | Value to enter |
| --- | --- |
| `CONTROL_SERVICE_SECRET` | Already in `next-hosted.env`; must equal the value in Convex. |
| `CONTROL_ACCESS_PASSWORD` | Already in `next-hosted.env`; this is the code you will type to enter brio. |
| `NEXT_PUBLIC_CONVEX_URL` | Your actual `.convex.cloud` URL from Step 3. |
| `FDE_LOCAL_ACCESS` | `false` |
| `FDE_DEMO_MODE` | `false` |

6. Deploy the reviewed brio commit and verify the source shown on Vercel. After each protected controller merge, synchronize production `GITHUB_CONTROLLER_SHA` to the resulting reviewed `main` commit before a new Build.
7. When the deployment says **Ready**, copy its stable project address, such as `https://mend-control.vercel.app`, into your note. Use the project's normal domain, not a different temporary URL for every build.
8. Add `CONTROL_APP_ORIGIN` with that exact address in **both** places: brio Vercel environment variables and Convex Production environment variables. Do not add a trailing path such as `/cases`.
9. In Vercel, open **Deployments**, choose the latest correct deployment's **… → Redeploy**, and confirm. Vercel needs a redeploy after environment-variable changes.
10. Open the brio address in a private/incognito browser window. Enter the value of `CONTROL_ACCESS_PASSWORD` from `next-hosted.env` when the access page appears.

**You are done when:** the hosted board opens after entering the code. A different browser profile, or a new private session after closing all existing private windows, should still require the code. Connections can show missing services at this stage; you have not set those up yet.

**If the board cannot connect:** compare the `CONTROL_SERVICE_SECRET` in Vercel and Convex character for character, then check the `.cloud` address and redeploy Vercel.

Official reference: [Vercel environment settings](https://vercel.com/docs/environment-variables) and [pinning Bun](https://vercel.com/kb/guide/how-to-pin-a-specific-bun-version-for-vercel-builds).

<a id="step-5"></a>
## Step 5 — Set up Slack decisions

**Current setup:** brio’s Slack app remains registered under its legacy name `Mend` in `BitsUp` with `chat:write` and has joined `#mend-approvals`. The replacement bot token passed Slack's `auth.test`. All six settings are installed in hosted production Convex, with Elen (`U0C1L62486M`) as engineer and David (`U0C1DJRE4KF`) as marketer.

Socket Mode is **Off** and Interactivity is **On**. The callback `https://resilient-perch-131.convex.site/slack/interactions` was saved and verified after reloading settings. An unsigned request correctly returns HTTP 403. A signed non-action probe passed signature validation and was refused for missing action context. **Only the live human approval test remains**; skip 5A–5C for the existing app.

For a future callback change, open the existing [Slack app registered as Mend](https://api.slack.com/apps/A0C1N1T82UU/general) → **Interactivity & Shortcuts**, update **Request URL**, save and reload to confirm. Keep the matching production Convex settings synchronized.

To change the marketer later, open that person’s Slack profile → **More (⋯) → Copy member ID**. Save the resulting `U…` ID as `SLACK_MARKETER_USER_IDS` in `.env` and the matching Convex deployment. The live check is in Step 11; credentials alone do not establish successful button delivery.


**Purpose:** the engineer approves **Build** in Slack. The marketer approves **Go**, exact replies and persona activation in Slack. A button in the brio website does not replace those live decisions.

**You need:** a Slack workspace where you can install apps and your Convex `.site` address.

### 5A. Create the bot

1. Open [Slack's app dashboard](https://api.slack.com/apps).
2. Click **Create an app → Blank app → Continue**. Some versions of the page call this **Create New App → From scratch**.
3. Name it `brio` and select the workspace you will use for the demo. Create the app.
4. In the left menu, open **OAuth & Permissions**.
5. Find **Scopes → Bot Token Scopes → Add an OAuth Scope**. Add **`chat:write`**.
6. Scroll to **Install to Workspace**, click it, and approve the installation.
7. Copy the **Bot User OAuth Token**; it normally starts with `xoxb-`. In Convex Production, add `SLACK_BOT_TOKEN` with this value. Also save it in the root `.env` file.
8. Open the app's **Basic Information** page. Under **App Credentials**, reveal and copy **Signing Secret**. Save it as `SLACK_SIGNING_SECRET` in Convex and the root `.env` file.

### 5B. Make its buttons work

1. Open **Interactivity & Shortcuts** in the Slack app settings.
2. Switch **Interactivity** on.
3. In **Request URL**, paste your Convex `.site` address followed by `/slack/interactions`.

For example, if your actual callback address is `https://calm-fox-123.convex.site`, the field would be:

```text
https://calm-fox-123.convex.site/slack/interactions
```

4. Click **Save Changes**. Leave Options Load URL blank. This app does not need Socket Mode, slash commands, incoming webhooks or Event Subscriptions.

### How brio receives an approval

`chat:write` lets the bot post its Build/No-build and Go/No-go buttons. When someone clicks a button, Slack sends the decision and their member ID directly to the Request URL you just configured. brio checks Slack’s signature, the person’s role and the current approval. **No channel-history/read scope is needed for this button flow. Typing “approved” or adding an emoji reaction does not approve a case.**

### 5C. Select the channel and the two people

1. In Slack, create a channel named `mend-approvals`, or use an existing dedicated channel.
2. Invite the registered bot. For this existing installation it is still named `Mend`, so use `/invite @Mend` or channel details → **Integrations → Add apps**. A new installation should use the name registered in 5A.
3. Open Slack **in a browser** and select the channel. Its address looks like `https://app.slack.com/client/T012ABC/C034DEF`.
4. Copy the part starting with `T` into Convex `SLACK_TEAM_ID`. Copy the part starting with `C` into `SLACK_CHANNEL_ID`. A private channel may have a different prefix; use its actual channel ID. Channel details also expose **Copy channel ID**.
5. Open the engineer's Slack profile. Click **… / More → Copy member ID**. Save that ID as `SLACK_ENGINEER_USER_IDS` in Convex.
6. Do the same for the marketer. Save their ID as `SLACK_MARKETER_USER_IDS`.
7. Save these settings in your root `.env` too. If a role has several people, separate their IDs with commas: `U012ABC,U034DEF`. For a two-person demo, put one person's actual ID in each role. `SLACK_ADMIN_USER_IDS` is optional.

**You are done configuring Slack when:** the bot is in your channel, the callback is saved, and all six required Slack values exist in Convex: bot token, signing secret, workspace ID, channel ID, engineer IDs and marketer IDs. The live button test comes in Step 11 after the other services are ready.

**Common mistakes:** a display name is not a member ID; a `xapp-` app token is not the `xoxb-` bot token; `.convex.cloud/slack/interactions` is the wrong callback host. If you add scopes after installing, reinstall the app.

Official reference: [Slack app creation](https://docs.slack.dev/quickstart/), [bot messages](https://docs.slack.dev/reference/methods/chat.postMessage/) and [interactive buttons](https://docs.slack.dev/interactivity/handling-user-interaction/).

<a id="step-6"></a>
## Step 6 — Set up Linear tickets

**Current installation: configured.** The key and Drizzle/Done IDs are installed in hosted Convex, and metadata reads passed. Skip key creation below; creating and updating a real issue remains part of Step 11.

**Purpose:** brio creates one ticket for a reproduced bug and updates it after release.

### 6A. Create the key

1. Open [Linear](https://linear.app) and sign in. Create a workspace if you do not have one.
2. Select or create a team for this demo, for example `Weather`. Note its name.
3. Open **Settings → Account → Security & Access** and find **Personal API keys / API**.
4. Create a key named `brio hackathon`. Give it **Read**, **Write**, and **Create issues** access for the selected team. If creation is disabled, the workspace administrator must enable personal API keys.
5. Copy the key. Add `LINEAR_API_KEY=your-key` in the existing `LINEAR_API_KEY` field in the root `.env` file. Also add `LINEAR_API_KEY` in Convex Production.

### 6B. Find the correct IDs without writing an API request

1. Save the private file, then run this from Terminal:

```sh
export PATH="/home/big-daddy/.bun/bin:$PATH"
cd /home/big-daddy/Desktop/hackathon
bun --no-env-file scripts/setup-linear.ts
```

2. The helper lists the teams your key can read and their workflow states using small, separate paginated reads. It only reads Linear; it does not create or change tickets.
3. Find the team you selected. Copy its full ID into Convex `LINEAR_TEAM_ID` and into the root `.env` file.
4. Under that team, choose the final state where a released issue should go, usually **Done** or **Released**, with type **completed**. Copy that state's full ID into `LINEAR_RELEASED_STATE_ID` in both places.

**You are done when:** Convex contains `LINEAR_API_KEY`, `LINEAR_TEAM_ID` and `LINEAR_RELEASED_STATE_ID`. The two IDs look like long UUIDs, not the short team label `WTH`. The final state is a team workflow status, not a Linear Releases pipeline. No Linear webhook or separate Linear–Slack integration is needed.

**Current setup:** the real key successfully read the sole team **Drizzle (DRI)** and its **Done** completed status. Both IDs and the key are already saved privately and installed in hosted production Convex.

**If the old helper returned HTTP 400:** it requested too many nested objects and Linear reported “Query too complex.” The current helper fixes that query; the error did not mean your key was wrong. [Linear query limits](https://linear.app/developers/rate-limiting).

**If the helper lists no team:** make sure the API key can read the team. If it reports a missing key, check that you edited `/home/big-daddy/Desktop/hackathon/.env`, not a similarly named file elsewhere.

Official reference: [Linear API-key settings](https://linear.app/docs/api-and-webhooks) and [team/state queries](https://linear.app/developers/graphql).

<a id="step-7"></a>
## Step 7 — Create the separate weather website

**Existing installation:** [mend-weather.vercel.app](https://mend-weather.vercel.app) already exists and its seeded defect has been reproduced by the GCP browser. Merged weather main `161835dba251f9739d25194ec21db0f2461df989` is deployed and verified. Skip project creation; follow the remaining checklist for final configuration and the real Build.

**You need:** the separate [weather repository](https://github.com/Aarush-Dubey/hackathon-weather). Do not add this website inside the brio Vercel project.

### 7A. Create its Vercel project

1. Open [vercel.com/new](https://vercel.com/new) again.
2. Import **`Aarush-Dubey/hackathon-weather`**. Name the project `mend-weather` if available.
3. Select **Next.js**, root `./`, and the same pinned Bun install/build commands from Step 4.
4. Do **not** import `next-hosted.env` or `convex.env`. The weather app needs no private API keys.
5. Create the project from the reviewed weather `main`; its Bun migration has merged. The seed deployment must use the exact Git identity described in Step 9.
6. Open **Settings → Environments → Production → Branch Tracking**. Turn **Auto-assign Custom Production Domains** off and save. This lets brio test a build before sending visitors to it.
7. Open **Settings → Domains** and record the project's stable weather domain. Add the hostname, without `https://` or `/`, as Convex `WEATHER_PRODUCTION_DOMAIN`.
8. Open **Settings → General**. Copy **Project ID** into Convex `VERCEL_PROJECT_ID` and the exact project name into `VERCEL_PROJECT_NAME`.

### 7B. Give brio permission to deploy weather

1. Open [Vercel account tokens](https://vercel.com/account/settings/tokens).
2. Create a token named `brio weather deployment`. Select the team/account owning the weather project and an expiry that covers the hackathon.
3. Copy the token into Convex `VERCEL_TOKEN` and your root `.env`.
4. If the project belongs to a team, open that team's **Settings → General** and copy **Team ID** into Convex `VERCEL_TEAM_ID`. Do not use the team name or your personal user ID.
5. Save `VERCEL_PROJECT_ID`, `VERCEL_PROJECT_NAME`, `VERCEL_TEAM_ID` if applicable, and `WEATHER_PRODUCTION_DOMAIN` in the root `.env` file as well.

You do not need a separate `VERCEL_RELEASE_TOKEN` for this hackathon; the implementation uses `VERCEL_TOKEN` when that optional setting is absent.

### 7C. If Vercel requires a login to view weather deployments

Open a weather deployment URL in an incognito window. If it shows Vercel's login/protection screen, the verifier needs authorized test access. In the weather project's **Settings → Deployment Protection**, create a **Protection Bypass for Automation** secret. Save its value as `VERCEL_AUTOMATION_BYPASS_SECRET` on the **Cloud Run verifier** in Step 8. Do not manually add it to the weather app's Environment Variables or to the social worker. Vercel may also supply its own system variable automatically.

**You are done with the account setup when:** the weather project exists, automatic domain assignment is off, and the project ID, name, domain and API token are saved on Convex. The deliberately buggy first deployment is a separate, explicit step in the [engineering setup guide](SETUP-ENGINEERING.md#seed-deployment).

Official reference: [Vercel project settings](https://vercel.com/docs/project-configuration/general-settings), [staged production deployments](https://vercel.com/docs/deployments/promoting-a-deployment) and [authorized automation access](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

<a id="step-8"></a>
## Step 8 — Create the two browser workers on GCP

We are using **Google Cloud Run** for both workers. You do not need a Render account.

The project and both services are configured with hosted URLs and current images. Social revision `mend-social-worker-00005-6wc` and verifier revision `mend-weather-verifier-00003-s98` pass their health checks. X is enabled at the operator’s request and its reimported account reports ready; background polling remains off. No GCP setup action is required now; [SETUP-GCP.md](SETUP-GCP.md) is the reference for future configuration and shutdown.

| Service | What it does | Setting to copy back |
| --- | --- | --- |
| `mend-weather-verifier` | Opens weather and checks the bug/fix/version. | Its HTTPS URL → `ENGINEERING_WORKER_URL` in Convex and local `.env`. |
| `mend-social-worker` | Runs the X browser session and authorized replies. | Its HTTPS URL → `SOCIAL_WORKER_URL` in Convex, brio Vercel and local `.env`. |

The GCP walkthrough includes the different CPU settings these services need. Keep the social worker's CPU allocated after requests because it completes work after acknowledging a job. Secret values stay in the named worker's Secret Manager references.

**You are done when:** setup-pending mode has been removed after adding real settings, both services pass their normal health check, the correct URLs are saved in each destination, and brio has been redeployed after its Vercel setting changes. A health body containing `ready: false` means setup is still incomplete. Actual browser/account checks come later. No GCP API key goes in brio.

<a id="step-9"></a>
## Step 9 — Finish GitHub's code-fixing setup

Most GitHub settings are already configured. **You do not need to recreate the repositories, generate another checkout key, or replace the existing signing keys.**

The Checks App `brio-mkc` (4934302), weather-only installation, private key and immutable coding sandbox image are configured and verified. Controller PR #1 is merged after passing final CI. Do not repeat those setup steps.

The fresh weather baseline is verified and pinned. Production `GITHUB_CONTROLLER_SHA` must follow the latest reviewed controller `main` commit, synchronized after each merge. Follow the [remaining checklist](SETUP-REMAINING.md) to exercise an actual signed engineer Build in Step 11. [SETUP-ENGINEERING.md](SETUP-ENGINEERING.md) retains the full provisioning and troubleshooting reference.

**Do not skip the seed identity step.** A weather page that renders correctly is not enough for brio to prove which version it tested.

**You are done when:** the engineering guide's checklist is complete, including an accessible runtime image, merged reviewed code, and a real seeded weather deployment. Creating a GitHub App alone does not verify a coding run.

<a id="step-10"></a>
## Step 10 — Connect the X brand account

**Current installation:** **@Vinaychamoc5** was reimported successfully after the operator requested enablement. The worker verified matching identity; brio reports **ready**, **paused false**, with both X switches enabled. Keep this connection. Background polling is off and no public post has been sent. Sections 10A–10B are a reference for a new connection or an expired session; the remaining check is the controlled case flow in Step 11.

**You need:** the live brio website, working social worker, and an X account you own and intend to use as the brand account. This implementation uses a browser session; it does not ask for an X API key.

X requires prior approval for AI reply bots and restricts automated replies to permitted interactions. The current switches record the operator’s enablement; external X approval has not been independently verified. The switches do not obtain platform approval. [X automation rules](https://help.x.com/en/rules-and-policies/x-automation).

### 10A. Save the account in brio

1. Open your hosted brio website and enter the shared access code.
2. Open **Connections**.
3. In the X card, enter the account's handle in **Account identifier**, for example `mend_weather_demo`, and click **Save account identifier**. Use your actual handle. This field uses the handle, not a numeric account ID.

### 10B. Enable the approved capability, then import the session

For a new connection, keep both switches false until the account owner authorizes the intended automation and applicable platform requirements are addressed. `X_PLATFORM_PERMISSION_APPROVED` is on the Cloud Run social worker and `X_AUTOMATION_PERMISSION_CONFIRMED` is on Convex. Save/redeploy the worker before importing a session after a capability change. An import with the switches off remains `access_pending`. The existing connection has already completed enablement and reimport; skip this section now.

Then import only that account's session:

1. In Chrome or Chromium, sign in normally at [x.com](https://x.com) using that dedicated account. Complete any login challenge yourself.
2. Press **F12**, or **Ctrl + Shift + I**, to open Developer Tools.
3. Choose the **Application** tab. If hidden, use the `»` tab-overflow menu.
4. In the left sidebar, expand **Storage → Cookies** and select `https://x.com`.
5. Find the cookie named `auth_token`. Select its **Value** cell and copy that value. It acts like a login password; paste it only into brio's import form.
6. Back in brio's **Import X session** form, enter the same handle under **Expected brand account ID**.
7. Change **Import method** to **Guided session cookie entry**. Paste the copied value into `auth_token`.
8. Return to the same X cookie list, copy the value of `ct0`, and paste it into brio's `ct0` field.
9. Click **Import encrypted session**. Wait for the result and inspect the account/status on the X card. Do not reset the connection after a successful import; resetting invalidates that session.

**You are done connecting the session when:** the reported account matches your handle and the connection check succeeds. An expired session or login challenge needs a new normal login and import.

### 10C. Enable only the permitted live behavior

The permission flags were set before the import in 10B. If you changed them after importing, import the session again so the connection records the approved capability.

Keep `FDE_SOCIAL_POLLING_ENABLED=false` until the first controlled test succeeds. You can start with **Manual signal intake** using the original post's URL and text. Enable Convex `FDE_SOCIAL_POLLING_ENABLED=true` only when you are ready for periodic X mentions intake.

For automatic low-risk banter, first configure the persona and obtain the marketer's Slack approval of that policy. A connected account alone does not activate autonomous replies. Real bug-fix announcements still require the engineer's Build, marketer's Go, and successful verification.

<a id="step-11"></a>
## Step 11 — Check the setup in this order

These are observable checks. Hosted admission and both worker health checks have passed. The fresh merged weather baseline passed exact identity and seeded-defect checks at both staged and stable URLs. The complaint, signed human decisions, generated candidate, release and real receipt remain to be tested. A saved API key is not proof of that complete flow.

| Order | What you do | What you should see |
| --- | --- | --- |
| 1 | Open hosted brio in a fresh incognito window. | Access-code page, then the board after the correct code. |
| 2 | Open both Cloud Run service URLs with `/health` appended. | A response from each service, not a sleeping/error page. |
| 3 | Open the weather seed and its `/api/version` endpoint. | The intentionally wrong Fahrenheit reading and the exact seed identity from the engineering guide. |
| 4 | Add one real, owned test complaint through **Manual signal intake**. Preserve its original URL and wording. | A real case appears; another board tab receives its changes without refresh. |
| 5 | Let the engineering case reach reproduction. | Actual browser evidence of the seed bug, one Linear ticket, and a Slack Build card. |
| 6 | The configured engineer clicks **Build** on that Slack card. | GitHub runs the protected workflow and creates a candidate PR with actual passing candidate checks. |
| 7 | Wait for candidate verification; the configured marketer clicks **Go** on the current Slack card. | The tested deployment is promoted; live weather behavior is checked again. |
| 8 | With the platform enabled and exact reply approved, let the reply publish. | The actual reply exists on the intended source conversation and brio stores its real receipt link. |
| 9 | Test a permitted low-risk persona interaction after marketer policy approval. | An eligible reply follows the approved voice; risky or factual claims do not use that autonomous path. |

A failed check tells you which part to fix before proceeding. Do not repeatedly click Build, Go, or Publish while a result is unknown. Inspect the case timeline and [operations guide](OPERATIONS.md) first.

The app's **Controls & audit → Project budget** records hosting commitments after initialization. Update it when you add or remove paid services. The app can only account for costs you record; it cannot see unrelated charges in your provider accounts.

### Final configuration cross-check

Use this to catch a value pasted into the wrong service:

| Destination | Must contain |
| --- | --- |
| brio Vercel | `CONTROL_SERVICE_SECRET`, `CONTROL_ACCESS_PASSWORD`, `NEXT_PUBLIC_CONVEX_URL`, `CONTROL_APP_ORIGIN`, `SOCIAL_WORKER_URL`, both local/demo flags `false`. |
| Convex Production | Current `convex-hosted.env` settings plus Slack keys/role IDs, three Linear settings, Vercel project/token/domain, both worker URLs, `CONTROL_APP_ORIGIN`, exact controller/weather revisions. |
| Cloud Run social worker | Its own `social.env`, `CONTROL_APP_ORIGIN`, `CONVEX_SITE_URL`; platform flags set deliberately. |
| Cloud Run verifier | Its own `verifier.env`, `WEATHER_ALLOWED_HOSTS`, `WEATHER_ACCEPT_SIGNED_DEPLOYMENT_HOSTS`; Vercel automation secret only if needed. |
| GitHub `engineering-controller` | Existing signing/checkout secrets plus `CONVEX_SITE_URL` and `CODING_SANDBOX_IMAGE`. |
| GitHub `engineering-pr-writer` | Existing callback/PR secrets plus Checks App ID/private key and `CONVEX_SITE_URL`. |
| Weather Vercel | Only the public seed/deployment identity values from the engineering guide. No OpenAI, Slack, social or controller keys. |

[ENVIRONMENT.md](ENVIRONMENT.md) is the complete technical variable reference. You should not need it for the normal steps above.

<a id="troubleshooting"></a>
## Troubleshooting

| What you see | What to do |
| --- | --- |
| `bun: command not found` | Run `export PATH="/home/big-daddy/.bun/bin:$PATH"` in that terminal. On a different machine, install Bun from [the official instructions](https://bun.com/docs/installation), pinned to 1.4.2. |
| `next: command not found` or dependencies missing | From the correct repository folder, run `bun install --frozen-lockfile --ignore-scripts`, then retry. Both apps have their own dependencies. |
| Local page will not open on port 3000 | Read the terminal's **Local** URL; another server may have moved it to 3002 or another port. |
| `/access` keeps rejecting the code | Use `CONTROL_ACCESS_PASSWORD` from `next-hosted.env`. It is not your GitHub password or the service secret. Check Vercel Production has the same value, then redeploy. |
| Hosted board says backend unavailable | Check Vercel's `.convex.cloud` URL, matching service secret, and deployed Convex functions. Do not use `.convex.site` for `NEXT_PUBLIC_CONVEX_URL`. |
| Slack card never appears | Check bot scope `chat:write`, bot channel membership, `SLACK_CHANNEL_ID`, and Convex logs. |
| Slack button fails or says unauthorized | Check the `.site/slack/interactions` URL, signing secret, workspace ID and the clicking person's member ID/role. Old cards can expire; use the current card. |
| Linear helper cannot find the team | Grant the key read access to the intended team. Use its UUID and a state UUID from that same team. |
| Cloud Build cannot find a Dockerfile | Upload the committed worker source archive and run the supplied build from its extracted root; see SETUP-GCP.md. |
| Weather verifier sees a Vercel login page | Complete Step 7C and put the authorized automation secret on the verifier. |
| GitHub says `Protected weather — Expected` | The required check has not been attached to that exact commit. Follow the engineering guide's baseline-check section; do not disable the protection. |
| `docker info` says permission denied | Docker is not usable by that terminal's account. Complete the official Docker setup in the engineering guide or use a machine where it works. |
| X import reports account mismatch | Both brio account fields must name the same handle as the account currently logged into X. |
| X is configured but no reply is sent | Check platform capability, connection readiness, case approval/evidence and persona policy status. A missing approval is not fixed by adding another API key. |
| A new environment value seems ignored | Redeploy Vercel/Cloud Run after changing their environment settings. Confirm you changed Production, not Preview or Development. |

## Optional — Reddit

The user chose to skip Reddit. Its connection is disabled and paused, with both approval flags false; no action is required now. The implemented connector has automated test coverage, but live provider access is unverified. Use [SETUP-REDDIT.md](SETUP-REDDIT.md) only if the user opts in later.

## After the hackathon

Pause automated intake/publication in brio. Delete paid Cloud Run services you no longer need, review Vercel/Convex billing, and revoke temporary provider tokens. Update the recorded budget when commitments actually end. Pausing a case in brio does not stop a hosting subscription.


## Populate the local presentation workspace

The current local board has 38 incidents and 167 reports, including the two earlier workflow runs. To add the same 36-case sample pack to another local demo, run:

```bash
export PATH="/home/big-daddy/.bun/bin:$PATH"
cd /home/big-daddy/Desktop/hackathon
FDE_DEMO_MODE=true bun --no-env-file scripts/seed-demo.ts
```

Open the URL printed by your Next development server (`http://127.0.0.1:3002/cases` on the current machine). The board updates without a refresh. Running the seed again adds no duplicates and preserves existing cases. It saves a private backup beside `.data/demo-state.json`; optional `FDE_DEMO_DATA_PATH` selects another local file. The sample pack creates no live posts, approvals, deployments, connector sessions, or model charges. Use **Run workflow** on the board to show the moving incident; **Pause**, **Resume**, and **Restart** retain their existing behavior.
