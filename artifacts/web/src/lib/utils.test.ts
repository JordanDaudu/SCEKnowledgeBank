import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy/conditional values", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });

  it("merges conflicting Tailwind utilities, last one winning", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });
});
