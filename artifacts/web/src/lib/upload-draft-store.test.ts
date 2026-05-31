import { describe, expect, it } from "vitest";
import { isFresh, toDraftItems, type DraftSource } from "./upload-draft-store";

const FILE = {} as unknown as File; // toDraftItems passes the File through untouched

function src(over: Partial<DraftSource> = {}): DraftSource {
  return {
    id: "i1",
    file: FILE,
    filename: "a.pdf",
    sizeBytes: 10,
    courseId: "",
    materialType: "",
    categoryId: "",
    visibility: "public",
    semester: "",
    academicYear: "2026",
    title: "",
    tagIds: [],
    status: "queued",
    suggestion: null,
    ...over,
  };
}

describe("isFresh", () => {
  it("is true within the TTL and false past it", () => {
    expect(isFresh(1_000, 1_000, 60_000)).toBe(true); // same instant
    expect(isFresh(1_000, 60_000 + 1_000, 60_000)).toBe(true); // exactly at TTL
    expect(isFresh(1_000, 60_001 + 1_000, 60_000)).toBe(false); // 1ms past TTL
  });
  it("treats a future savedAt (clock skew) as not fresh", () => {
    expect(isFresh(5_000, 1_000, 60_000)).toBe(false);
  });
});

describe("toDraftItems", () => {
  it("keeps queued and failed items", () => {
    const out = toDraftItems([
      src({ id: "a", status: "queued" }),
      src({ id: "b", status: "failed", error: "Course is required" }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["a", "b"]);
    expect(out[1].error).toBe("Course is required");
  });

  it("normalizes an interrupted uploading item back to queued and clears its error", () => {
    const out = toDraftItems([
      src({ id: "u", status: "uploading", error: "boom", errorCode: "network" }),
    ]);
    expect(out[0].status).toBe("queued");
    expect(out[0].error).toBeUndefined();
    expect(out[0].errorCode).toBeUndefined();
  });

  it("drops already-uploaded (success) items", () => {
    const out = toDraftItems([
      src({ id: "ok", status: "success" }),
      src({ id: "q", status: "queued" }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["q"]);
  });

  it("carries the editable metadata and suggestion through", () => {
    const out = toDraftItems([
      src({ courseId: "c1", materialType: "exam", tagIds: ["t1"], suggestion: { keywords: [], tags: [] } as never }),
    ]);
    expect(out[0].courseId).toBe("c1");
    expect(out[0].materialType).toBe("exam");
    expect(out[0].tagIds).toEqual(["t1"]);
    expect(out[0].suggestion).toEqual({ keywords: [], tags: [] });
  });

  it("returns an empty array when nothing is worth saving", () => {
    expect(toDraftItems([src({ status: "success" })])).toEqual([]);
    expect(toDraftItems([])).toEqual([]);
  });
});
