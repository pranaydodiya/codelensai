import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required");
  if (key.length !== 64) throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  return Buffer.from(key, "hex");
}

export function isEncryptionEnabled(): boolean {
  return !!process.env.TOKEN_ENCRYPTION_KEY;
}

export function encrypt(plaintext: string): string {
  if (!isEncryptionEnabled()) return plaintext;

  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: enc:base64(iv):base64(authTag):base64(ciphertext)
  return `enc:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(encryptedText: string): string {
  // Not encrypted (no prefix or encryption disabled) — return as-is for backward compatibility
  if (!encryptedText.startsWith("enc:")) return encryptedText;
  if (!isEncryptionEnabled()) return encryptedText;

  const parts = encryptedText.split(":");
  if (parts.length !== 4) return encryptedText;

  try {
    const key = getKey();
    const iv = Buffer.from(parts[1], "base64");
    const authTag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      return encryptedText;
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
  } catch {
    // Decryption failed — token might be corrupted or key changed
    return encryptedText;
  }
}
