export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Display label for a document file version: 1 → "v1.0", 3 → "v3.0".
 * A new upload bumps the whole number (v1.0 → v2.0). Non-positive / missing
 * inputs default to v1.0 (every document has at least a first version).
 */
export function formatVersion(versionNumber: number | null | undefined): string {
  const n = versionNumber && versionNumber > 0 ? Math.floor(versionNumber) : 1;
  return `v${n}.0`;
}

/**
 * Whether a storage quota should be shown as "Unlimited" rather than a number.
 *
 * Local dev (STORAGE_DRIVER=local) reports an absurd quota (~8 million TB),
 * which renders as a meaningless figure and a flat progress bar. Any quota at
 * or above 1 PB — far beyond a realistic per-user allowance — is treated as
 * effectively unlimited, as are non-finite values.
 */
export function isUnlimitedQuota(quotaBytes: number): boolean {
  if (!Number.isFinite(quotaBytes)) return true;
  return quotaBytes >= 1024 ** 5; // 1 PB
}

export function formatDate(dateString: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(dateString));
}

export function formatDateTime(dateString: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(dateString));
}
