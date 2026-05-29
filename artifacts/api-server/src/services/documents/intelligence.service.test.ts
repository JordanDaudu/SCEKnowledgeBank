import { describe, expect, it } from "vitest";
import { detectLanguage, extractKeywords } from "./intelligence.service";

describe("detectLanguage", () => {
  it("detects English on a typical paragraph", () => {
    const text =
      "The quick brown fox jumps over the lazy dog. This is a sample paragraph " +
      "that should clearly be detected as English by the classifier, given how " +
      "many function words appear in it.";
    expect(detectLanguage(text)).toBe("en");
  });

  it("detects Spanish on a typical paragraph", () => {
    const text =
      "El gato negro está en la mesa de la cocina y no se mueve por mucho que " +
      "lo intente. Este es un texto de prueba para el clasificador.";
    expect(detectLanguage(text)).toBe("es");
  });

  it("detects French on a typical paragraph", () => {
    const text =
      "Le chat noir est sur la table de la cuisine et ne bouge pas. Ce est " +
      "un texte de test pour le classificateur de langues que nous avons écrit.";
    expect(detectLanguage(text)).toBe("fr");
  });

  it("detects German on a typical paragraph", () => {
    const text =
      "Der Hund ist in dem Garten und der Mann steht an der Tür mit einer " +
      "Tasse Kaffee. Das ist ein Testtext für die Erkennung von Sprache.";
    expect(detectLanguage(text)).toBe("de");
  });

  it("returns undefined on empty or very short input", () => {
    expect(detectLanguage("")).toBeUndefined();
    expect(detectLanguage("hello world")).toBeUndefined();
  });

  it("returns undefined when no stopwords match (e.g. random tokens)", () => {
    const text = "xqz wrth bvcz mnpr asdq tyui hjkl zxcv bnmd";
    expect(detectLanguage(text)).toBeUndefined();
  });
});

describe("extractKeywords", () => {
  it("returns top terms by frequency, stopwords excluded", () => {
    const text =
      "Photosynthesis converts sunlight into chemical energy. Photosynthesis " +
      "happens in chloroplasts of plant cells. The chemical energy is stored " +
      "as glucose. Photosynthesis is fundamental to plant metabolism.";
    const kws = extractKeywords(text, 5);
    expect(kws[0]).toBe("photosynthesis");
    expect(kws).toContain("chemical");
    expect(kws).toContain("energy");
    // Stopwords like "the", "is", "of", "to" must not appear.
    expect(kws).not.toContain("the");
    expect(kws).not.toContain("is");
  });

  it("drops tokens shorter than the minimum length", () => {
    const text = "AI ML AI ML AI ML aircraft aircraft aircraft engineering engineering";
    const kws = extractKeywords(text, 5);
    expect(kws).toContain("aircraft");
    expect(kws).toContain("engineering");
    expect(kws).not.toContain("ai");
    expect(kws).not.toContain("ml");
  });

  it("returns an empty list for empty input", () => {
    expect(extractKeywords("")).toEqual([]);
    expect(extractKeywords("   \n\n  ")).toEqual([]);
  });

  it("respects the max parameter", () => {
    const text =
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu " +
      "xi omicron pi rho sigma tau upsilon phi chi psi omega";
    const kws = extractKeywords(text, 3);
    expect(kws.length).toBe(3);
  });

  it("is deterministic on ties (alphabetical secondary sort)", () => {
    // Every term appears exactly once → ties broken alphabetically.
    const text = "zebra yacht xenon willow vapor";
    const kws = extractKeywords(text, 3);
    expect(kws).toEqual(["vapor", "willow", "xenon"]);
  });
});
