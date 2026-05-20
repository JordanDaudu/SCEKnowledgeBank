import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export type SignedAction = "preview" | "download" | "thumbnail";

interface Payload {
  d: string; // document id
  a: SignedAction;
  u: string; // user id
  exp: number; // unix seconds
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? 0 : 4 - (str.length % 4);
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(padded, "base64");
}

export function signToken(
  documentId: string,
  action: SignedAction,
  userId: string,
  ttlSeconds = env.signedUrlTtlSeconds,
): { token: string; expiresAt: Date } {
  const payload: Payload = {
    d: documentId,
    a: action,
    u: userId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = b64urlEncode(
    createHmac("sha256", env.signedUrlSecret).update(body).digest(),
  );
  return {
    token: `${body}.${sig}`,
    expiresAt: new Date(payload.exp * 1000),
  };
}

export function verifyToken(
  token: string,
  documentId: string,
  action: SignedAction,
): { valid: boolean; userId?: string; reason?: string } {
  if (typeof token !== "string" || !token.includes(".")) {
    return { valid: false, reason: "malformed" };
  }
  const [body, sig] = token.split(".");
  if (!body || !sig) return { valid: false, reason: "malformed" };
  const expected = createHmac("sha256", env.signedUrlSecret)
    .update(body)
    .digest();
  const provided = b64urlDecode(sig);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return { valid: false, reason: "bad_signature" };
  }
  let parsed: Payload;
  try {
    parsed = JSON.parse(b64urlDecode(body).toString("utf8")) as Payload;
  } catch {
    return { valid: false, reason: "bad_payload" };
  }
  if (parsed.d !== documentId) return { valid: false, reason: "doc_mismatch" };
  if (parsed.a !== action) return { valid: false, reason: "action_mismatch" };
  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true, userId: parsed.u };
}
