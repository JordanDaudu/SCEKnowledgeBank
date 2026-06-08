import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";

const MAX = 500;

export function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (reason: string) => void;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const tooLong = trimmed.length > MAX;
  const canSubmit = trimmed.length > 0 && !tooLong && !isSubmitting;

  function handleSubmit() {
    if (!canSubmit) return;
    onConfirm(trimmed);
  }

  function handleOpenChange(v: boolean) {
    if (!v) setReason("");
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("rejectDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("rejectDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reject-reason">{t("rejectDialog.reason")}</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("rejectDialog.placeholder")}
            rows={5}
            data-testid="reject-reason-input"
          />
          <div className="text-xs text-muted-foreground flex justify-between">
            <span>{tooLong ? t("rejectDialog.tooLong") : t("rejectDialog.required")}</span>
            <span>{trimmed.length}/{MAX}</span>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            {t("rejectDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="reject-confirm"
          >
            {isSubmitting ? t("rejectDialog.rejecting") : t("rejectDialog.reject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
