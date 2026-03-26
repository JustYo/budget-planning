import { getConfig } from './config.js';

/**
 * Calls POST /background-sync on the eb-importer service.
 * Uses account UIDs stored after the last manual OAuth flow — no browser needed.
 * Safe to call even if eb-importer is not configured (skips silently).
 */
export async function triggerBankSync() {
  const cfg = getConfig();
  if (!cfg.ebImporterUrl) {
    console.log('Bank sync: skipped (EB_IMPORTER_URL not set)');
    return;
  }

  console.log('Bank sync: starting...');
  try {
    const res = await fetch(`${cfg.ebImporterUrl}/background-sync`, {
      method: 'POST',
      signal: AbortSignal.timeout(90_000), // 90s — fetching bank data can be slow
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(
        `Bank sync: done (${data.imported ?? '?'} transactions imported)`,
      );
    } else if (
      data.detail?.includes('expired') ||
      data.detail?.includes('No stored session')
    ) {
      console.warn(
        'Bank sync: session expired or missing — re-authenticate at /sync',
      );
    } else {
      console.warn('Bank sync: failed —', data.detail ?? res.statusText);
    }
  } catch (err) {
    // Never let a sync failure block the email from sending
    console.warn('Bank sync: error —', err.message);
  }
}
