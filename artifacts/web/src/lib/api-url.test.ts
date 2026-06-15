import { describe, it, expect } from "vitest";
import { apiUrl, apiEndpoints } from "./api-url";

// These tests assume VITE_API_BASE is unset (the default in the test env), so
// BASE is empty and paths stay relative.
describe("apiUrl (no VITE_API_BASE)", () => {
  it("returns an already-rooted path unchanged", () => {
    expect(apiUrl("/api/documents/1/preview")).toBe("/api/documents/1/preview");
  });

  it("adds a leading slash to a bare path", () => {
    expect(apiUrl("api/documents")).toBe("/api/documents");
  });

  it("passes absolute http(s) URLs through untouched", () => {
    expect(apiUrl("https://cdn.example.com/file.pdf")).toBe(
      "https://cdn.example.com/file.pdf",
    );
    expect(apiUrl("http://h/x")).toBe("http://h/x");
  });

  it("returns an empty string for empty input", () => {
    expect(apiUrl("")).toBe("");
  });
});

describe("apiEndpoints", () => {
  it("builds the upload endpoint", () => {
    expect(apiEndpoints.uploadDocuments()).toBe("/api/documents/upload");
  });
});
