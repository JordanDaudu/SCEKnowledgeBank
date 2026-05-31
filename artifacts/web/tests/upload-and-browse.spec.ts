import { test, expect, type Page, type Request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * End-to-end coverage for the upload and browse pages.
 *
 * Covers the four scenarios from task #13:
 *   1. Selecting a too-large file shows the inline size error before any
 *      network call.
 *   2. Uploading a valid file shows progress and a success badge.
 *   3. Re-uploading the same filename surfaces the server's
 *      "uploaded as foo (2).ext" rename notice.
 *   4. Browse filters survive a hard refresh via the URL query string.
 *
 * Assumes the standard demo seed: `lecturer@demo` / `demo1234` and at least
 * one course/material type configured. The dev API + web servers must be
 * running (the artifact workflows take care of this).
 */

const LECTURER_EMAIL = "lecturer@demo";
const LECTURER_PASSWORD = "demo1234";

async function loginAsLecturer(page: Page): Promise<void> {
  await page.goto("/login");
  // Form-based login is the most reliable path — the quick-login button
  // pre-fills these exact values and submits the same mutation.
  await page.getByLabel("Email").fill(LECTURER_EMAIL);
  await page.getByLabel("Password").fill(LECTURER_PASSWORD);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
}

async function fillCardCourseAndType(
  page: Page,
  cardIndex = 0,
): Promise<void> {
  const card = page.locator('[data-testid^="upload-item-"]').nth(cardIndex);
  await card.getByTestId("card-course-select").click();
  await page.getByRole("option").first().click();
  await card.getByTestId("card-type-select").click();
  await page.getByRole("option", { name: /lecture notes/i }).click();
}

test.describe("upload page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsLecturer(page);
  });

  test("client-side size validation blocks oversized files before any network call", async ({
    page,
  }) => {
    await page.goto("/upload");

    const uploadRequests: Request[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/documents/upload")) uploadRequests.push(req);
    });

    const hiddenInput = page.locator(
      '[data-testid="upload-dropzone"] input[type="file"]',
    );

    // 52 MB file — exceeds the 50 MB client limit. Playwright caps
    // in-memory setInputFiles buffers at 50 MB, so write to disk first.
    const dir = await mkdtemp(path.join(tmpdir(), "pw-upload-"));
    const bigPath = path.join(dir, `huge-${randomUUID().slice(0, 8)}.pdf`);
    await writeFile(bigPath, Buffer.alloc(52 * 1024 * 1024, 0));
    try {
      await hiddenInput.setInputFiles(bigPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    const failedItem = page.locator('[data-testid="upload-item-failed"]');
    await expect(failedItem).toBeVisible();

    const errorMsg = page.locator('[data-testid="upload-error"]');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText(/50\s?MB/i);

    // Submit must stay disabled because pendingCount is 0 (no queued items).
    await expect(page.getByTestId("upload-submit")).toBeDisabled();

    // Give the page a beat to confirm no request fires asynchronously.
    await page.waitForTimeout(500);
    expect(
      uploadRequests,
      "client validation should not have made any /api/documents/upload request",
    ).toHaveLength(0);
  });

  test("valid file uploads, shows progress then a success badge", async ({
    page,
  }) => {
    await page.goto("/upload");

    const baseName = `doc-${randomUUID().slice(0, 8)}`;
    const fileName = `${baseName}.txt`;

    const hiddenInput = page.locator(
      '[data-testid="upload-dropzone"] input[type="file"]',
    );
    await hiddenInput.setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(`Hello from playwright ${randomUUID()}`),
    });

    await expect(
      page.locator('[data-testid="upload-item-queued"]'),
    ).toBeVisible();

    await fillCardCourseAndType(page);

    // Install a MutationObserver BEFORE the click so we can prove the queue
    // item transitions through the "uploading" state on its way to success,
    // even when the upload completes too fast for a polling loop to catch.
    await page.evaluate(() => {
      const seen = new Set<string>();
      (window as unknown as { __uploadStatuses: Set<string> }).__uploadStatuses =
        seen;
      const record = (root: ParentNode) => {
        root
          .querySelectorAll('[data-testid^="upload-item-"]')
          .forEach((el) => {
            const tid = el.getAttribute("data-testid");
            if (tid) seen.add(tid);
          });
      };
      record(document);
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach((n) => {
            if (n instanceof Element) record(n);
          });
          if (
            m.type === "attributes" &&
            m.target instanceof Element &&
            m.attributeName === "data-testid"
          ) {
            const tid = m.target.getAttribute("data-testid");
            if (tid?.startsWith("upload-item-")) seen.add(tid);
          }
        }
      });
      mo.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-testid"],
      });
    });

    await page.getByTestId("upload-submit").click();

    const successItem = page.locator('[data-testid="upload-item-success"]');
    await expect(successItem).toBeVisible({ timeout: 20_000 });
    await expect(successItem.getByText(/Uploaded/i).first()).toBeVisible();

    const observedStatuses = await page.evaluate(() =>
      Array.from(
        (window as unknown as { __uploadStatuses: Set<string> })
          .__uploadStatuses ?? [],
      ),
    );
    expect(
      observedStatuses,
      "queue item must pass through the uploading state on its way to success",
    ).toContain("upload-item-uploading");
    expect(observedStatuses).toContain("upload-item-success");

    // First upload of this filename — no rename notice should appear.
    await expect(
      successItem.locator('[data-testid="upload-rename"]'),
    ).toHaveCount(0);
  });

  test("duplicate filename triggers the server-side rename notice", async ({
    page,
  }) => {
    const baseName = `dup-${randomUUID().slice(0, 8)}`;
    const fileName = `${baseName}.txt`;

    // First upload — establishes the filename for this user.
    await page.goto("/upload");
    const firstInput = page.locator(
      '[data-testid="upload-dropzone"] input[type="file"]',
    );
    await firstInput.setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(`first ${randomUUID()}`),
    });
    await fillCardCourseAndType(page);
    await page.getByTestId("upload-submit").click();
    await expect(
      page.locator('[data-testid="upload-item-success"]'),
    ).toBeVisible({ timeout: 20_000 });

    // Second upload — same name, different content. The server should
    // rename it to "{baseName} (2).txt".
    await page.goto("/upload");
    const secondInput = page.locator(
      '[data-testid="upload-dropzone"] input[type="file"]',
    );
    await secondInput.setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(`second ${randomUUID()}`),
    });
    await fillCardCourseAndType(page);
    await page.getByTestId("upload-submit").click();

    const successItem = page.locator('[data-testid="upload-item-success"]');
    await expect(successItem).toBeVisible({ timeout: 20_000 });

    const renameNotice = page.locator('[data-testid="upload-rename"]');
    await expect(renameNotice).toBeVisible();
    await expect(renameNotice).toContainText(`${baseName} (2).txt`);
  });

  test("uploads ready files and leaves needs-info files on screen", async ({
    page,
  }) => {
    await page.goto("/upload");
    const input = page.locator(
      '[data-testid="upload-dropzone"] input[type="file"]',
    );

    const a = `ready-${randomUUID().slice(0, 8)}.txt`;
    const b = `incomplete-${randomUUID().slice(0, 8)}.txt`;
    await input.setInputFiles([
      { name: a, mimeType: "text/plain", buffer: Buffer.from(`A ${randomUUID()}`) },
      { name: b, mimeType: "text/plain", buffer: Buffer.from(`B ${randomUUID()}`) },
    ]);

    // Two cards appear; fill required fields on the FIRST only.
    await expect(page.locator('[data-testid^="upload-item-"]')).toHaveCount(2);
    await fillCardCourseAndType(page, 0);

    // Button reflects exactly one ready file.
    await expect(page.getByTestId("upload-submit")).toHaveText(/Upload 1 File/i);
    await page.getByTestId("upload-submit").click();

    // The ready file succeeds; the incomplete one stays as needs-info.
    await expect(
      page.locator('[data-testid="upload-item-success"]'),
    ).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByTestId("card-needs-info")).toBeVisible();
    await expect(page.getByTestId("card-missing")).toContainText(/Course is required/i);
  });
});

test.describe("browse page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsLecturer(page);
  });

  test("filters are written to the URL and survive a hard refresh", async ({
    page,
  }) => {
    await page.goto("/browse");

    await page.getByTestId("browse-search").fill("lecture");

    // Material-type select (the "All Types" trigger before the sort select).
    await page
      .getByRole("combobox")
      .filter({ hasText: /All Types/i })
      .click();
    await page.getByRole("option", { name: /lecture notes/i }).click();

    // useQueryStateSync debounces — give it time to settle into the URL.
    await expect.poll(() => new URL(page.url()).search).toContain("q=lecture");
    await expect
      .poll(() => new URL(page.url()).search)
      .toContain("materialType=lecture-notes");

    const urlBeforeReload = page.url();
    await page.reload();

    expect(new URL(page.url()).search).toBe(new URL(urlBeforeReload).search);
    await expect(page.getByTestId("browse-search")).toHaveValue("lecture");
    // Active-filter chip strip should render the restored materialType filter.
    await expect(page.getByText(/Type:\s*lecture notes/i)).toBeVisible();
  });
});
