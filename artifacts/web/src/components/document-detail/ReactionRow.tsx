import { useState } from "react";
import {
  useAddCommentReaction,
  useRemoveCommentReaction,
  getListDocumentCommentsQueryKey,
  type CommentReaction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

/**
 * Sprint-3 M6 reaction row. The kind list is the fixed allow-list from
 * the backend (`reactions.service.REACTION_KINDS`); the picker is
 * deliberately not extensible by users.
 */
const REACTION_KINDS = [
  { kind: "like", label: "👍" },
  { kind: "love", label: "❤" },
  { kind: "insightful", label: "💡" },
  { kind: "celebrate", label: "🎉" },
  { kind: "thanks", label: "🙏" },
  { kind: "question", label: "❓" },
] as const;

type Kind = (typeof REACTION_KINDS)[number]["kind"];

interface Props {
  commentId: string;
  documentId: string;
  reactions: CommentReaction[];
}

export default function ReactionRow({ commentId, documentId, reactions }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const addMutation = useAddCommentReaction();
  const removeMutation = useRemoveCommentReaction();

  const summary = new Map<string, CommentReaction>();
  for (const r of reactions) summary.set(r.kind, r);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListDocumentCommentsQueryKey(documentId),
    });

  const toggle = (kind: Kind) => {
    const current = summary.get(kind);
    const action = current?.viewerReacted ? removeMutation : addMutation;
    action.mutate(
      { commentId, kind },
      {
        onSuccess: () => {
          setPickerOpen(false);
          invalidate();
        },
        onError: (err) => {
          const data = (err as { data?: { error?: { message?: string } } })?.data;
          toast({
            variant: "destructive",
            title: t("reactions.failed"),
            description: data?.error?.message || (err as Error)?.message,
          });
        },
      },
    );
  };

  const isPending = addMutation.isPending || removeMutation.isPending;

  return (
    <div
      className="flex items-center gap-1 flex-wrap mt-2 pl-8"
      data-testid={`reactions-${commentId}`}
    >
      {REACTION_KINDS.map(({ kind, label }) => {
        const r = summary.get(kind);
        if (!r || r.count === 0) return null;
        return (
          <button
            key={kind}
            type="button"
            disabled={isPending}
            onClick={() => toggle(kind)}
            data-testid={`reaction-pill-${commentId}-${kind}`}
            aria-pressed={r.viewerReacted}
            className={
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors " +
              (r.viewerReacted
                ? "bg-primary/10 border-primary/40 text-primary"
                : "bg-background hover:bg-accent")
            }
          >
            <span aria-hidden>{label}</span>
            <span>{r.count}</span>
          </button>
        );
      })}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          data-testid={`reaction-add-${commentId}`}
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          aria-label={t("reactions.add")}
        >
          {t("reactions.react")}
        </button>
        {pickerOpen && (
          <div
            className="absolute z-20 mt-1 flex gap-1 rounded-md border bg-popover p-1 shadow-md"
            data-testid={`reaction-picker-${commentId}`}
          >
            {REACTION_KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                onClick={() => toggle(kind as Kind)}
                disabled={isPending}
                title={t(`reactions.${kind}`)}
                data-testid={`reaction-choice-${commentId}-${kind}`}
                className="rounded p-1 text-base hover:bg-accent"
              >
                <span aria-hidden>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
