// Short-lived signed download links, so an agent can hand a file to its user without sharing a key or a cookie.
import "server-only";
import crypto from "node:crypto";
import { sign } from "./auth";

export const FILE_LINK_TTL_S = 15 * 60;

export function signedFileUrl(origin: string, fileId: string, ttlS = FILE_LINK_TTL_S, now = Date.now()): { url: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + ttlS;
  const sig = sign(`file:${fileId}:${exp}`);
  return { url: `${origin}/api/files/${encodeURIComponent(fileId)}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function validFileSignature(fileId: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || Number(exp) * 1000 < now) return false;
  const expected = Buffer.from(sign(`file:${fileId}:${exp}`));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
