# Deploying Knowledge Bank to Google Cloud

This guide takes the Knowledge Bank app from this repository and deploys it to
Google Cloud. It is written against the **actual code in this repo** (not a
generic template), so it calls out the specific things you must change before it
will run in production.

> **Audience / assumptions:** you have a Google Cloud account with billing
> enabled, the `gcloud` CLI installed and logged in (`gcloud auth login`), and
> Docker Desktop running locally on Windows. Commands are shown for **PowerShell**
> (line continuation is a backtick `` ` ``). If you use bash, swap the backticks
> for `\`.

---

## 1. What we are deploying (and the 3 decisions you must make first)

The app is a pnpm monorepo with **two deployable artifacts**:

| Artifact | What it is | Image | Listens on | Health check |
|---|---|---|---|---|
| **API** (`artifacts/api-server`) | Node 24 + Express 5, bundled by esbuild into one `dist/index.mjs`. Talks to Postgres, stores uploads via a storage adapter, issues signed preview/download URLs. | `artifacts/api-server/Dockerfile` (target `runtime`) | `:8080` | `GET /api/healthz` |
| **Web** (`artifacts/web`) | Static Vite/React SPA served by nginx. `VITE_API_BASE` is **baked in at build time**. | `artifacts/web/Dockerfile` | `:80` | `GET /healthz` |

Plus two backing services they need:

- **PostgreSQL** with the `pg_trgm` extension (used for trigram search). Sessions
  are also stored in Postgres (`session` table) via `connect-pg-simple`.
- **Object storage** for uploaded files.

We will run the two app images on **Cloud Run**, Postgres on **Cloud SQL**, and
files in a **Cloud Storage (GCS) bucket**.

```
                         ┌────────────────────────┐
   browser ──────────▶   │  Cloud Run: web (nginx)│   static SPA
                         └────────────────────────┘
        │  XHR /api/...
        ▼
                         ┌────────────────────────┐      ┌──────────────────┐
                         │  Cloud Run: api (Node) │ ───▶ │ Cloud SQL (PG16) │
                         └────────────────────────┘      └──────────────────┘
                                    │
                                    ▼
                         ┌────────────────────────┐
                         │   Cloud Storage bucket  │  (uploaded files)
                         └────────────────────────┘
```

Before you touch `gcloud`, there are **three decisions baked into the code** that
you must resolve. Each is explained in detail below; here is the summary:

### Decision A — File storage (REQUIRED change)

The repo ships **only a working `local` (filesystem) storage driver**. The `s3`
and `gcs` drivers in `lib/storage/src/` are **stubs that throw
`"...is not implemented yet"`** (see `lib/storage/src/gcs-adapter.ts`).

Cloud Run's local filesystem is **ephemeral and per-instance** — anything written
is lost on restart and not shared between instances. So you cannot just use
`STORAGE_DRIVER=local` against the container disk. You have two options:

- **Option A1 (no code change, recommended to start):** Mount a GCS bucket into
  the container as a volume using Cloud Run's built-in GCS volume mount, and keep
  `STORAGE_DRIVER=local` pointed at the mount path. The filesystem driver then
  reads/writes the bucket transparently. → Covered in §6.
- **Option A2 (proper fix, recommended long-term):** Implement the `GcsStorageAdapter`
  so `STORAGE_DRIVER=gcs` works natively. The code to do this is in
  [Appendix A](#appendix-a--implementing-the-gcs-storage-adapter).

### Decision B — Same origin vs. two origins (affects login!)

The session cookie is configured with **`sameSite: "lax"`** (see
`artifacts/api-server/src/middlewares/session.ts:21`). Browsers will **not** send
a `lax` cookie on cross-site XHR. Two separate Cloud Run URLs
(`web-xxx.run.app` and `api-xxx.run.app`) count as **different sites**, so **login
would silently fail** — the browser keeps the cookie but won't attach it to API
calls.

You must pick one:

- **Option B1 (simplest):** Keep two Cloud Run services but change the cookie to
  `sameSite: "none"` in production (one-line edit, shown in §3.2), and set
  `WEB_ORIGIN` + `VITE_API_BASE` so CORS and the client point at each other.
- **Option B2 (most "production", no cookie change):** Put both services behind a
  single domain using an **External HTTPS Load Balancer** with path routing
  (`/api/*` → API, everything else → web). Same origin, so `lax` cookies just
  work and you leave `VITE_API_BASE` blank. → Covered in [Appendix B](#appendix-b--single-origin-with-a-load-balancer-option-b2).

This guide's main path uses **Option B1** because it needs no load balancer.

### Decision C — Where migrations & seed run

The schema and the demo data are applied by the **`migrate` image target** (the
same Dockerfile, different stage), which runs `prisma migrate deploy` and the seed
script. We run this as a **Cloud Run Job** once before first launch. → §7.

---

## 2. One-time project setup

Set some shell variables you'll reuse, then enable APIs and create an Artifact
Registry repo for the images.

```powershell
# --- adjust these ---
$PROJECT_ID = "your-gcp-project-id"
$REGION     = "europe-west1"      # pick one close to you
$REPO       = "knowledge-bank"    # Artifact Registry repo name

gcloud config set project $PROJECT_ID

# Enable the APIs we use
gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  sqladmin.googleapis.com `
  secretmanager.googleapis.com `
  storage.googleapis.com

# Container image repository
gcloud artifacts repositories create $REPO `
  --repository-format=docker `
  --location=$REGION `
  --description="Knowledge Bank images"

# Let local Docker push to Artifact Registry
gcloud auth configure-docker "$REGION-docker.pkg.dev"
```

---

## 3. Code changes you must make before deploying

These are committed changes — do them on a branch, verify locally, then build.

### 3.1 Implement file storage for GCP

Pick **A1** or **A2** from Decision A.

- **A1 (volume mount):** no code change here; you'll configure the mount at deploy
  time in §6. Skip to §3.2.
- **A2 (native adapter):** apply the implementation in
  [Appendix A](#appendix-a--implementing-the-gcs-storage-adapter), then you'll set
  `STORAGE_DRIVER=gcs` instead of `local`.

### 3.2 Fix the session cookie for cross-origin (Option B1 only)

If you are using two separate Cloud Run URLs (Option B1), edit
`artifacts/api-server/src/middlewares/session.ts` so the cookie is sent on
cross-site requests in production:

```ts
  cookie: {
    httpOnly: true,
    // "none" is required for the cookie to ride cross-site XHR between the
    // web origin and the API origin. "none" REQUIRES secure:true, which we
    // already set in production. Stay on "lax" in dev (http localhost, where
    // browsers reject sameSite:none without https).
    sameSite: env.isProduction ? "none" : "lax",
    secure: env.isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 14,
  },
```

> If you choose Option B2 (load balancer / single origin), **do not** make this
> change — `lax` is correct and more secure for same-origin.

> **`trust proxy` is already correct.** `app.ts` sets `app.set("trust proxy", 1)`,
> which Cloud Run requires so Express sees the original `https` scheme and the
> `secure` cookie is actually sent.

### 3.3 Nothing else is required in code

The environment loader (`artifacts/api-server/src/lib/env.ts`) already:

- enforces strong `SESSION_SECRET` / `SIGNED_URL_SECRET` (≥16 chars) when
  `NODE_ENV=production`,
- reads `PORT` (Cloud Run injects `PORT=8080` — matches our default),
- reads `WEB_ORIGIN` (comma-separated) for the CORS allowlist.

The Replit-specific bits in that file (`REPLIT_DOMAINS`, object-storage
auto-detect) are harmless on GCP — they're simply inactive when those env vars
are absent.

---

## 4. Create the database (Cloud SQL for PostgreSQL)

```powershell
$DB_INSTANCE = "kb-postgres"
$DB_NAME     = "knowledge_bank"
$DB_USER     = "knowledge_bank"
$DB_PASS     = "CHANGE-ME-strong-password"   # store this safely

# Create a small Postgres 16 instance
gcloud sql instances create $DB_INSTANCE `
  --database-version=POSTGRES_16 `
  --tier=db-f1-micro `
  --region=$REGION `
  --storage-size=10GB

# Database + application user
gcloud sql databases create $DB_NAME --instance=$DB_INSTANCE
gcloud sql users create $DB_USER --instance=$DB_INSTANCE --password=$DB_PASS

# The instance connection name — you'll need it for the DATABASE_URL and
# for attaching the instance to Cloud Run.
$INSTANCE_CONNECTION_NAME = gcloud sql instances describe $DB_INSTANCE `
  --format="value(connectionName)"
$INSTANCE_CONNECTION_NAME   # looks like: your-project:europe-west1:kb-postgres
```

You do **not** need to create the `pg_trgm` extension or the `session` table by
hand — the init migration (`lib/db/prisma/migrations/.../migration.sql`) runs
`CREATE EXTENSION IF NOT EXISTS "pg_trgm"` and creates the `session` table for
you in §7.

**Connection string.** Cloud Run connects to Cloud SQL over a Unix socket at
`/cloudsql/<INSTANCE_CONNECTION_NAME>`. Prisma/`pg` accept that via the `host`
query param:

```
postgresql://knowledge_bank:CHANGE-ME-strong-password@localhost/knowledge_bank?host=/cloudsql/your-project:europe-west1:kb-postgres
```

URL-encode the password if it contains special characters.

---

## 5. Create the storage bucket and secrets

```powershell
# A globally-unique bucket name for uploaded files
$BUCKET = "$PROJECT_ID-kb-uploads"
gcloud storage buckets create "gs://$BUCKET" --location=$REGION --uniform-bucket-level-access
```

Store the secrets in **Secret Manager** rather than passing them as plain env
vars:

```powershell
# Generate two strong random secrets (≥16 chars; these are 48-char hex)
$SESSION_SECRET    = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
$SIGNED_URL_SECRET = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })

$SESSION_SECRET    | gcloud secrets create kb-session-secret    --data-file=-
$SIGNED_URL_SECRET | gcloud secrets create kb-signed-url-secret --data-file=-

# Database URL (contains the password) as a secret too
$DATABASE_URL = "postgresql://$DB_USER`:$DB_PASS@localhost/$DB_NAME`?host=/cloudsql/$INSTANCE_CONNECTION_NAME"
$DATABASE_URL | gcloud secrets create kb-database-url --data-file=-
```

> Note the backtick-escaped `` `: `` and `` `? `` — in PowerShell `:` and `?` are
> fine in double-quoted strings, but escaping avoids any surprises. Verify the
> value with `gcloud secrets versions access latest --secret=kb-database-url`.

Grant the Cloud Run runtime service account access (the default compute SA is
used unless you make a dedicated one):

```powershell
$PROJECT_NUMBER = gcloud projects describe $PROJECT_ID --format="value(projectNumber)"
$RUNTIME_SA = "$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

# Read the secrets
foreach ($s in "kb-session-secret","kb-signed-url-secret","kb-database-url") {
  gcloud secrets add-iam-policy-binding $s `
    --member="serviceAccount:$RUNTIME_SA" `
    --role="roles/secretmanager.secretAccessor"
}

# Read/write the uploads bucket (needed for both A1 volume mount and A2 adapter)
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" `
  --member="serviceAccount:$RUNTIME_SA" `
  --role="roles/storage.objectAdmin"
```

---

## 6. Build and push the two images

Build from the **repo root** (the Dockerfiles expect the whole monorepo as build
context). Tag with the Artifact Registry path.

```powershell
$API_IMAGE = "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/api:latest"
$WEB_IMAGE = "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:latest"

# Decide the web's API origin now (Option B1). We won't know the API URL until
# it's deployed, so we deploy the API first (next section), grab its URL, THEN
# build the web image with that URL baked in. For now build only the API:
docker build -f artifacts/api-server/Dockerfile -t $API_IMAGE --target runtime .
docker push $API_IMAGE
```

> **Why the web build waits:** `VITE_API_BASE` is compiled into the static bundle
> at build time (`artifacts/web/Dockerfile:41`). With Option B1 the web needs the
> API's public URL, which Cloud Run only assigns on first deploy. So the order is:
> deploy API → get its URL → build web with that URL → deploy web. (With Option B2
> you'd instead leave `VITE_API_BASE` empty and build web anytime.)

> **Local Docker memory:** the API image bundles with esbuild and the web image
> runs a Vite production build; give Docker Desktop ≥4 GB RAM. If local builds are
> slow/flaky, use Cloud Build instead:
> `gcloud builds submit --tag $API_IMAGE -f artifacts/api-server/Dockerfile .`
> (Cloud Build honors `-f` and uses the current dir as context.)

---

## 7. Run migrations + seed (one-time Cloud Run Job)

Build the **`migrate`** target of the API Dockerfile — same Dockerfile, the stage
that ships Prisma + the seed script — and run it as a job.

```powershell
$MIGRATE_IMAGE = "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/api-migrate:latest"
docker build -f artifacts/api-server/Dockerfile -t $MIGRATE_IMAGE --target migrate .
docker push $MIGRATE_IMAGE

# Create the job. It needs the DB (Cloud SQL), the secrets, and storage:
#  - the seed script writes demo files + a ".seeded" sentinel under /data/storage,
#    so mount the bucket there too (Option A1 style) so the seed persists.
gcloud run jobs create kb-migrate `
  --image=$MIGRATE_IMAGE `
  --region=$REGION `
  --set-cloudsql-instances=$INSTANCE_CONNECTION_NAME `
  --set-secrets="DATABASE_URL=kb-database-url:latest,SESSION_SECRET=kb-session-secret:latest,SIGNED_URL_SECRET=kb-signed-url-secret:latest" `
  --set-env-vars="NODE_ENV=production,STORAGE_DRIVER=local,STORAGE_LOCAL_ROOT=/data/storage" `
  --add-volume="name=uploads,type=cloud-storage,bucket=$BUCKET" `
  --add-volume-mount="volume=uploads,mount-path=/data/storage" `
  --max-retries=1 `
  --task-timeout=600s

# Run it (this applies migrations, then seeds once)
gcloud run jobs execute kb-migrate --region=$REGION --wait
```

The job's default command is `migrate-and-seed` (see
`artifacts/api-server/docker-entrypoint.sh`): it runs `prisma migrate deploy`,
then runs the seed exactly once (guarded by the `/data/storage/.seeded`
sentinel). On later schema changes you can re-run the job — migrations are
idempotent and the seed is skipped because the sentinel exists.

> **Don't want the demo data?** Override the command to migrate only:
> add `--command="/usr/local/bin/docker-entrypoint.sh" --args="migrate"` to the
> `jobs create` call.

> **If you chose Option A2 (native GCS adapter):** swap the storage env vars on
> the job for `STORAGE_DRIVER=gcs,GCS_BUCKET=$BUCKET` and drop the
> `--add-volume*` flags (the adapter talks to GCS directly). See Appendix A for
> the exact variable names.

---

## 8. Deploy the API service

```powershell
gcloud run deploy kb-api `
  --image=$API_IMAGE `
  --region=$REGION `
  --platform=managed `
  --allow-unauthenticated `
  --port=8080 `
  --set-cloudsql-instances=$INSTANCE_CONNECTION_NAME `
  --set-secrets="DATABASE_URL=kb-database-url:latest,SESSION_SECRET=kb-session-secret:latest,SIGNED_URL_SECRET=kb-signed-url-secret:latest" `
  --set-env-vars="NODE_ENV=production,STORAGE_DRIVER=local,STORAGE_LOCAL_ROOT=/data/storage" `
  --add-volume="name=uploads,type=cloud-storage,bucket=$BUCKET" `
  --add-volume-mount="volume=uploads,mount-path=/data/storage" `
  --min-instances=0 --max-instances=2 `
  --memory=512Mi

# Capture the public URL
$API_URL = gcloud run services describe kb-api --region=$REGION --format="value(status.url)"
$API_URL   # e.g. https://kb-api-xxxxxxxx-ew.a.run.app
```

Notes specific to this app:

- **`--allow-unauthenticated`** is required: this is a public web app; auth is the
  app's own session login, not Google IAM.
- **`WEB_ORIGIN` is set in §9** once we know the web URL (re-deploy with it). Until
  then CORS will reject browser calls from the web origin — that's expected.
- **GCS volume mount needs Cloud Run gen2** (the default execution environment now
  supports it). If you get a volume error, add `--execution-environment=gen2`.
- Sessions live in Postgres, so multiple instances share login state — scaling to
  >1 instance is safe.

Smoke-test the API directly:

```powershell
curl "$API_URL/api/healthz"   # should return 200
```

---

## 9. Build & deploy the Web service, then wire the two together

Now that the API URL exists, build the web image with it baked in, deploy, then
re-deploy the API with `WEB_ORIGIN` pointing at the web URL.

```powershell
# 1) Build web with the API origin compiled in
docker build -f artifacts/web/Dockerfile `
  --build-arg VITE_API_BASE=$API_URL `
  -t $WEB_IMAGE .
docker push $WEB_IMAGE

# 2) Deploy web (nginx serves on :80; Cloud Run maps it)
gcloud run deploy kb-web `
  --image=$WEB_IMAGE `
  --region=$REGION `
  --allow-unauthenticated `
  --port=80 `
  --min-instances=0 --max-instances=2 `
  --memory=128Mi

$WEB_URL = gcloud run services describe kb-web --region=$REGION --format="value(status.url)"

# 3) Tell the API to trust the web origin for CORS (and re-deploy)
gcloud run services update kb-api --region=$REGION `
  --update-env-vars="WEB_ORIGIN=$WEB_URL"
```

Open `$WEB_URL` in a browser and log in:

```
admin@knowledgebank.demo  /  Demo1234!
```

(All seeded demo users share the password `Demo1234!`.)

---

## 10. Verify the deployment

Work through these — each maps to a piece of the app that has a GCP-specific
failure mode:

1. **Login works** → confirms the session cookie crosses origins (Decision B) and
   the `session` table exists (Decision C / migrations).
2. **Search returns results** → confirms `pg_trgm` was created on Cloud SQL.
3. **Upload a PDF, then preview/download it** → confirms storage works
   (Decision A). If upload throws *"...is not implemented yet"*, you set
   `STORAGE_DRIVER=gcs` without implementing the adapter — use A1's `local`+mount,
   or apply Appendix A.
4. **Restart the API instance, then download the file again** → confirms files
   persisted in the bucket and not on the ephemeral container disk.

Check logs if anything fails:

```powershell
gcloud run services logs read kb-api --region=$REGION --limit=100
```

---

## 11. Cost & operations notes

- **Cloud Run** scales to zero (`--min-instances=0`), so idle cost is ~$0; you pay
  per request/CPU-second. The first request after idle has a cold start.
- **Cloud SQL `db-f1-micro` is not free** — it runs ~$8–10/month even idle. For a
  student demo you can `gcloud sql instances patch $DB_INSTANCE --activation-policy=NEVER`
  to stop it when not in use, and `ALWAYS` to start it.
- **GCS** storage for a few uploads is negligible.
- **Redeploys:** rebuild the changed image, `docker push`, then
  `gcloud run deploy ... --image=...:latest`. Run the `kb-migrate` job again after
  any schema migration.
- **Custom domain:** map one with `gcloud run domain-mappings create`, then update
  `WEB_ORIGIN` (and rebuild web with the new `VITE_API_BASE` if the API domain
  changes).

---

## Appendix A — Implementing the GCS storage adapter (Option A2)

This replaces the throwing stub in `lib/storage/src/gcs-adapter.ts` with a real
implementation, so `STORAGE_DRIVER=gcs` works natively (no volume mount needed).

**1. Add the dependency** to `lib/storage/package.json`:

```json
"dependencies": {
  "@google-cloud/storage": "^7.14.0"
}
```

**2. Replace `lib/storage/src/gcs-adapter.ts`:**

```ts
import { createHash } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import type {
  ObjectHead,
  PutObjectInput,
  PutObjectResult,
  StorageAdapter,
} from "./types";

/**
 * Google Cloud Storage adapter. Auth is via Application Default Credentials —
 * on Cloud Run that is the service account, no key file needed. Configure with:
 *   STORAGE_DRIVER=gcs
 *   GCS_BUCKET=<bucket name>
 */
export class GcsStorageAdapter implements StorageAdapter {
  readonly driver = "gcs";
  private readonly storage = new Storage();
  private readonly bucketName: string;

  constructor(bucketName = process.env.GCS_BUCKET ?? "") {
    if (!bucketName) {
      throw new Error("GCS_BUCKET must be set when STORAGE_DRIVER=gcs");
    }
    this.bucketName = bucketName;
  }

  private file(key: string) {
    const clean = key.replace(/^\/+/, "");
    return this.storage.bucket(this.bucketName).file(clean);
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const file = this.file(input.key);
    await file.save(input.body, {
      contentType: input.contentType,
      resumable: false,
    });
    const checksum =
      input.precomputedChecksum ??
      createHash("sha256").update(input.body).digest("hex");
    return {
      key: input.key,
      size: input.body.length,
      checksum,
      driver: this.driver,
    };
  }

  async get(key: string): Promise<Buffer> {
    const [buf] = await this.file(key).download();
    return buf;
  }

  async getStream(key: string) {
    return this.file(key).createReadStream();
  }

  async head(key: string): Promise<ObjectHead> {
    const [meta] = await this.file(key).getMetadata();
    return {
      key,
      size: Number(meta.size ?? 0),
      contentType: meta.contentType ?? "application/octet-stream",
      driver: this.driver,
    };
  }

  async delete(key: string): Promise<void> {
    await this.file(key).delete({ ignoreNotFound: true });
  }
}
```

**3. Pass the bucket through** `lib/storage/src/index.ts` if you want it explicit
(optional — the constructor already reads `GCS_BUCKET`). The minimal change is to
let `createStorageAdapter` accept it; the simplest version just relies on the env
var, so no change is strictly required.

**4. Deploy with** `STORAGE_DRIVER=gcs` and `GCS_BUCKET=$BUCKET` instead of the
`local` + volume-mount env vars, on **both** the `kb-migrate` job and the `kb-api`
service. Drop the `--add-volume`/`--add-volume-mount` flags. The runtime service
account already has `storage.objectAdmin` on the bucket (§5).

> Run `pnpm install` and the test suite locally after this change. The repo even
> has a `regression:gcs` script (`package.json`) intended for exactly this driver.

---

## Appendix B — Single origin with a Load Balancer (Option B2)

If you prefer **not** to change the session cookie, serve web + API under one
hostname so the `lax` cookie just works.

High-level steps:

1. Deploy **both** Cloud Run services as in §8–9, **but**:
   - Build the web image with **`VITE_API_BASE` left empty** (omit the
     `--build-arg`). The client then calls **relative** `/api/...` paths
     (`artifacts/web/src/lib/api-url.ts` keeps them relative when the base is
     blank).
   - Do **not** make the §3.2 cookie change.
2. Create **Serverless NEGs** for each service and an **External HTTPS Load
   Balancer** with a URL map:
   - path `/api/*` → API service NEG
   - default `/*` → web service NEG
3. Reserve a static IP + managed SSL cert for your domain, point DNS at it.
4. Set `WEB_ORIGIN` on the API to your single domain (e.g.
   `https://kb.example.com`). Because requests are now same-origin, CORS is barely
   exercised, but it's still correct to set it.

This is more setup (NEGs, URL map, cert, DNS) but yields one clean origin, keeps
the stricter `lax` cookie, and removes the cross-origin CORS surface entirely.
Use Option B1 for a quick demo and Option B2 when you want a real domain.

---

## Quick reference — environment variables

API service / migrate job:

| Variable | Value | Source |
|---|---|---|
| `NODE_ENV` | `production` | env var (enables secret enforcement + secure cookies) |
| `PORT` | `8080` | injected by Cloud Run (matches app default) |
| `DATABASE_URL` | `postgresql://…?host=/cloudsql/<conn>` | Secret Manager |
| `SESSION_SECRET` | ≥16-char random | Secret Manager |
| `SIGNED_URL_SECRET` | ≥16-char random | Secret Manager |
| `WEB_ORIGIN` | web service URL | env var (CORS allowlist) |
| `STORAGE_DRIVER` | `local` (A1) or `gcs` (A2) | env var |
| `STORAGE_LOCAL_ROOT` | `/data/storage` (A1 only) | env var |
| `GCS_BUCKET` | bucket name (A2 only) | env var |
| `MAX_UPLOAD_MB`, `SIGNED_URL_TTL_SECONDS`, quota vars | optional overrides | env var (sensible defaults exist) |

Web image (build-time only):

| Variable | Value |
|---|---|
| `VITE_API_BASE` | API URL (B1) or empty (B2) |
| `VITE_MAX_UPLOAD_MB` | should mirror `MAX_UPLOAD_MB` (default 50) |
