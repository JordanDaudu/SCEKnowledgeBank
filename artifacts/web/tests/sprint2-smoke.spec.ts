import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * Sprint 2 regression smoke (M0).
 *
 * Locks down the critical user journey every later Sprint-3 module
 * must keep working:
 *   1. Lecturer logs in, uploads a PDF, opens the document detail,
 *      sees the preview iframe render, and posts a comment.
 *   2. Student logs in and upvotes an open request-board item.
 *   3. (C7) Nav role-gating: student/lecturer see Collections + Prep Hub;
 *      admin sees Prep Hub but NOT Collections.
 *
 * Runs against a freshly-seeded demo DB (`pnpm --filter
 * @workspace/api-server run seed:demo`). Driver-agnostic: works
 * whether `STORAGE_DRIVER` resolves to `local` or `gcs`.
 */

const LECTURER_EMAIL = "maya.cohen@knowledgebank.demo";
// amir hasn't voted in the seed and didn't create any of the open
// requests, so there's always an enabled "Upvote" button for him.
// (noa.student authors several open requests, which leaves her with
// disabled vote buttons on her own items.)
const STUDENT_EMAIL = "amir.student@knowledgebank.demo";
const ADMIN_EMAIL = "admin@knowledgebank.demo";
const DEMO_PASSWORD = "Demo1234!";

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/auth/login") && r.status() === 200,
    ),
    page.getByRole("button", { name: "Sign In", exact: true }).click(),
  ]);
  await page.waitForLoadState("networkidle");
}

test.describe("sprint 2 smoke", () => {
  test("lecturer: upload PDF, preview, comment", async ({ page }) => {
    await login(page, LECTURER_EMAIL);
    await page.goto("/upload");

    const baseName = `smoke-${randomUUID().slice(0, 8)}`;
    const fileName = `${baseName}.pdf`;
    // Minimal valid single-page PDF. A comment line carrying a random
    // nonce keeps the bytes unique across runs so the server-side
    // duplicate-file detector (sha256 per uploader) doesn't reject
    // reruns of the smoke against a hot DB.
    const nonce = randomUUID();
    const pdfBuffer = Buffer.from(
      `%PDF-1.4\n%nonce ${nonce}\n` +
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
        "xref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n" +
        "0000000053 00000 n \n0000000100 00000 n \n" +
        "trailer<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF",
      "binary",
    );

    const hiddenInput = page.locator(
      '[data-testid="upload-dropzone"] input[type="file"]',
    );
    await hiddenInput.setInputFiles({
      name: fileName,
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });
    await expect(
      page.locator('[data-testid="upload-item-queued"]'),
    ).toBeVisible();

    // Pick first available course + "lecture notes".
    await page
      .getByRole("combobox")
      .filter({ hasText: /Select course/i })
      .first()
      .click();
    await page.getByRole("option").first().click();
    await page
      .getByRole("combobox")
      .filter({ hasText: /Select type/i })
      .first()
      .click();
    await page.getByRole("option", { name: /lecture notes/i }).click();

    // Click submit and capture the created document id from the
    // upload response — more robust than scraping the queue card.
    const [uploadResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/documents/upload") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByTestId("upload-submit").click(),
    ]);
    expect(uploadResp.status(), "upload should succeed").toBeLessThan(300);
    const uploadJson = (await uploadResp.json()) as {
      results?: Array<{ success: boolean; document?: { id: string } }>;
    };
    const docId = uploadJson.results?.find((r) => r.success)?.document?.id;
    expect(docId, "upload response must include a document id").toBeTruthy();

    await page.goto(`/documents/${docId}`);

    // Preview iframe renders and points at the signed preview URL.
    const previewFrame = page.locator("iframe").first();
    await expect(previewFrame).toBeVisible({ timeout: 15_000 });
    const previewSrc = await previewFrame.getAttribute("src");
    expect(previewSrc, "preview iframe should point at signed preview").toMatch(
      /\/api\/documents\/.+\/preview\?token=/,
    );

    // Post a comment.
    const commentBody = `smoke ${randomUUID().slice(0, 8)}`;
    await page.getByTestId("comment-body-input").fill(commentBody);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/documents/${docId}/comments`) &&
          r.request().method() === "POST" &&
          r.status() < 400,
        { timeout: 10_000 },
      ),
      page.getByRole("button", { name: /Post Comment/i }).click(),
    ]);
    await expect(page.getByText(commentBody).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("student: upvote an open request-board item", async ({ page, request }) => {
    // Seed a fresh request as a lecturer so this test is independent
    // of prior runs (votes persist in the DB and the demo seed does
    // not clear them, so reusing a seeded request goes stale once
    // amir has voted on it).
    const lecturerLogin = await request.post("/api/auth/login", {
      data: { email: LECTURER_EMAIL, password: DEMO_PASSWORD },
    });
    expect(lecturerLogin.ok(), "lecturer api login should succeed").toBe(true);
    const requestTitle = `smoke request ${randomUUID().slice(0, 8)}`;
    const createReq = await request.post("/api/requests", {
      data: {
        title: requestTitle,
        description: "Auto-created by sprint-2 smoke spec.",
      },
    });
    expect(createReq.ok(), "seeding a request should succeed").toBe(true);
    const createdRequestId = ((await createReq.json()) as { id: string }).id;
    expect(createdRequestId, "create response must include an id").toBeTruthy();

    await login(page, STUDENT_EMAIL);
    await page.goto("/requests");

    // Find the card we just created, then its upvote button.
    const card = page
      .locator("article, [class*='card']")
      .filter({ hasText: requestTitle })
      .first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    const upvoteBtn = card
      .getByRole("button", { name: /Upvote this request/i })
      .first();
    await expect(upvoteBtn).toBeVisible();
    await expect(upvoteBtn).toBeEnabled();

    // Wait for the vote round-trip to land, then assert the count
    // increased. The button label changes to "You have already voted",
    // but the vote query refetches afterward, so we rely on the API
    // response + the on-card count as ground truth.
    const [voteResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/requests/${createdRequestId}/vote`) &&
          r.request().method() === "POST",
        { timeout: 10_000 },
      ),
      upvoteBtn.click(),
    ]);
    expect(voteResp.status(), "vote should succeed").toBe(200);

    // After the refetch, the SAME card must now show a disabled
    // "already voted" button — proves the vote round-tripped and the
    // UI re-rendered with hasVoted=true for this specific request.
    await expect(
      card.getByRole("button", { name: /You have already voted/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// C7 — Nav role-gating smoke
// ---------------------------------------------------------------------------
test.describe("nav role-gating (C7)", () => {
  /**
   * The desktop nav (`aria-label="Main navigation"`) is the target.
   * Collections is excluded for admins; Prep Hub is visible to all roles.
   */
  const desktopNav = (page: Page) =>
    page.getByRole("navigation", { name: "Main navigation" });

  test("student sees Collections and Prep Hub in nav", async ({ page }) => {
    await login(page, STUDENT_EMAIL);
    await page.goto("/");
    await expect(
      desktopNav(page).getByRole("link", { name: "Collections" }),
    ).toBeVisible();
    await expect(
      desktopNav(page).getByRole("link", { name: "Prep Hub" }),
    ).toBeVisible();
  });

  test("lecturer sees Collections and Prep Hub in nav", async ({ page }) => {
    await login(page, LECTURER_EMAIL);
    await page.goto("/");
    await expect(
      desktopNav(page).getByRole("link", { name: "Collections" }),
    ).toBeVisible();
    await expect(
      desktopNav(page).getByRole("link", { name: "Prep Hub" }),
    ).toBeVisible();
  });

  test("admin sees Prep Hub but NOT Collections in nav", async ({ page }) => {
    await login(page, ADMIN_EMAIL);
    await page.goto("/");
    await expect(
      desktopNav(page).getByRole("link", { name: "Prep Hub" }),
    ).toBeVisible();
    await expect(
      desktopNav(page).getByRole("link", { name: "Collections" }),
    ).toHaveCount(0);
  });
});
