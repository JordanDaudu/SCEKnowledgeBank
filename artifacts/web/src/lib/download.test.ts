// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { triggerDownload } from "./download";

describe("triggerDownload", () => {
  const original = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: original,
    });
  });

  it("navigates the top-level window to the URL", () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign },
    });

    triggerDownload("/api/documents/1/download?token=abc");

    expect(assign).toHaveBeenCalledWith("/api/documents/1/download?token=abc");
  });
});
