"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseBhParties, type BhParty } from "@/lib/bh-party";
import { bhPartyImport, bhPartyMatch } from "@/lib/bh-party-actions";

type Role = "customer" | "supplier";

/** Bizim Hesap müşteri / tedarikçi listesi → seçilen cariler ERP'ye */
export function BhPartyImport() {
  const router = useRouter();
  const [rows, setRows] = useState<BhParty[]>([]);
  const [fileRole, setFileRole] = useState<Role>("customer");
  const [role, setRole] = useState<Record<string, Role>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [exists, setExists] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [hideExisting, setHideExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; errors?: { name: string; error: string }[] } | null>(null);

  async function read(f: File) {
    setMsg(null); setRows([]); setSel(new Set());
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const t = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: "" });
      const r = parseBhParties(t);
      if (r.error) { setMsg({ ok: false, text: r.error }); return; }
      const guess: Role = /tedarik/i.test(f.name) ? "supplier" : fileRole;
      setFileRole(guess);
      setRows(r.rows);
      setRole(Object.fromEntries(r.rows.map((x) => [x.key, x.role ?? guess])));
      const m = await bhPartyMatch(r.rows.map((x) => ({ key: x.key, name: x.name, tax_no: x.tax_no })));
      if (!m.ok) setMsg({ ok: false, text: m.message ?? "Eşleştirme yapılamadı" });
      setExists(m.match ?? {});
    } catch (e) {
      setMsg({ ok: false, text: `Dosya okunamadı: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const shown = useMemo(() => {
    const n = q.toLocaleLowerCase("tr-TR").trim();
    return rows.filter((r) => (!hideExisting || !exists[r.key]) && (!n || `${r.name} ${r.tax_no ?? ""} ${r.city ?? ""} ${r.code ?? ""}`.toLocaleLowerCase("tr-TR").includes(n)));
  }, [rows, q, hideExisting, exists]);
  const allShown = shown.length > 0 && shown.every((r) => sel.has(r.key));

  function toggleAll() {
    const s = new Set(sel);
    if (allShown) shown.forEach((r) => s.delete(r.key)); else shown.forEach((r) => s.add(r.key));
    setSel(s);
  }
  function setAllRole(v: Role) {
    setFileRole(v);
    setRole(Object.fromEntries(rows.map((x) => [x.key, x.role ?? v])));
  }

  async function run() {
    setBusy(true); setMsg(null);
    const pick = rows.filter((r) => sel.has(r.key)).map((r) => ({ ...r, role: role[r.key] ?? fileRole }));
    const r = await bhPartyImport(pick);
    setMsg({ ok: r.ok, text: r.message, errors: r.errors });
    if (r.ok) {
      const m = await bhPartyMatch(rows.map((x) => ({ key: x.key, name: x.name, tax_no: x.tax_no })));
      setExists(m.match ?? {}); setSel(new Set());
    }
    setBusy(false); router.refresh();
  }

  const input = "h-10 rounded-lg border border-[#D5DEE8] px-3 bg-white text-sm";
  return (
    <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm font-semibold">Bizim Hesap müşteri / tedarikçi listesi (Excel)
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} className="text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Bu dosyadakiler
          <select value={fileRole} onChange={(e) => setAllRole(e.target.value as Role)} className={input}>
            <option value="customer">Müşteri</option>
            <option value="supplier">Tedarikçi</option>
          </select>
        </label>
      </div>
      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: ad, VKN, il…" className={`${input} w-64`} />
            <label className="flex items-center gap-2"><input type="checkbox" checked={hideExisting} onChange={(e) => setHideExisting(e.target.checked)} /> ERP&apos;de olanları gizle</label>
            <span className="text-muted">{rows.length} cari okundu · {Object.keys(exists).length} tanesi ERP&apos;de var · {sel.size} seçili</span>
          </div>
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto border border-[#EEF2F6] rounded-lg">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="sticky top-0 bg-white"><tr className="text-left text-xs text-muted">
                <th className="py-2 px-2"><input type="checkbox" checked={allShown} onChange={toggleAll} aria-label="Görünenlerin hepsini seç" /></th>
                <th className="py-2 font-semibold">Cari</th><th className="py-2 font-semibold">VKN / TCKN</th><th className="py-2 font-semibold">İletişim</th>
                <th className="py-2 font-semibold text-right">Bakiye</th><th className="py-2 font-semibold pl-3">Tür</th>
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} className={`border-t border-[#EEF2F6] align-top ${sel.has(r.key) ? "bg-[#F3F8FD]" : ""}`}>
                    <td className="py-2 px-2"><input type="checkbox" checked={sel.has(r.key)} onChange={() => { const s = new Set(sel); if (s.has(r.key)) s.delete(r.key); else s.add(r.key); setSel(s); }} /></td>
                    <td className="py-2 pr-2"><b>{r.name}</b>{r.code && <span className="text-xs text-muted"> · {r.code}</span>}
                      {exists[r.key] && <span className="block text-xs text-ok">ERP&apos;de var: {exists[r.key]} (eksik bilgileri tamamlanır)</span>}</td>
                    <td className="py-2 pr-2 num">{r.tax_no ?? "—"}{r.tax_office && <span className="block text-xs text-muted">{r.tax_office}</span>}</td>
                    <td className="py-2 pr-2 text-xs">{[r.phone, r.email].filter(Boolean).join(" · ") || "—"}<span className="block text-muted">{[r.district, r.city].filter(Boolean).join(" / ")}</span></td>
                    <td className="py-2 pr-2 text-right num whitespace-nowrap">{r.balance != null ? `${r.balance.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${r.currency ?? ""}` : "—"}</td>
                    <td className="py-2 pl-3">
                      <select value={role[r.key] ?? fileRole} onChange={(e) => setRole({ ...role, [r.key]: e.target.value as Role })} className="h-9 rounded-lg border border-[#D5DEE8] px-2 bg-white text-sm">
                        <option value="customer">Müşteri</option><option value="supplier">Tedarikçi</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy || sel.size === 0} onClick={run} className="h-12 px-5 rounded-[12px] bg-brand-700 text-white font-bold disabled:opacity-50">{busy ? "Aktarılıyor…" : `Seçilen ${sel.size} cariyi aktar`}</button>
            <span className="text-xs text-muted">Yalnız cari kart açılır (unvan, VKN, vergi dairesi, iletişim, adres). Bakiyeler aktarılmaz.</span>
          </div>
        </>
      )}
      {msg && (
        <div className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}
          {msg.errors?.length ? <ul className="list-disc pl-5 mt-1">{msg.errors.map((e) => <li key={e.name}>{e.name}: {e.error}</li>)}</ul> : null}
        </div>
      )}
    </section>
  );
}
