# Knowledge Bank — Presentation Context Pack (for ChatGPT)

**What this file is:** a complete, self-contained briefing about the **Knowledge Bank** module — its features, workflows, architecture, and Google Cloud deployment — so you can hand it to ChatGPT and have it generate our Engineering-Week showcase slides. A copy-paste prompt is at the very bottom (**§13**).

> Audience for the deck: an Engineering Project Management course, final product showcase during Engineering Week. Length: **5–10 minutes + a live demo**. Tone: professional, concise, technical-but-clear.

---

## 1. Required presentation structure

The deck must follow this exact structure:

1. **Title slide** — project name, course, Engineering Week, institution (SCE).
2. **Slide 1 — Team members.**
3. **Slide 2 — Knowledge Bank module overview.**
4. **Slide 3 — Paths / flows & architecture, including a Use Case block.**
5. **Demo section** — live product demonstration (a slide that frames the demo + a short script).
6. **Slide 4 — Conclusions and suggestions for improvement.**

Keep ~3–6 short bullets per slide; put detail in speaker notes.

---

## 2. Quick facts

| | |
|---|---|
| **Project** | Knowledge Bank — a standalone academic-materials platform for universities |
| **Course / event** | Engineering Project Management · Final Product Showcase · Engineering Week |
| **Institution** | Sami Shamoon College of Engineering (SCE) |
| **Hosting** | **Deployed live on Google Cloud** (migrated off Replit after the Replit **budget** was exhausted) |
| **Codebase** | pnpm monorepo — React (Vite) web client, Express 5 API, PostgreSQL via Prisma |
| **Demo accounts** | `admin@knowledgebank.demo`, `maya.cohen@knowledgebank.demo` (lecturer), `amir.student@knowledgebank.demo` (student) — password `Demo1234!` |
| **Title-slide placeholders** | Instructor: _____ · Date: _____ · Live URL: `https://__________.run.app` |

---

## 3. Team members (Slide 1)

- Ilan Merkovich
- Jordan Daudu
- Binyamin Butolin
- Elay Levi
- Rotem Dino
- Avigail Musai
- Shira Borochov

*(Roles weren't specified — list names cleanly. If roles are wanted, generic labels like full-stack, frontend, backend, cloud/DevOps, QA, design, docs can be assigned by the team.)*

---

## 4. Module overview (Slide 2)

**One-liner:** A standalone platform where **students, lecturers, and admins upload, search, review, discuss, request, and track course materials.**

**Key capabilities (feature groups):**

- **Role-based access** — `student` / `lecturer` / `admin`, plus independent **course-level membership**.
- **Upload, storage & versioning** — multipart upload, magic-byte/MIME validation, size + quota caps, per-file **version history** (restorable), short-lived **signed URLs** for preview/download.
- **Smart upload intelligence** — extracts metadata from the file (PDF/text/image) and the filename (material type / semester / year), suggests **tags & categories** as apply-on-click chips, and **detects duplicates** before re-uploading.
- **Review & approval workflow** — student submissions are **gated** (`draft → pending_review → approved/rejected`) before they become public.
- **Intelligent search (v2)** — prefix/partial matching, **fuzzy (trigram) fallback** for typos, **facets**, ranked **snippets**, and a **live autocomplete** dropdown.
- **Ranking & discovery** — weighted score (engagement + recency + metadata quality), multiple sort modes, **Prep Hub** study collections, and **recommendations**.
- **Collaboration** — nested **comments** with @mentions, replies & reactions; **favorites**; a **request board**; and **in-app notifications**.
- **Analytics & audit** — admin/lecturer analytics dashboards and a full **audit log** of every meaningful action.

**Tech stack (one line):** React 19 + Vite · Express 5 · PostgreSQL 16 (Prisma) · pnpm monorepo · OpenAPI-generated typed client · deployed on Google Cloud.

---

## 5. Roles & permissions

| Role | Upload | Review / approve | Sees review-hidden docs |
|---|---|---|---|
| **student** | only to courses they're enrolled in; every upload is forced to `draft` and routed to review | — | only their own draft/pending/rejected |
| **lecturer** | to any course they teach (no review gate for their own uploads) | the **Review queue** for courses they teach | their own + their reviewable courses |
| **admin** | *moderation-only in the UI* — Upload/My Uploads hidden, `/upload` blocked (admins moderate, not contribute) | **everything pending**, from a combined **Admin Approvals** page | everything |

Hidden statuses (`draft` / `pending_review` / `rejected`) are filtered out of lists, search, facets, and autocomplete for anyone who isn't the uploader/owner, a course lecturer, or an admin — enforced in **every** read path.

**Admin = moderator, not contributor:** the web client hides Upload, My Uploads, Collections, and Prep Hub for admins and blocks those routes; it keeps the moderation surfaces (Review — folded into Admin Approvals — plus Prep Hub Moderation, Analytics, Orphaned Files, user admin).

---

## 6. Core workflows / flows

### 6.1 Upload → Review → Approve → Discover (the headline flow)
1. A student uploads a file to an **enrolled course**. The server re-checks enrollment; the upload is forced to `status="draft"` and (by default) auto-submitted for review (`pending_review`).
2. During upload, the system **extracts smart metadata** (type/semester/year, keywords), suggests tags/categories, and **flags duplicates**.
3. A **lecturer** (for their courses) or an **admin** (for everything) gets a notification and **approves or rejects** (reject requires a 1–500 char reason). State machine: `draft|rejected → pending_review → approved|rejected`.
4. On approval the document **publishes**: it becomes **searchable** (full-text + fuzzy), **ranked**, and **discoverable** in Browse, Prep Hub, and recommendations. The uploader is notified of the outcome.

### 6.2 Search & discovery
- A **live, debounced autocomplete** dropdown on the home search box matches **documents / courses / tags / people**; picking a hit navigates smartly (document → detail; course/tag/person → filtered Browse), while Enter runs a full text search.
- Search is **prefix-aware** (`lect` matches `lecture`) with a **trigram fuzzy fallback** so typos still match (`plankron → plankton`). The haystack spans title, description, course code/title/lecturer, tags, filename, category, uploader name, and extracted file text + metadata.
- **Browse** offers facets (course / type / semester / status / uploader) and sort modes: Most Relevant, Most Recent, Trending, Most Viewed/Downloaded/Favorited, Oldest, A–Z. Ranking blends **engagement** (views/downloads/favorites, log-dampened) + **recency** (half-life decay) + a **metadata-completeness** quality signal, read from denormalised counter columns (no per-request aggregation).

### 6.3 Smart metadata / upload intelligence
- A real extractor chain (PDF/text/image) + a pure filename parser derive material type, semester, and academic year, and match keywords against existing tags/categories (exact + substring). Suggestions appear as clickable chips with a confidence indicator. Extraction failures never block upload.

### 6.4 Notifications
- Polling-only bus; producers: comment mention/reply/reaction, document activity, document approved/rejected, request status. Deduplicated on `(recipient, type, subject_type, subject_id)`. The header bell polls unread-count every 30s.

### 6.5 Request board
- Students post material requests; anyone can **upvote**. Authors can fulfil their own request by linking a document. Status (`open / in_progress / fulfilled / closed`) is editable by author, course lecturer, or admin, and transitions notify the author.

### 6.6 Prep Hub (study)
- User-owned, ordered **study collections** of existing documents (collection / exam-prep / revision / semester), with per-item notes and **study progress** (Reviewing / Completed). Quick Access lanes: Recommended, Continue studying, Saved, Recently viewed. **Recommendations** surface top-ranked docs in the user's interest courses.

### 6.7 Admin moderation
- Admins moderate from a single **`/admin/approvals`** page that combines the restricted-type **admin sign-off** queue with the student-submission **review queue** appended below it — so admins handle both in one place (no separate Review nav entry).

---

## 7. Architecture

### 7.1 Tech stack / components
- **Monorepo:** pnpm workspaces (`artifacts/*`, `lib/*`, `scripts/`).
- **API server** (`artifacts/api-server`): Node + **Express 5** + TypeScript, bundled by esbuild to a single `dist/index.mjs`; health check `GET /api/healthz`.
- **Web client** (`artifacts/web`): **React 19 + Vite**, Wouter (routing), TanStack Query (data), Tailwind + shadcn/ui; built to a static SPA served by **nginx** in production (`VITE_API_BASE` is baked in at build time).
- **Database:** **PostgreSQL** via **Prisma**; uses the `pg_trgm` extension for trigram search; **sessions stored in Postgres** (`connect-pg-simple`).
- **API contract:** OpenAPI 3 spec + **Orval codegen** → a typed `@workspace/api-client-react` (React Query hooks + schemas), so the client and server never drift.
- **Storage:** pluggable driver — `local` filesystem (dev) or a **Google Cloud Storage** bucket in production. Uploads are served through short-lived **signed URLs**.
- **Tests:** Vitest (unit + DB integration) for the API; Playwright end-to-end smoke; a `pnpm regression` CI gate.

### 7.2 Deployed architecture (Google Cloud) — ASCII diagram

```
                         ┌─────────────────────────┐
   browser  ───────────▶ │ Cloud Run: web (nginx)  │   static React SPA
                         └─────────────────────────┘
        │  XHR  /api/...
        ▼
                         ┌─────────────────────────┐      ┌────────────────────┐
                         │ Cloud Run: api (Node)   │ ───▶ │ Cloud SQL (PG 16)  │
                         │ Express 5 · :8080       │      │  + pg_trgm · sessions│
                         └─────────────────────────┘      └────────────────────┘
                                    │
                                    ▼
                         ┌─────────────────────────┐
                         │  Cloud Storage bucket   │  (uploaded files)
                         └─────────────────────────┘

   Secrets in Secret Manager  ·  one-time migrate+seed via a Cloud Run Job
```

**Core flow (one line for the slide):** `Upload → Review → Approve → Discover`.

---

## 8. Google Cloud deployment context (the migration story)

**Why we migrated:** the project originally ran on **Replit** (development + hosting). We **exhausted our Replit budget**, so we moved hosting to **Google Cloud Platform** for sustainable, pay-per-use operation that **scales to zero** when idle.

**What the platform looks like on GCP:**

| Concern | On Replit (before) | On Google Cloud (now) |
|---|---|---|
| App hosting | Replit workflows | **Cloud Run** — two services: `web` (nginx SPA, port 80) and `api` (Node/Express, port 8080) |
| Database | Replit Postgres add-on | **Cloud SQL for PostgreSQL 16** (with `pg_trgm`; sessions also live here) |
| File storage | Replit object storage / local disk | **Cloud Storage** bucket, mounted into Cloud Run as a volume |
| Migrations + seed | run in the workspace | a one-time **Cloud Run Job** (`prisma migrate deploy` + seed) |
| Secrets | Replit secrets pane | **Secret Manager** (`SESSION_SECRET`, `SIGNED_URL_SECRET`, `DATABASE_URL`) |

**Key changes required to run on GCP:**
- **Storage:** the bundled `gcs` driver is a stub, so the deployment uses the **GCS volume-mount** approach — the bucket is mounted at `/data/storage` and the app keeps `STORAGE_DRIVER=local` pointed at the mount. (Cloud Run's own disk is ephemeral, so files must live in the bucket.)
- **Auth across two origins:** the web and api run on **different Cloud Run URLs (different sites)**, so the session cookie was switched to `sameSite="none"` + `secure` in production (with `trust proxy` already set); `WEB_ORIGIN` configures the API's CORS allowlist, and `VITE_API_BASE` (the API URL) is **baked into the web image at build time**.
- **DB connection:** Cloud Run reaches Cloud SQL over a Unix socket (`?host=/cloudsql/<instance-connection-name>`).

**Cost / ops notes:** Cloud Run scales to zero (≈$0 idle, cold start on first hit); Cloud SQL `db-f1-micro` runs ≈$8–10/month and can be stopped when not in use; GCS for a few uploads is negligible.

*(Full, reproducible deploy steps live in the repo at `docs/deploy-google-cloud.md`.)*

---

## 9. Featured Use Case (put on Slide 3)

**Use Case — "Submit & publish course material"** · *actor: Student*

1. A student uploads an exam PDF to an enrolled course → the system extracts **smart metadata** (type / semester / year), checks for **duplicates**, and routes it to review (status: *pending*).
2. The **lecturer** is notified and **approves** it from the Review queue (admins act from the combined **Admin Approvals** page).
3. The document **publishes** → it becomes **searchable** (fuzzy + facets), **ranked** by engagement/recency, and **discoverable** in Prep Hub & recommendations; the uploader is **notified** of approval.

---

## 10. Live demo script (Demo section)

Runs against the **live Google Cloud deployment**. Suggested 4–6 minute path:

1. **Log in** — show the **role-based home** (admin vs lecturer vs student).
2. **Search** — type in the home box to show the **live autocomplete** dropdown; demonstrate **fuzzy matching** (a small typo still finds results); open **Browse** to show **facets + ranking/sorts**.
3. **Upload** — drop a file; show the **smart metadata suggestion chips** and duplicate detection; submit for review.
4. **Review & approve** — as a lecturer/admin, **approve** the submission from the queue; show the uploader's **notification**.
5. **Discover** — the approved document now appears in **search**, **Prep Hub**, and **recommendations**; show **comments / favorites**.

Accounts: `admin@knowledgebank.demo` · `maya.cohen@knowledgebank.demo` · `amir.student@knowledgebank.demo` — all password `Demo1234!`.

---

## 11. Conclusions & suggestions for improvement (Slide 4)

**Conclusions**
- Delivered an **end-to-end, role-based academic knowledge platform** — intelligent search, a review/approval workflow, and discovery.
- Engineered cleanly: **pnpm monorepo**, a **typed OpenAPI contract + codegen**, **unit + Playwright e2e tests**, and a regression gate.
- **Migrated hosting from Replit to Google Cloud** (Cloud Run + Cloud SQL + GCS) for sustainable, scale-to-zero operation.

**Suggestions for improvement / future work**
- **Real-time** notifications (WebSockets) + email digests — currently polling-only.
- **Native GCS storage adapter** (replace the volume-mount) and **OCR** for scanned PDFs.
- **Semantic / vector search** — currently full-text + trigram only.
- **Multi-reviewer approval quorum**; scheduled analytics exports.
- **Single-origin load balancer** + custom domain (restores the stricter `lax` cookie and one clean origin).

---

## 12. Design / tone guidance (for the slide generator)

- Professional and clean; **minimal text per slide** (3–6 bullets), detail goes to speaker notes.
- Consistent palette (a single primary color + one accent); generous whitespace.
- Slide 3 should include a **simple architecture diagram** (use the ASCII one in §7.2 as the basis) and the **Use Case block** from §9 verbatim.
- Provide **speaker notes (2–4 sentences) per slide**.
- Total deck ≈ 6 slides for a 5–10 minute talk + demo.

---

## 13. Copy-paste prompt for ChatGPT

> You are an expert presentation designer and technical writer. Using **only** the context in the document I'm pasting (the "Knowledge Bank — Presentation Context Pack"), create a concise, professional slide deck for our Engineering-Week final product showcase. Constraints:
>
> - Length: a **5–10 minute talk + a live demo**. Target ~6 slides.
> - Follow this **exact** structure: (Title slide) → **Slide 1 Team** → **Slide 2 Module overview** → **Slide 3 Flows, Architecture & a Use Case** → **Demo section** → **Slide 4 Conclusions & suggestions for improvement**.
> - For **each slide** output: a short **title**, **3–6 concise bullet points**, and **speaker notes (2–4 sentences)**.
> - On **Slide 3**, include a simple text/ASCII **architecture diagram** (base it on the one in §7.2) and the **Use Case block** from §9 **verbatim**.
> - Include the **Replit → Google Cloud migration** context (budget-driven) where relevant (overview and/or conclusions).
> - Keep it **technical but clear**, minimal text per slide, no marketing fluff. Use the team names exactly as listed.
> - At the end, give a **1-paragraph spoken intro** and a **1-paragraph spoken close** I can read aloud.
> - Output the deck as clean Markdown with one `## Slide N — Title` heading per slide. If you can, also provide a version formatted for easy paste into PowerPoint/Google Slides.
>
> Here is the context pack:
>
> [PASTE THE ENTIRE "Knowledge Bank — Presentation Context Pack" FILE HERE]
