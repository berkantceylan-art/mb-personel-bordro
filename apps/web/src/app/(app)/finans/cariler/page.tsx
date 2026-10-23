import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, EmptyRow, KPI, Money, Notice, Table, Tabs, btnPrimary, inputCls, page, td, tdNum } from "@/components/erp";
import { getSession } from "@/lib/session";
import { latestRates, loadParties } from "@/lib/fin-data";
import { PARTY_KIND, fmt } from "@/lib/fin";
import { PartyForm } from "../_parts/PartyForm";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { deleteParty } from "@/lib/fin-actions";
import { CariSearch, type CariHit } from "./CariSearch";
import { AccountFilter } from "@/components/AccountFilter";
import { parseFilter, passes } from "@/lib/account-filter";

export const dynamic = "force-dynamic";

/** Cari kartlar: tedarikçiler, müşteriler (hekim kartları dahil) */
export default async function PartiesPage({ searchParams }: { searchParams: Promise<{ tur?: string; q?: string; bakiye?: string; yeni?: string; pasif?: string; g?: string }> }) {
  const s = await getSession();
  if (!["finance", "sales", "purchases"].some((m) => (s.modules[m] ?? 0) >= 1)) redirect("/");
  const sp = await searchParams;
  const [{ rows, error }, { rates }] = await Promise.all([loadParties(), latestRates()]);
  const tur = ["customer", "supplier", "lab", "other"].includes(sp.tur ?? "") ? sp.tur! : "";
  const q = (sp.q ?? "").toLocaleLowerCase("tr");
  const flt = parseFilter(sp.g, { bakiye: sp.bakiye, pasif: sp.pasif });
  const pasif = flt.has("pasif");
  const ofTur = (p: (typeof rows)[number]) => !(tur === "lab" ? !p.lab_customer_id : tur === "customer" ? !(p.kind === "customer" || p.kind === "both") : tur === "supplier" ? !(p.kind === "supplier" || p.kind === "both") : tur === "other" ? p.kind !== "other" : false);
  const inTur = rows.filter(ofTur);
  const counts = {
    aktif: inTur.filter((p) => p.is_active).length, pasif: inTur.filter((p) => !p.is_active).length,
    borclu: inTur.filter((p) => p.balance > 0).length, alacakli: inTur.filter((p) => p.balance < 0).length, kapali: inTur.filter((p) => p.balance === 0).length,
  };
  const shown = inTur.filter((p) => {
    if (!passes(flt, p.is_active, [p.balance])) return false;
    return !q || `${p.name} ${p.tax_no ?? ""} ${p.phone ?? ""} ${p.city ?? ""} ${p.code ?? ""}`.toLocaleLowerCase("tr").includes(q);
  });
  const toTry = (v: number, c: string) => v * (rates[c] ?? 1);
  const receivable = rows.filter((p) => p.balance > 0).reduce((a, p) => a + toTry(p.balance, p.currency), 0);
  const payable = rows.filter((p) => p.balance < 0).reduce((a, p) => a + toTry(-p.balance, p.currency), 0);
  const canEdit = ["finance", "sales", "purchases"].some((m) => (s.modules[m] ?? 0) >= 2);
  const qs = (t: string) => { const u = new URLSearchParams(); if (t) u.set("tur", t); if (sp.g) u.set("g", sp.g); return `/finans/cariler${u.toString() ? `?${u}` : ""}`; };
  const hits: CariHit[] = rows.map((p) => ({ id: p.id, name: p.name, tax_no: p.tax_no, phone: p.phone, city: p.city, code: p.code, kind: PARTY_KIND[p.kind] ?? p.kind, active: p.is_active }));
  return (
    <>
      <PageHeader title="Cari kartlar" subtitle={`${rows.length} cari · tedarikçiler, müşteriler ve hekimler`} actions={canEdit ? <span className="flex gap-4"><Link href="/finans/cariler/bizimhesap" className="text-sm font-semibold text-brand-700">⇪ Bizim Hesap carileri</Link><Link href="/finans/cariler?yeni=1#yeni" className="text-sm font-semibold text-brand-700">+ Yeni cari</Link></span> : undefined} />
      <div className={page}>
        {error && <Notice tone="bad">Finans tabloları yok: Supabase&apos;de 20261202000000_finance_core.sql çalıştırın.</Notice>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI label="Toplam alacak" value={fmt(Math.round(receivable))} sub="TL karşılığı" href="/finans/cariler?g=aktif,borclu" />
          <KPI label="Toplam borç" value={fmt(Math.round(payable))} sub="TL karşılığı" tone="bad" href="/finans/cariler?g=aktif,alacakli" />
          <KPI label="Tedarikçi" value={rows.filter((p) => p.kind === "supplier" || p.kind === "both").length} href="/finans/cariler?tur=supplier" />
          <KPI label="Müşteri / hekim" value={rows.filter((p) => p.kind === "customer" || p.kind === "both").length} href="/finans/cariler?tur=customer" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs active={qs(tur)} items={[[qs(""), "Tümü"], [qs("supplier"), "Tedarikçiler"], [qs("customer"), "Müşteriler"], [qs("lab"), "Hekim kartları"], [qs("other"), "Diğer"]]} />
          <div className="flex flex-wrap items-center gap-3">
            <CariSearch items={hits} tur={tur} q={sp.q ?? ""} pasif={pasif} g={sp.g} inputCls={inputCls} btnCls={btnPrimary} />
          </div>
        </div>
        <div className="rounded-[12px] border border-line bg-white px-4 py-3 flex flex-wrap items-center gap-3"><b className="text-sm">Göster:</b><AccountFilter counts={counts} /><span className="ml-auto text-xs text-muted">{shown.length} cari listeleniyor</span></div>
        <Table head={canEdit ? ["Cari", "Tür", "VKN / TCKN", "Telefon", "Para", "Bakiye", "Durum", ""] : ["Cari", "Tür", "VKN / TCKN", "Telefon", "Para", "Bakiye", "Durum"]} min={980}>
          {shown.map((p) => (
            <tr key={p.id} className={p.is_active ? "" : "opacity-60"}>
              <td className={td}><Link href={`/finans/cariler/${p.id}`} className="font-semibold text-brand-700">{p.name}</Link>{p.city && <span className="block text-xs text-muted">{p.city}</span>}</td>
              <td className={td}>{PARTY_KIND[p.kind]}{p.lab_customer_id && <span className="ml-1.5"><Chip tone="blue">hekim</Chip></span>}{p.slip_of && <span className="ml-1.5"><Chip tone="amber">fişli</Chip></span>}{p.source === "einvoice" && <span className="ml-1.5"><Chip tone="green">e-fatura</Chip></span>}</td>
              <td className={`${td} num`}>{p.tax_no ?? "—"}</td>
              <td className={td}>{p.phone ?? "—"}</td>
              <td className={td}>{p.currency}</td>
              <td className={tdNum}><Money v={p.balance} cur={p.currency} strong /></td>
              <td className={td}>{p.balance > 0 ? <Chip tone="amber">alacak</Chip> : p.balance < 0 ? <Chip tone="red">borç</Chip> : <Chip>kapalı</Chip>}{!p.is_active && <span className="ml-1.5"><Chip>pasif</Chip></span>}</td>
              {canEdit && (
                <td className={`${td} whitespace-nowrap`}>
                  <span className="flex items-center gap-3">
                    <Link href={`/finans/cariler/${p.id}#gonder`} className="text-xs font-semibold text-brand-700" title="Ekstreyi e-posta / WhatsApp ile gönder">✉ Gönder</Link>
                    <Link href={`/finans/cariler/${p.id}#duzenle`} className="text-xs font-semibold text-brand-700">✎ Düzenle</Link>
                    {!p.lab_customer_id && <form action={deleteParty}><input type="hidden" name="id" value={p.id} /><ConfirmSubmit label="Sil" question="Silinsin mi?" /></form>}
                  </span>
                </td>
              )}
            </tr>
          ))}
          {shown.length === 0 && <EmptyRow cols={canEdit ? 8 : 7} />}
        </Table>
        {canEdit && (
          <div id="yeni"><Card title="Yeni cari kart"><PartyForm defaultKind={tur === "customer" ? "customer" : "supplier"} /></Card></div>
        )}
      </div>
    </>
  );
}
