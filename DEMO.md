# Knowledge Bank — Demo Walkthrough

All demo accounts use the password **`Demo1234!`**.

## Demo accounts

| Role | Email | Best for demonstrating |
|------|-------|----------------------|
| Admin | `admin@knowledgebank.demo` | Global analytics, user management, full visibility |
| Lecturer | `maya.cohen@knowledgebank.demo` | CS101/CS220 courses, review queue, upload |
| Lecturer | `daniel.levi@knowledgebank.demo` | IS310/IS420 courses, review queue |
| Student | `noa.student@knowledgebank.demo` | Browse, upload, pending/rejected submissions, favorites |
| Student | `amir.student@knowledgebank.demo` | Approved submission, rejected submission, requests |
| Student | `yael.student@knowledgebank.demo` | IS310/IS420 only, near-quota upload experience |
| Restricted | `restricted.student@knowledgebank.demo` | CS101-only access, restricted-visibility docs |
| Pending lecturer | `pending.lecturer@knowledgebank.demo` | Account awaiting admin approval |
| Disabled | `disabled.user@knowledgebank.demo` | Login rejected (disabled account) |

---

## Student demo (log in as Noa)

**Goal:** show the student-upload review workflow, search/discovery, comments, requests, and notifications.

1. **Log in** as `noa.student@knowledgebank.demo / Demo1234!`

2. **Home page**
   - Notice the quick-actions row (Browse, Upload, Requests).
   - If any submissions are pending or rejected, an alert strip appears.

3. **Browse / search**
   - Go to **Browse**.
   - Type `recursion` in the search bar — see ranked results with keyword snippets highlighted in yellow.
   - Type just `recurs` (a partial word) — it still matches (prefix search). Try a small typo like `algoritm` — fuzzy fallback still finds "Algorithm Complexity Cheat Sheet".
   - Use the **Sort** dropdown — try **Trending**, **Most Viewed**, **Most Favorited**. Cards show view/download/favorite counts.
   - Click a facet chip (e.g., CS220) to narrow results; click again to remove.
   - Switch to **table view** → select rows → **Add tag** / **Set category** (bulk actions); click the **Title** / **Uploaded** column headers to sort.
   - Try the autocomplete — type `alg` and pick from the tag suggestions.

4. **Open a document**
   - Open **"Data Structures — Arrays and Lists"** (CS220).
   - Preview the PDF inline.
   - Click the **♥ Favorite** button — the button confirms (this also follows the doc for new-comment notifications).
   - Click **Add to collection** → pick "CS101 Final Prep" or create a new one inline.
   - Add a comment; mention `@Dr. Maya Cohen` to see mention autocomplete.
   - React to an existing comment with an emoji.

5. **Upload a document for review**
   - Click **Upload** in the nav.
   - Choose course CS101 (the only courses shown are ones Noa is enrolled in).
   - Drag a PDF or text file onto the upload area.
   - The metadata suggestion chips may pre-fill title/tags — click **Apply** to accept.
   - Leave **"Submit for review immediately after upload"** checked (default ON).
   - Submit. The document is created with `status: pending_review`.

6. **Check submission status**
   - Return to **Home** — the "My submissions" row shows 1 pending.
   - Click it to go to Browse filtered to your pending documents.
   - Open the document detail — a status banner shows "Pending review".

7. **View a rejected submission**
   - In Browse, filter by `status: Rejected` and uploader = you.
   - Open **"Amir's CS101 Lab Report — Rejected"** (log in as Amir to see the rejection reason banner).

8. **Prep Hub** (study collections + progress)
   - Click **Prep Hub** in the nav.
   - The **Recommended for you**, **Continue studying**, **Saved**, and **Recently viewed** lanes are pre-populated.
   - Open the **"CS101 Final Prep"** collection — see its ordered documents. Reorder with the up/down arrows, set a document's progress to **Reviewing** / **Completed**, or remove one.
   - Documents marked "Reviewing" show up under **Continue studying** (here and on the Home dashboard).

9. **Request board**
   - Go to **Requests**.
   - Upvote an open request.
   - Create a new request with a title and optional course.

10. **Notifications**
   - After commenting or favoriting, click the bell in the top nav.
   - See unread notifications; click one to navigate to the source.
   - Use "Mark all read".

---

## Lecturer demo (log in as Dr. Maya Cohen)

**Goal:** show the review queue, course analytics, responding to requests, and notifications.

1. **Log in** as `maya.cohen@knowledgebank.demo / Demo1234!`

2. **Home page**
   - Notice the review queue summary card — shows the count of pending submissions.

3. **Review queue**
   - Click **Review** in the nav or the summary card on home.
   - See student submissions waiting for approval.
   - Click a document title to open the full preview before deciding.
   - Click **Approve** on one document — it becomes publicly visible.
   - Click **Reject** on another, enter a reason (1–500 characters), confirm.
     The student (e.g., Noa) receives a `document.rejected` notification.

4. **Course analytics** (if available)
   - Navigate to `/course-analytics` or via the sidebar.
   - See upload counts, view counts, and top contributors for CS101/CS220.

5. **Browse as a reviewer**
   - In Browse, set **Status = Pending review** — Maya can see student drafts in her courses.
   - A stranger (student not enrolled) sees nothing with that filter.

6. **Requests**
   - Go to **Requests → Open**.
   - Change a request status to "In Progress" using the status dropdown.

7. **Upload as a lecturer**
   - Click **Upload** — all courses are shown (no enrollment gate).
   - Upload a file; it is published immediately without a review step.

---

## Admin demo (log in as Admin)

**Goal:** show global analytics, user management, and full visibility.

1. **Log in** as `admin@knowledgebank.demo / Demo1234!`

2. **Dashboard intelligence (Home)**
   - The admin home shows a **Platform Insights** panel (engagement this week vs last, pending-review backlog, duplicate warnings, top categories, active uploaders), plus **Trending** and **Recent activity** widgets.

3. **Analytics**
   - Open the **More ▾** menu in the nav → **Analytics** (the desktop nav uses a "More" overflow menu; Prep Hub is intentionally not shown to admins).
   - The page is tabbed: **Overview** (corpus/course stats, top docs, upload trend chart, top categories, duplicates) and **Activity logs** (the full audit feed with Everyone / Just-me + entity filters — activity lives here for admins rather than a separate nav item).

4. **User management**
   - Navigate to **Admin → Users** (via the **More ▾** menu).
   - Find `pending.lecturer@knowledgebank.demo` — click **Approve** to activate the account.
   - Find `disabled.user@knowledgebank.demo` — status shows DISABLED.

5. **Full visibility**
   - In Browse, set **Status = Draft** or **Pending review** — admin sees all statuses across all courses.
   - Open a rejected document — the rejection reason is visible.

6. **Review queue**
   - The admin's queue shows pending submissions from every course, not just taught ones.

7. **Reset demo data**
   - If the demo state has drifted, re-run the seed (idempotent):
     ```
     pnpm --filter @workspace/api-server run seed:demo
     ```
   - This restores all documented statuses, users, courses, and requests.

---

## Key scenarios to highlight during a demo

| Scenario | How to show it |
|----------|----------------|
| Student-upload review gate | Log in as Noa, upload to CS101, show `pending_review` status |
| Review-hidden visibility | Student sees their own draft; stranger sees nothing |
| Approval flow | Log in as Maya, approve → doc becomes public |
| Rejection with reason | Log in as Maya, reject → log in as Amir, see rejection reason banner |
| Full-text search + snippets | Browse → search `recursion` → yellow keyword highlights |
| Partial + fuzzy search | Browse → `recurs` (prefix) and `algoritm` (typo) still match |
| Ranking & sorts | Browse → Sort → Trending / Most Viewed; cards show engagement counts |
| Faceted search | Browse → click a course/type chip to filter |
| Bulk table actions | Browse → table view → select rows → Add tag / Set category |
| Autocomplete | Browse search bar → type 2+ chars → grouped suggestions |
| Upload intelligence | Upload a file named e.g. `cs101-final-exam-fall-2024.pdf` → type/semester/year pre-fill |
| Versioning & history | Document detail → Versions panel → upload a new version; `/uploads` → revision timeline |
| Prep Hub collections | Prep Hub → open "CS101 Final Prep" → reorder, set progress, add/remove |
| Recommendations | Prep Hub → "Recommended for you" lane (ranked, course-relevant, excludes seen) |
| Dashboard intelligence | Admin Home → Platform Insights + Trending; everyone → Continue studying |
| Activity logs | Admin → More ▾ → Analytics → Activity logs tab |
| Notifications | Comment/react/upload → bell shows unread badge |
| Favorites / following | Follow a doc → `document.activity` notifications land in bell |
| Request board lifecycle | Open → In Progress → Fulfilled (with doc link) → Closed |
| Storage quota | Log in as Yael (near quota) → upload warning appears |
| Duplicate detection | Upload the same file twice → server returns existing doc |
| Restricted visibility | Log in as Restricted Student → only CS101 docs visible |
| Analytics | Log in as Admin → `/admin/analytics` → corpus stats and charts |
