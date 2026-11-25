import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Encrypts secrets that have to be read back, such as a Bitbucket token, before they go into the
// database. AES-256-GCM, with a key derived from AUTH_SECRET, so a copy of the database alone
// doesn't give the secret away. Changing AUTH_SECRET makes what was stored unreadable: it then has
// to be entered again.

const VERSION = "v1";
const IV_BYTES = 12;

function key() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET is not set, so secrets can't be encrypted.");
  // The label keeps this key apart from every other use of AUTH_SECRET.
  return Buffer.from(hkdfSync("sha256", secret, "", "getl:secret-box:v1", 32));
}

/** "v1.<iv>.<tag>.<ciphertext>", each part base64url. A fresh IV every time. */
export function encryptSecret(plain: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** The secret, or null when it can't be read: AUTH_SECRET has changed, or the value was altered. */
export function decryptSecret(stored: string): string | null {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
