// Sprint-3 M2 feature flag (review/approval workflow). Build-time
// only: Vite inlines `import.meta.env.VITE_FEATURE_REVIEW` at build,
// so toggling means a redeploy — which is exactly what we want for a
// staged rollout. Defaults to ON; set `VITE_FEATURE_REVIEW=false` to
// hide the queue link, submit CTA, and reviewer actions.
export const FEATURE_REVIEW: boolean = (() => {
  const v = (import.meta.env.VITE_FEATURE_REVIEW as string | undefined) ?? "";
  if (v === "") return true;
  return !["0", "false", "no", "off"].includes(v.trim().toLowerCase());
})();
