import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import he from "./locales/he.json";

export const SUPPORTED_LANGUAGES = ["en", "he"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Languages that render right-to-left. */
const RTL_LANGUAGES: ReadonlySet<string> = new Set(["he"]);

export function isRtl(lng: string | undefined): boolean {
  return RTL_LANGUAGES.has((lng ?? "").split("-")[0]);
}

/** Keep <html lang/dir> in sync with the active language. */
export function applyDocumentDirection(lng: string | undefined): void {
  const base = (lng ?? "en").split("-")[0];
  const el = document.documentElement;
  el.setAttribute("lang", base);
  el.setAttribute("dir", isRtl(base) ? "rtl" : "ltr");
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      he: { translation: he },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "he"],
    // "he-IL" etc. should resolve to "he".
    load: "languageOnly",
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "kb-lang",
      caches: ["localStorage"],
    },
  });

// Apply on load and on every change so the document direction always matches.
applyDocumentDirection(i18n.resolvedLanguage);
i18n.on("languageChanged", applyDocumentDirection);

export default i18n;
