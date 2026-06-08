import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "he", label: "עברית" },
] as const;

/**
 * Header language switcher. Changing the language is immediate (react-i18next
 * re-renders) and persisted to localStorage by the language detector; the
 * document `dir`/`lang` follow via the i18n module.
 */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? "en").split("-")[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("common.language")}
          title={t("common.language")}
          data-testid="language-switcher"
        >
          <Languages className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGUAGES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => void i18n.changeLanguage(l.code)}
            className={current === l.code ? "font-semibold" : ""}
            aria-current={current === l.code ? "true" : undefined}
          >
            {l.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
