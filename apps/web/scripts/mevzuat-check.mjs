// Mevzuat içerik dosyasını doğrular: node apps/web/scripts/mevzuat-check.mjs
// Haftalık mevzuat kontrolü dosyayı güncelledikten sonra bunu çalıştırır; hata varsa commit edilmez.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const file = join(dirname(fileURLToPath(import.meta.url)), "../src/content/mevzuat.json");
const d = JSON.parse(readFileSync(file, "utf8"));
const errors = [];
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
if (!isDate(d.last_checked)) errors.push("last_checked tarih değil");
const keys = new Set();
for (const p of d.params ?? []) {
  const id = `${p.key}@${p.valid_from}`;
  if (keys.has(id)) errors.push(`yinelenen değer: ${id}`);
  keys.add(id);
  if (!p.key || !p.label || typeof p.value !== "number" || !p.unit) errors.push(`eksik alan: ${id}`);
  if (!isDate(p.valid_from) || (p.valid_to !== null && !isDate(p.valid_to))) errors.push(`tarih hatalı: ${id}`);
  if (p.valid_to && p.valid_to < p.valid_from) errors.push(`bitiş başlangıçtan önce: ${id}`);
  if (!p.source) errors.push(`kaynak yok: ${id}`);
}
const ids = new Set();
for (const b of d.bulletin ?? []) {
  if (ids.has(b.id)) errors.push(`yinelenen bülten: ${b.id}`);
  ids.add(b.id);
  if (!isDate(b.date) || !b.title || !b.summary || !b.impact || !b.category) errors.push(`eksik bülten alanı: ${b.id}`);
  if (!["uygulandi", "bilgi", "onay-bekliyor"].includes(b.status)) errors.push(`geçersiz durum: ${b.id}`);
  if (!/^https?:\/\//.test(b.source ?? "")) errors.push(`kaynak bağlantısı yok: ${b.id}`);
}
if (errors.length) { console.error("mevzuat.json HATALI:\n- " + errors.join("\n- ")); process.exit(1); }
console.log(`mevzuat.json geçerli: ${d.params.length} değer, ${d.bulletin.length} bülten`);
