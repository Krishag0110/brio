# brio setup: GCP instead of Render

This replaces the Render step in [SETUP-GUIDE.md](SETUP-GUIDE.md#step-8). The existing installation has **two Cloud Run services** built from the Dockerfiles in this repository. The brio/weather websites remain on Vercel, and the database/workflows remain on Convex.

**Current project:** `mend-hackathon-260914`, region `us-central1`. Both services are active and configured with the hosted brio, Convex and weather origins. The steps below document reproducible setup; do not create duplicate resources.

| Service | Deployed URL | Verified state |
| --- | --- | --- |
| Weather verifier | https://mend-weather-verifier-ajmx2yigqq-uc.a.run.app | Revision `mend-weather-verifier-00003-s98` is healthy. Real Chromium verified merged weather main `161835dba251f9739d25194ec21db0f2461df989` and reproduced the planted defect at both staged and stable URLs. |
| Social worker | https://mend-social-worker-ajmx2yigqq-uc.a.run.app | Revision `mend-social-worker-00005-6wc` is healthy; always-allocated CPU and minimum/maximum one instance. X reimport verified, connection ready and unpaused after operator enablement; background polling remains off. |

Initial Cloud Build `569f3b8b-c458-490d-bf73-1d9775c4bc86` succeeded for source `6981750`. The verifier still uses that build. Social-only build `e31a15fd-5a36-4c02-903c-1ce57a415aa1` deployed brio source `872c226`; [latest social worker evidence](../artifacts/brio-social-worker-deployment.json) records its health and preserved configuration. [Initial worker evidence](../artifacts/gcp-worker-deployment.json) records the earlier rollout. The [merged weather evidence](../artifacts/weather-main-baseline-deployment.json) records 34 browser observations at each of the staged and stable URLs with exact revision matching. The baseline is intentionally failing conversion tests; this verifies reproduction, not a repaired release.

The third image is the **coding sandbox**, pulled by GitHub Actions rather than run as a Cloud Run service. Its immutable image and restricted keyless pull identity are configured. See [sandbox setup and validation](SETUP-CODING-SANDBOX-GCP.md). The reviewed controller workflow has merged to main. Production Convex is pinned to controller main `8a7636e`. The merged weather baseline is deployed and verified. Production `FDE_BASE_SHA` is pinned to `161835dba251f9739d25194ec21db0f2461df989`; actual GitHub OIDC pull awaits a valid signed Build.

No additional GCP credentials are currently required from the user. The X session is ready after operator enablement; external X approval is not independently verified. Reddit is skipped, disabled and paused, with no setup action required. No budget/alert policy was created. [Google's browser-automation guide](https://docs.cloud.google.com/run/docs/browser-automation).

## 1. Create/select the Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and sign in.
2. Use the project selector in the top bar → **New Project**. Name it `brio Hackathon`, or select your existing hackathon project.
3. Copy the **Project ID**, such as `mend-hackathon-123456`, into your private setup note. The Project ID is different from the display name and numeric project number.
4. Open **Billing** and link the intended billing account to this project.
5. No GCP budget or alert policy is being created, following the user’s latest instruction. Billing is enabled for the selected project; it does not add promotional credits.

Use the small instance settings below and complete the shutdown section when the live demonstration is over. The application’s existing cost ledger is separate from Google Cloud billing. [Cloud Run billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings)

## 2. Put the reviewed worker source in Cloud Shell

**Cloud Shell** is a terminal provided by Google in your browser. It already has `gcloud`, so you do not need to install GCP tooling or fix Docker on this laptop to build these two workers.

1. First ensure the reviewed brio code, including `workers/gcp/cloudbuild.yaml`, has been committed. If it is still being finalized locally, wait to create the archive; `git archive` includes committed files only.
2. On **this laptop**, run:

```sh
cd /home/big-daddy/Desktop/hackathon
mkdir -p .data
git archive --format=zip --output=.data/mend-cloud-source.zip HEAD workers .gcloudignore
```

3. In Google Cloud Console, click **Activate Cloud Shell** (`>_`) in the top-right corner. Authorize it for the selected project if prompted.
4. In the Cloud Shell terminal toolbar, choose **… → Upload file** and upload `/home/big-daddy/Desktop/hackathon/.data/mend-cloud-source.zip`.
5. Run these commands **in Cloud Shell**:

```sh
mkdir -p mend-cloud-source
unzip -o mend-cloud-source.zip -d mend-cloud-source
cd mend-cloud-source
```

6. Select your actual project. Replace only the example Project ID in the first line:

```sh
mend_gcp_project="YOUR_ACTUAL_PROJECT_ID"
mend_gcp_region="us-central1"
gcloud config set project "$mend_gcp_project"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com logging.googleapis.com storage.googleapis.com
```

This guide uses `us-central1` consistently. If you choose a different supported region, replace it everywhere in this guide. Do not upload `.env`, `.data/deployment-secrets`, browser cookies or private keys with the source archive.

## 3. Build the two images in Google Cloud

1. Still in Cloud Shell's `mend-cloud-source` directory, create a Docker image repository:

```sh
gcloud artifacts repositories create mend-workers --repository-format=docker --location="$mend_gcp_region" --description="brio browser worker images"
```

If it says this repository already exists in the selected project/region, reuse it.

2. Create a dedicated **build service account** and a source-upload bucket. Run each command and wait for success. If a resource already exists in this project, reuse it.

```sh
gcloud iam service-accounts create mend-build --display-name="brio image builder"
mend_build_account="mend-build@$mend_gcp_project.iam.gserviceaccount.com"
mend_source_bucket="gs://$mend_gcp_project-mend-build-source"
gcloud storage buckets create "$mend_source_bucket" --location="$mend_gcp_region" --uniform-bucket-level-access
```

3. Give that build identity the three permissions it needs: upload images to this repository, read this source bucket, and write build logs.

```sh
gcloud artifacts repositories add-iam-policy-binding mend-workers --location="$mend_gcp_region" --member="serviceAccount:$mend_build_account" --role=roles/artifactregistry.writer
gcloud storage buckets add-iam-policy-binding "$mend_source_bucket" --member="serviceAccount:$mend_build_account" --role=roles/storage.objectViewer
gcloud projects add-iam-policy-binding "$mend_gcp_project" --member="serviceAccount:$mend_build_account" --role=roles/logging.logWriter
```

4. In **IAM & Admin → Service Accounts → mend-build → Permissions**, grant your signed-in Google account **Service Account User** on this service account. This permits you to submit a build using it. In an organization-managed project, the administrator may need to do this. The person submitting also needs **Cloud Build Editor** and permission to upload objects to the source bucket; **Storage Object Creator** on that bucket provides the upload permission. The creator/owner of a new personal project normally already has these operator permissions.
5. Submit the build using the exact account and bucket just created:

```sh
gcloud builds submit --config=workers/gcp/cloudbuild.yaml \
  --region="$mend_gcp_region" \
  --service-account="projects/$mend_gcp_project/serviceAccounts/$mend_build_account" \
  --gcs-source-staging-dir="$mend_source_bucket/source" \
  --substitutions="_REGION=$mend_gcp_region" .
```

6. Wait for **SUCCESS**. It builds both images without application secrets. Logs go to Cloud Logging; no default build service account or assumed Editor grant is required.
7. Open **Artifact Registry → mend-workers**. You should see **social** and **verifier** images. Open each new version and copy its full image path. Prefer the fixed digest form ending in `@sha256:...` when deploying.

If a command reports an IAM permission error, check the named operator/build roles above before retrying. Do not give the image-building identity permission to read the application's Secret Manager secrets. [Cloud Build container builds](https://docs.cloud.google.com/build/docs/building/build-containers), [custom build identities and logging](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts)

## 4. Create separate runtime identities and save secrets

A **service account** is a Google identity used by a running worker. Create one per worker so each can read only its own secrets.

1. Open **IAM & Admin → Service Accounts → Create service account**.
2. Create `mend-social-runtime`. Leave project-wide roles blank.
3. Repeat for `mend-verifier-runtime`.
4. Open **Security → Secret Manager → Create secret** for each row below. Copy the value from the specified private file on your laptop. Do not include the variable name or `=` in the secret value.
5. After creating each secret, open its **Permissions → Grant access**. Select the matching runtime service account as Principal and grant **Secret Manager Secret Accessor** on that secret.

| Secret name to create in GCP | Value from | Give access to |
| --- | --- | --- |
| `mend-social-grant` | `SOCIAL_GRANT_SECRET` in private `social.env` | `mend-social-runtime` |
| `mend-social-callback` | `SOCIAL_CALLBACK_SECRET` in private `social.env` | `mend-social-runtime` |
| `mend-social-encryption` | `SESSION_ENCRYPTION_KEY` in private `social.env` | `mend-social-runtime` |
| `mend-verifier-signing` | `ENGINEERING_VERIFY_SECRET` in private `verifier.env` | `mend-verifier-runtime` |
| `mend-vercel-bypass` | Weather Vercel automation-bypass value, only if required | `mend-verifier-runtime` |

Those files are in `/home/big-daddy/Desktop/hackathon/.data/deployment-secrets/`. Their matching signing values are already in the prepared Convex configuration. The encryption key stays with the social worker.

When a secret has just been created, its first version is usually `1`. In Cloud Run, select the actual enabled version explicitly. [Cloud Run secret configuration](https://docs.cloud.google.com/run/docs/configuring/services/secrets)

## 5. Create the weather verifier Cloud Run service

1. Open [Cloud Run](https://console.cloud.google.com/run), select **Services → Deploy container / Create service**, and choose **Deploy one revision from an existing container image**.
2. Select the **verifier** image you built in Artifact Registry.
3. Use service name `mend-weather-verifier` and the region selected above.
4. For **Authentication**, allow public invocation. The existing application verifies a signed request before doing any work; the public `/health` route only reports process status. Convex does not currently send Google IAM identity tokens.
5. Expand the container/scaling/security settings and enter:

| Setting | Value |
| --- | --- |
| Container port | `8080` — Cloud Run supplies `PORT=8080`; our verifier reads it. |
| Execution environment | Second generation |
| Memory | `2 GiB` starting allocation; verify browser memory use. |
| CPU | `1` |
| Maximum concurrent requests per instance | `1` |
| Minimum instances | `0` |
| Maximum instances | `1` |
| Billing | Request-based |
| Request timeout | `180` seconds; the application caller still has its own 125-second bound. |
| Service account | `mend-verifier-runtime` |

6. Under **Variables & Secrets**, add these plain environment variables:

| Name | Value |
| --- | --- |
| `WEATHER_ALLOWED_HOSTS` | Your exact weather hostname, without `https://` or a path. |
| `WEATHER_ACCEPT_SIGNED_DEPLOYMENT_HOSTS` | `true` |

7. Add a **secret reference**: environment-variable name `ENGINEERING_VERIFY_SECRET` → secret `mend-verifier-signing` → its enabled version.
8. If weather deployment protection requires it, add `VERCEL_AUTOMATION_BYPASS_SECRET` → `mend-vercel-bypass`. Otherwise omit it.
9. Click **Create / Deploy** and wait until ready. Copy the service's HTTPS `run.app` URL into your setup note.
10. Open that URL with `/health` appended. A JSON response confirms the process started.

Use the normal container startup check; do not add a custom `/health` liveness probe just to follow this guide. Warm the verifier by opening `/health` before the presentation so its first browser request does not also pay the startup delay.

## 6. Create the social worker Cloud Run service

Repeat section 5 with the **social** image and these changes:

| Setting | Value |
| --- | --- |
| Service name | `mend-social-worker` |
| Service account | `mend-social-runtime` |
| Billing / CPU allocation | **Instance-based / CPU always allocated** |
| Minimum instances | **1 while the live demo is running** |
| Maximum instances | `1` |
| Port / CPU / Memory / Concurrency / Timeout | `8080` / `1` / `2 GiB` / `1` / `180` seconds |
| Public invocation | Allow; the application requires its own signed grants. |

**Why the different CPU setting:** the social worker returns `202 Accepted` and then continues the browser job and lease heartbeats. Request-only CPU can suspend that work after the response. One warm instance supports the current asynchronous design; it does not guarantee an instance can never restart. Convex retains the job/lease and an uncertain send must be reconciled. [Cloud Run background execution](https://docs.cloud.google.com/run/docs/configuring/billing-settings)

Add these environment variables:

| Name | Value |
| --- | --- |
| `CONTROL_APP_ORIGIN` | Your exact hosted brio URL. |
| `CONVEX_SITE_URL` | Your actual Convex `.site` URL. |
| `SESSION_KEY_VERSION` | `v1`, matching the prepared private social bundle. |
| `X_PLATFORM_PERMISSION_APPROVED` | `false` until the X setup requirements are met. |
| `REDDIT_API_APPROVED` | `false` for the initial demo. |

Add these secret references:

| Environment-variable name | GCP secret |
| --- | --- |
| `SOCIAL_GRANT_SECRET` | `mend-social-grant` |
| `SOCIAL_CALLBACK_SECRET` | `mend-social-callback` |
| `SESSION_ENCRYPTION_KEY` | `mend-social-encryption` |

Deploy, copy its `run.app` URL, and check `/health`.

If your organization prohibits public Cloud Run invocation, the current caller needs an additional Google IAM authentication integration. Do not disable the application's signatures or assume a private service will accept the current requests.

## 7. Connect the service URLs to brio

| Setting | Value | Where to save |
| --- | --- | --- |
| `ENGINEERING_WORKER_URL` | Verifier's HTTPS `run.app` URL | Convex Production and local `.env`. |
| `SOCIAL_WORKER_URL` | Social worker's HTTPS `run.app` URL | Convex Production, brio Vercel environment variables, and local `.env`. |

Use the service origins with no `/health` or endpoint path. Redeploy the brio Vercel project after updating its environment.

**No GCP API key or downloaded service-account JSON key goes in brio's `.env`.** Your Google login provisions the services; their runtime identities access Secret Manager. brio calls the resulting URLs with its existing application signatures.

## 8. Verify, then shut down after the demo

Use the application to perform the actual checks:

1. Finish the identified weather seed deployment in [engineering setup section 4](SETUP-ENGINEERING.md#seed-deployment).
2. Follow [main setup Step 11](SETUP-GUIDE.md#step-11): open hosted brio → Board → Manual signal intake, enter the original owned test complaint URL/text, and store it. Open the created case and inspect its investigation/evidence timeline. The controller signs the weather request; you do not manually paste the signing secret into a request.
3. For the initial seed, expect identity matching the deployed seed and browser evidence of `20°C → 20°F`. The bug check must fail; it must not report the seed as fixed. A verified candidate later needs `68°F` and the remaining protected regression checks to pass.
4. The current X session for `Vinaychamoc5` was reimported after operator enablement and reports ready with verified identity. Keep that connection and leave background polling off for the controlled test. [Main setup Step 11](SETUP-GUIDE.md#step-11) must still prove background completion and a real receipt.

Cloud Run reporting Ready or `/health` returning 200 alone does not prove Chromium or X works. Record the case's actual evidence and receipt links separately from the simulated local demo.

After the presentation:

1. Pause automatic intake/publication in brio and wait for active jobs to finish or record their unresolved status.
2. In **Cloud Run**, delete `mend-social-worker` and `mend-weather-verifier` if no longer needed. The one warm social instance costs money while it remains provisioned.
3. Delete unused image versions from Artifact Registry and unneeded uploaded archives in the `PROJECT_ID-mend-build-source` bucket; those can have storage charges after the services are gone.
4. Review Billing and revoke temporary permissions/secrets when finished. Update brio's recorded infrastructure commitment once it actually ends.

The dedicated project `mend-hackathon-260914` (project number `428020372764`) is linked to the authorized billing account. Build/runtime identities, source storage, image repository, four scoped secrets and both disabled worker services are configured. Build `b06bcb6d-1bcf-4958-b04b-4f5ecb516b56` succeeded. Deployed browser execution remains unverified. No GCP budget policy was created.
