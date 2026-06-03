const FALLBACK_DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

export function getDefaultQuotaBytes(): number {
  const quota = Number(
    process.env.DEFAULT_QUOTA_BYTES ?? FALLBACK_DEFAULT_QUOTA_BYTES
  );

  if (!Number.isSafeInteger(quota) || quota < 0) {
    throw new Error("DEFAULT_QUOTA_BYTES must be a non-negative integer.");
  }

  return quota;
}
