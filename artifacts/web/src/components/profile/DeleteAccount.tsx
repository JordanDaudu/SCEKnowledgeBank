import { useState } from "react";
import { apiUrl } from "@/lib/api-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Loader2 } from "lucide-react";

export default function DeleteAccount() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const doDelete = async () => {
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/me"), { method: "DELETE", credentials: "include" });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "Could not delete account");
      }
      window.location.href = "/login";
    } catch (err) {
      toast({ variant: "destructive", title: "Delete failed", description: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-destructive/30 pt-6" data-testid="delete-account">
      <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
      <p className="text-sm text-muted-foreground">
        Deleting your account disables login immediately. Your uploaded files remain, shown as
        &ldquo;Original uploader removed&rdquo;. An admin can restore your account within 30 days.
      </p>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); setConfirm(""); }}>
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm" className="gap-1.5" data-testid="delete-account-open">
            <Trash2 className="h-4 w-4" /> Delete account
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete your account?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This disables your login. Type{" "}
            <span className="font-mono font-semibold">DELETE</span> to confirm.
          </p>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE"
            data-testid="delete-account-confirm"
          />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={confirm !== "DELETE" || busy}
              onClick={doDelete}
              data-testid="delete-account-confirm-btn"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete my account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
