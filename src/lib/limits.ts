import "server-only";

/** Vercel functions reject request bodies over 4.5 MB, so uploads cap at 4 MB there. */
export function maxUploadMb(): number {
  const configured = Number(process.env.CLAYFORM_MAX_UPLOAD_MB);
  if (Number.isFinite(configured) && configured > 0) return process.env.VERCEL ? Math.min(configured, 4) : configured;
  return process.env.VERCEL ? 4 : 10;
}
