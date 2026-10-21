export type RecvSp = { bas?: string; bit?: string; para?: string; q?: string; borclu?: string; sira?: string };
export function recvParams(sp: RecvSp) {
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const iso = (v?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? v! : null);
  const to = iso(sp.bit) ?? today;
  const from = iso(sp.bas) ?? `${to.slice(0, 4)}-01-01`;
  const currency = sp.para === "TRY" ? "TRY" : sp.para === "USD" ? "USD" : "EUR";
  return { from, to, currency, q: (sp.q ?? "").trim(), onlyDebt: sp.borclu !== "0", sort: sp.sira === "ad" ? "ad" : sp.sira === "ciro" ? "ciro" : "bakiye" };
}
