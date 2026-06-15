import { describe, it, expect } from "vitest";
import { Activity, FileText, MessageSquare, User } from "lucide-react";
import { describeAction, iconForEntity } from "./activity-format";

describe("describeAction", () => {
  it("returns the curated label for a known action", () => {
    expect(describeAction("document.upload")).toBe("uploaded");
    expect(describeAction("user.login")).toBe("signed in");
  });

  it("falls back to a readable form: strips the type prefix and splits ._", () => {
    expect(describeAction("document.frobnicate")).toBe("frobnicate");
    expect(describeAction("widget.bar_baz")).toBe("bar baz");
  });
});

describe("iconForEntity", () => {
  it("maps known entity types to their icons", () => {
    expect(iconForEntity("document")).toBe(FileText);
    expect(iconForEntity("comment")).toBe(MessageSquare);
    expect(iconForEntity("user")).toBe(User);
  });

  it("falls back to the generic Activity icon for unknown types", () => {
    expect(iconForEntity("something-else")).toBe(Activity);
  });
});
