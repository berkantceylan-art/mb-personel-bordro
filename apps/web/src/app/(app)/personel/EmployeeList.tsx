"use client";
import Link from "next/link";
import { useMemo, useState } from "react";

export interface EmployeeRow {
  id: string;
  name: string;
  card: string | null;
  dept: string | null;
  deptId: string | null;
  branch: string | null;
  hire: string;
  status: string;
  balance: string | null;
}

type Durum = "aktif" | "ayrilan" | "tumu";

/** Türkçe harf ve büyük/küçük farkı gözetmeden arama anahtarı */
const key = (s: string) =>
  s.toLocaleLowerCase("tr").replace(/[çğıöşüâ]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a" })[c] ?? c).replace(/\s+/g, " ").trim();

export function EmployeeList({
  rows,
  departments,
  showBalance,
  initial,
}: {
  rows: EmployeeRow[];
  departments: Array<{ id: string; name: string }>;
  showBalance: boolean;
  initial: { q: string; bolum: string; durum: Durum };
}) {
  const [q, setQ] = useState(initial.q);
  const [bolum, setBolum] = useState(initial.bolum);
  const [durum, setDurum] = useState<Durum>(initial.durum);

  const indexed = useMemo(() => rows.map((r) => ({ r, k: key(`${r.name} ${r.card ?? ""}`) })), [rows]);
  const counts = useMemo(() => ({
    aktif: rows.filter((r) => r.status !== "terminated").length,
    ayrilan: rows.filter((r) => r.status === "terminated").length,
    tumu: rows.length,
  }), [rows]);

  const list = useMemo(() => {
    const words = key(q).split(" ").filter(Boolean);
    return indexed
      .filter(({ r, k }) =>
        (durum === "tumu" || (durum === "aktif" ? r.status !== "terminated" : r.status === "terminated")) &&
        (!bolum || r.deptId === bolum) &&
        words.every((w) => k.includes(w)))
      .map(({ r }) => r);
  }, [indexed, q, bolum, durum]);

  // Adres çubuğunu sayfayı yenilemeden güncelle (geri gelince aynı filtre)
  const sync = (next: { q?: string; bolum?: string; durum?: Durum }) => {
    const v = { q, bolum, durum, ...next };
    const u = new URLSearchParams();
    if (v.q.trim()) u.set("q", v.q.trim());
    if (v.bolum) u.set("bolum", v.bolum);
    if (v.durum !== "aktif") u.set("durum", v.durum);
    window.history.replaceState(null, "", `/personel${u.size ? `?${u}` : ""}`);
  };

  const tab = (d: Durum, label: string) => (
    <button
      type="button"
      onClick={() => { setDurum(d); sync({ durum: d }); }}
      aria-pressed={durum === d}
      className={`h-11 px-3.5 rounded-[10px] font-semibold text-sm border ${durum === d ? "bg-brand-700 text-white border-brand-700" : "bg-white text-brand-700 border-[#D5DEE8]"}`}
    >
      {label} <span className={durum === d ? "text-white/80" : "text-muted"}>({counts[d]})</span>
    </button>
  );

  return (
    <>
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Durum">
          {tab("aktif", "Aktif çalışanlar")}
          {tab("ayrilan", "Ayrılanlar")}
          {tab("tumu", "Tümü")}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); sync({ q: e.target.value }); }}
          placeholder="Ad, soyad veya PDKS no yazın"
          aria-label="Personel ara"
          autoComplete="off"
          className="h-11 flex-1 min-w-56 rounded-[10px] border border-[#D5DEE8] bg-white px-3.5"
        />
        <select
          value={bolum}
          onChange={(e) => { setBolum(e.target.value); sync({ bolum: e.target.value }); }}
          aria-label="Bölüm"
          className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3"
        >
          <option value="">Tüm bölümler</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <p className="text-sm text-muted -mt-1" aria-live="polite">{list.length} kişi gösteriliyor</p>

      <div className="bg-white border border-line rounded-[14px] overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-3 px-3 font-semibold border-b border-line w-10 text-right">#</th>
              <th className="py-3 px-4 font-semibold border-b border-line">Ad soyad</th>
              <th className="py-3 px-4 font-semibold border-b border-line">PDKS no</th>
              <th className="py-3 px-4 font-semibold border-b border-line">Bölüm</th>
              <th className="py-3 px-4 font-semibold border-b border-line">Şube</th>
              <th className="py-3 px-4 font-semibold border-b border-line">İşe giriş</th>
              {showBalance && <th className="py-3 px-4 font-semibold border-b border-line text-right">Bu ay kalan</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((e, i) => (
              <tr key={e.id} className="hover:bg-[#F7F9FB]">
                <td className="num py-3 px-3 border-b border-[#EEF2F6] text-right text-muted">{i + 1}</td>
                <td className="py-3 px-4 border-b border-[#EEF2F6]">
                  <Link href={`/personel/${e.id}`} className="font-semibold text-brand-700">{e.name}</Link>
                  {e.status !== "active" && <span className="ml-2 text-xs text-muted">({e.status === "terminated" ? "ayrıldı" : "izinde"})</span>}
                </td>
                <td className="num py-3 px-4 border-b border-[#EEF2F6] text-muted">{e.card ?? "—"}</td>
                <td className="py-3 px-4 border-b border-[#EEF2F6]">{e.dept ?? "—"}</td>
                <td className="py-3 px-4 border-b border-[#EEF2F6]">{e.branch ?? "—"}</td>
                <td className="num py-3 px-4 border-b border-[#EEF2F6]">{e.hire}</td>
                {showBalance && <td className="num py-3 px-4 border-b border-[#EEF2F6] text-right font-semibold">{e.balance ?? "—"}</td>}
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={showBalance ? 7 : 6} className="py-10 text-center text-muted">Personel bulunamadı.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
