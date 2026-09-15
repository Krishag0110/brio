# Engineering sandbox on Google Cloud

The engineering runtime is built and stored privately in Artifact Registry. This replaces the local Docker/GHCR instructions in section 3 of [SETUP-ENGINEERING.md](SETUP-ENGINEERING.md). It does not deploy either website or approve a generated fix.

Cloud Build [`236bfb42-2cdf-4a16-97b3-31bad5f84d2d`](https://console.cloud.google.com/cloud-build/builds;region=us-central1/236bfb42-2cdf-4a16-97b3-31bad5f84d2d?project=428020372764) succeeded. The uploaded source contained only the engineering Dockerfile, runtime package manifest and lockfile, and build configuration. No application secrets or candidate source were uploaded.

The immutable image is:

```text
us-central1-docker.pkg.dev/mend-hackathon-260914/mend-workers/engineering@sha256:91a62c50361609ac5f1f2ffbf6d2e2e93568301b9df7954d75784c261eec52e4
```

Cloud Build verified Bun `1.4.2` and Chromium `153.0.8010.12` using UID `65532`, no network, a read-only root filesystem, no Linux capabilities, and no Docker socket. Chromium successfully rendered and inspected an in-memory page. This proves the runtime starts under those restrictions; it does not prove a complete signed candidate build.

## GitHub access

These variables are saved and read back in the controller repository's `engineering-controller` environment:

| Variable | Value |
| --- | --- |
| `CODING_SANDBOX_IMAGE` | The immutable image above |
| `CODING_SANDBOX_WIF_PROVIDER` | `projects/428020372764/locations/global/workloadIdentityPools/mend-github/providers/engineering-controller` |
| `CODING_SANDBOX_READER_SERVICE_ACCOUNT` | `mend-sandbox-reader@mend-hackathon-260914.iam.gserviceaccount.com` |

The reader identity has `roles/artifactregistry.reader` on the `mend-workers` repository. Its Workload Identity Federation provider requires all of the following GitHub claims:

- Repository owner ID `185852550` and repository ID `1368688745`.
- Branch `refs/heads/main`.
- Workflow `Aarush-Dubey/hackathon/.github/workflows/restricted-coding.yml@refs/heads/main`.
- Subject `repo:Aarush-Dubey/hackathon:environment:engineering-controller`.

The workflow verifies the signed request before requesting a Google token. The pinned Google authentication action creates a 600-second access token without generating a credentials file or exporting Google authentication environment variables. Docker receives that token through standard input and a temporary configuration directory outside the checkout. The directory is removed when the pull step exits, including on failure. Generated candidate execution retains the existing no-network container boundary and receives no registry credential or host Docker socket.

No service-account key was created, and the registry remains private. [Google's WIF setup guide](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) and [Artifact Registry authentication guide](https://docs.cloud.google.com/artifact-registry/docs/docker/authentication) explain these mechanisms.

## Finish verification

The workflow changes first merged into the controller's `main` branch at `8a7636e2709d039773afa73857e6cb66f08a7d6f`. Production `GITHUB_CONTROLLER_SHA` must track the latest reviewed controller `main` commit, synchronized after each merge; the historical first merge is not a permanent pin. The reviewed weather Bun bootstrap also passed and its PR merged normally; [baseline deployment evidence](../artifacts/weather-main-baseline-deployment.json) records the resulting weather main and production identity. A current, signed engineering Build must still confirm GitHub's actual OIDC token exchange, authenticated image pull, and complete candidate checks. Branch protection remains enabled.

Local validation passed `actionlint` 1.7.12, workflow shell syntax checks, immutable-image validation, and simulated pull success/failure checks that verified temporary credential cleanup. The deployment record is [gcp-coding-sandbox-deployment.json](../artifacts/gcp-coding-sandbox-deployment.json).

## Rebuild after a reviewed runtime change

Use [workers/gcp/cloudbuild-engineering.yaml](../workers/gcp/cloudbuild-engineering.yaml), the existing `mend-build@mend-hackathon-260914.iam.gserviceaccount.com` build identity, and the existing source bucket. The root `.gcloudignore` restricts uploads to worker files and excludes environment bundles and private data.

```sh
gcloud builds submit . \
  --project=mend-hackathon-260914 \
  --region=us-central1 \
  --config=workers/gcp/cloudbuild-engineering.yaml \
  --service-account=projects/mend-hackathon-260914/serviceAccounts/mend-build@mend-hackathon-260914.iam.gserviceaccount.com \
  --gcs-source-staging-dir=gs://mend-hackathon-260914-mend-build-source/coding-sandbox
```

Require build and smoke-check success, retrieve the new image digest from the build result, then deliberately update `CODING_SANDBOX_IMAGE`. A mutable tag is rejected by the workflow and verifier.
