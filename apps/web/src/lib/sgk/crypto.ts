import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * SGK şifreleri için AES-256-GCM. Anahtar: SGK_CRED_KEY (base64, 32 bayt) varsa o, yoksa sunucudaki
 * service role anahtarından HKDF ile türetilir. Anahtar hiçbir zaman veritabanına veya istemciye gitmez.
 */
function key(): Buffer {
  const k = process.env.SGK_CRED_KEY;
  if (k) {
    const b = Buffer.from(k, "base64");
    if (b.length !== 32) throw new Error("SGK_CRED_KEY 32 baytlık base64 olmalı");
    return b;
  }
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("Şifreleme anahtarı yok (SUPABASE_SERVICE_ROLE_KEY tanımlı değil)");
  return Buffer.from(hkdfSync("sha256", base, "mb-sgk", "sgk-credentials-v1", 32));
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decrypt(token: string | null | undefined): string | null {
  if (!token) return null;
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Şifreli veri biçimi tanınmadı");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/** Robot erişim anahtarı özeti (anahtarın kendisi saklanmaz) */
export const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");
export const newToken = () => `mbsgk_${randomBytes(24).toString("base64url")}`;
