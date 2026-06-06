# Knowledge Bank — Release Notes

## Migration from Replit to Google Cloud

**Status:** Deployed and live on Google Cloud Platform.
**Reason:** The project originally ran on **Replit** (development + hosting). We **exhausted our Replit budget**, so hosting was migrated to **Google Cloud Platform (GCP)** — a sustainable, pay-per-use platform that **scales to zero** when idle.

This release contains **no functional/product changes** — it is an infrastructure migration. The application behaves the same; only where and how it runs changed.

---

### What changed (infrastructure)

| Concern | Before (Replit) | After (Google Cloud) |
|---|---|---|
| **App hosting** | Replit workflows | **Cloud Run** — two services: `web` (nginx static SPA, port 80, health `/healthz`) and `api` (Node/Express 5, port 8080, health `/api/healthz`) |
| **Database** | Replit Postgres add-on | **Cloud SQL for PostgreSQL 16** — `pg_trgm` extension for trigram search; user sessions also stored here |
| **File storage** | Replit object storage / local disk | **Cloud Storage** bucket, mounted into Cloud Run as a volume |
| **Migrations + seed** | run inside the workspace | a one-time **Cloud Run Job** (`prisma migrate deploy`, then seed once, guarded by a sentinel) |
| **Secrets** | Replit secrets pane | **Secret Manager** (`SESSION_SECRET`, `SIGNED_URL_SECRET`, `DATABASE_URL`) |
| **Images** | Replit container | Docker images in **Artifact Registry** (built from the repo Dockerfiles) |

### Architecture (deployed)

```
   browser ─▶ Cloud Run: web (nginx SPA)
        │  XHR /api/...
        ▼
            Cloud Run: api (Node/Express) ─▶ Cloud SQL (PostgreSQL 16, pg_trgm, sessions)
                        │
                        ▼
            Cloud Storage bucket (uploaded files)
```

### Required changes to run on GCP

- **File storage — GCS volume mount.** The repo's `gcs` storage driver is a stub, so the deployment uses the **volume-mount approach**: the Cloud Storage bucket is mounted at `/data/storage` and the app keeps `STORAGE_DRIVER=local` pointed at that mount. (Cloud Run's container disk is ephemeral and per-instance, so uploaded files must live in the bucket to survive restarts and be shared across instances.)
- **Cross-origin session cookie.** The `web` and `api` services run on **separate Cloud Run URLs** (different sites). The session cookie was changed to `sameSite="none"` + `secure: true` **in production only** so the browser sends it on cross-site API calls (`trust proxy` was already configured). In development it stays `sameSite="lax"` over `http://localhost`.
- **CORS + client base URL.** `WEB_ORIGIN` is set on the API as the CORS allowlist; `VITE_API_BASE` (the API's public URL) is **baked into the web image at build time**.
- **Database connection.** Cloud Run connects to Cloud SQL over a Unix socket: `DATABASE_URL=postgresql://…?host=/cloudsql/<instance-connection-name>`.

### Operational notes

- **Cost:** Cloud Run scales to zero (≈$0 when idle; a cold start on the first request after idle). Cloud SQL `db-f1-micro` runs ≈**$8–10/month** and can be stopped (`activation-policy=NEVER`) when not in use. GCS storage for a handful of uploads is negligible.
- **Redeploys:** rebuild the changed image → `docker push` → `gcloud run deploy … --image=…:latest`; re-run the `kb-migrate` job after any schema migration.
- **Sessions** live in Postgres, so scaling beyond one instance keeps login state consistent.

### Known follow-ups

- Implement the **native GCS storage adapter** so `STORAGE_DRIVER=gcs` works directly (drop the volume mount).
- Optionally front both services with a **single-origin External HTTPS Load Balancer** + custom domain, which restores the stricter `sameSite="lax"` cookie and removes the cross-origin CORS surface.

### Reference

Full, reproducible step-by-step deployment instructions (project setup, Cloud SQL, bucket, secrets, image builds, migrate job, service deploys, verification) are in **`docs/deploy-google-cloud.md`**.

### Demo access

- Web URL: `https://__________.run.app` *(fill in your Cloud Run `web` URL)*
- Demo accounts: `admin@knowledgebank.demo` · `maya.cohen@knowledgebank.demo` · `amir.student@knowledgebank.demo` — password `Demo1234!`
