// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.) and
// auto-cleans the DOM between tests. Loaded via vitest `setupFiles`. Importing
// this in node-environment tests is a no-op beyond extending `expect`, so it is
// safe to apply globally even though only jsdom component tests use the DOM.
// `/vitest` augments vitest's `Assertion` type with the jest-dom matchers
// (toBeInTheDocument, etc.) for TypeScript; the explicit expect.extend below
// registers them at runtime.
import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});
