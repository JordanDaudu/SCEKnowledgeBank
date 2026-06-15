import { describe, it, expect } from "vitest";
import { renderSnippetHtml } from "./snippet";

describe("renderSnippetHtml", () => {
  it("HTML-escapes the haystack to prevent injection", () => {
    expect(renderSnippetHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(renderSnippetHtml(`a & "b" 'c'`)).toBe("a &amp; &quot;b&quot; &#39;c&#39;");
  });

  it("converts the server's sentinel markers into <mark> tags", () => {
    expect(renderSnippetHtml("[[KBMARK]]hit[[/KBMARK]]")).toBe("<mark>hit</mark>");
  });

  it("escapes the matched text while still wrapping it in <mark>", () => {
    expect(renderSnippetHtml("[[KBMARK]]<b>[[/KBMARK]] & x")).toBe(
      "<mark>&lt;b&gt;</mark> &amp; x",
    );
  });

  it("returns plain escaped text when there are no markers", () => {
    expect(renderSnippetHtml("nothing to mark")).toBe("nothing to mark");
  });
});
