import { useState } from "react";
import {
  useGetDocumentAiSuggestions,
  useAcceptDocumentAiSuggestions,
  useDismissDocumentAiSuggestions,
  useGenerateDocumentAiSuggestions,
  getGetDocumentAiSuggestionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  documentId: string;
  /** Server-computed permission flag — card is owner/admin only. */
  canEdit: boolean;
}

/**
 * Owner-only review card for pending AI suggestions (design 2026-06-10).
 * Renders nothing when the feature is disabled server-side, the doc has
 * no extracted text, or the suggestion is already resolved (accepted/
 * dismissed). A failed or absent suggestion shows a Generate button.
 */
export default function AiSuggestionsCard({ documentId, canEdit }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useGetDocumentAiSuggestions(documentId, {
    query: {
      enabled: canEdit,
      queryKey: getGetDocumentAiSuggestionsQueryKey(documentId),
    },
  });
  const [useSummary, setUseSummary] = useState(true);
  const [selectedTagIds, setSelectedTagIds] = useState<string[] | null>(null);
  const [selectedNewTags, setSelectedNewTags] = useState<string[] | null>(null);

  const invalidate = () => {
    void refetch();
    // Accepted tags/summary change the document DTO — refetch it.
    void queryClient.invalidateQueries();
  };
  const acceptMutation = useAcceptDocumentAiSuggestions({
    mutation: { onSuccess: invalidate },
  });
  const dismissMutation = useDismissDocumentAiSuggestions({
    mutation: { onSuccess: invalidate },
  });
  const generateMutation = useGenerateDocumentAiSuggestions({
    mutation: { onSuccess: invalidate },
  });

  if (!canEdit || isLoading || !data || !data.enabled) return null;

  const suggestion = data.suggestion;
  const resolved =
    suggestion?.status === "accepted" || suggestion?.status === "dismissed";

  // No pending suggestion: offer manual generation when possible.
  if (!suggestion || suggestion.status === "failed") {
    if (!data.hasExtractedText || resolved) return null;
    return (
      <div className="rounded-lg border p-4 mb-4" data-testid="ai-suggestions-card">
        {suggestion?.status === "failed" && (
          <p className="text-sm text-muted-foreground mb-2">
            {t("aiSuggestions.failed")}
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={generateMutation.isPending}
          onClick={() => generateMutation.mutate({ id: documentId })}
          data-testid="ai-suggestions-generate"
        >
          <Sparkles className="h-4 w-4 me-1" />
          {generateMutation.isPending
            ? t("aiSuggestions.generating")
            : t("aiSuggestions.generate")}
        </Button>
      </div>
    );
  }

  if (suggestion.status !== "pending") return null;

  const tagIds =
    selectedTagIds ?? suggestion.suggestedTags.map((tag) => tag.id);
  const toggleTag = (id: string) =>
    setSelectedTagIds(
      tagIds.includes(id) ? tagIds.filter((x) => x !== id) : [...tagIds, id],
    );

  // New-tag proposals default to all-selected, same as existing tags.
  const newTags = selectedNewTags ?? suggestion.suggestedNewTags;
  const toggleNewTag = (name: string) =>
    setSelectedNewTags(
      newTags.includes(name)
        ? newTags.filter((x) => x !== name)
        : [...newTags, name],
    );
  const nothingSelected =
    !useSummary && tagIds.length === 0 && newTags.length === 0;

  return (
    <div className="rounded-lg border p-4 mb-4" data-testid="ai-suggestions-card">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4" />
        <h3 className="font-semibold">{t("aiSuggestions.title")}</h3>
      </div>
      {suggestion.summary && (
        <div className="mb-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={useSummary}
              onCheckedChange={(v) => setUseSummary(v === true)}
              data-testid="ai-suggestions-use-summary"
            />
            <span>
              <span className="font-medium block mb-1">
                {t("aiSuggestions.summaryLabel")}
              </span>
              <span className="text-muted-foreground">{suggestion.summary}</span>
            </span>
          </label>
        </div>
      )}
      {suggestion.suggestedTags.length > 0 && (
        <div className="mb-3">
          <p className="text-sm font-medium mb-1">{t("aiSuggestions.tagsLabel")}</p>
          <div className="flex flex-wrap gap-1">
            {suggestion.suggestedTags.map((tag) => (
              <Badge
                key={tag.id}
                variant={tagIds.includes(tag.id) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleTag(tag.id)}
                data-testid={`ai-suggestions-tag-${tag.id}`}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {suggestion.suggestedNewTags.length > 0 && (
        <div className="mb-3">
          <p className="text-sm font-medium mb-1">
            {t("aiSuggestions.newTagsLabel")}
          </p>
          <div className="flex flex-wrap gap-1">
            {suggestion.suggestedNewTags.map((name) => (
              <Badge
                key={name}
                variant={newTags.includes(name) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleNewTag(name)}
                data-testid={`ai-suggestions-newtag-${name}`}
              >
                + {name}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={acceptMutation.isPending || nothingSelected}
          onClick={() =>
            acceptMutation.mutate({
              id: documentId,
              data: { acceptSummary: useSummary, tagIds, newTags },
            })
          }
          data-testid="ai-suggestions-accept"
        >
          {t("aiSuggestions.accept")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={dismissMutation.isPending}
          onClick={() => dismissMutation.mutate({ id: documentId })}
          data-testid="ai-suggestions-dismiss"
        >
          {t("aiSuggestions.dismiss")}
        </Button>
      </div>
    </div>
  );
}
