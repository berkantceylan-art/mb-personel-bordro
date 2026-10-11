import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Field, KPI, Money, Notice, Table, Tabs, btnPrimary, inputCls, page, selectCls, td, tdNum, textareaCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { CURRENCIES, fmt, today } from "@/lib/fin";
import { latestRates } from "@/lib/fin-data";
import { newCheque } from "@/lib/fin2-actions";
import { CHEQUE_STATUS } from "@/lib/fin2";

export const dynamic = "force-dynamic";

type C = { id: string; direction: string; doc_type: string; serial_no: string | null; bank_name: string | null; drawer: string | null; amount: number; currency: string; due_date: string; status: string; party_id: string; fin_parties: { name: string } | null; endorsed: { name: string } | null };

/** Çek / senet portföyü: alınan, verilen, vade takvimi */
export default async function ChequesPage({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const s = await getSession();
  const lvl = s.modules.finance ?? 0;
  if (lvl < 1) redirect("/");
  const { g = "portfoy" } = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: parties }, { data: banks }, { rates }] = await Promise.all([
    supabase.from("fin_cheques").select("id, direction, doc_type, serial_no, bank_name, drawer, amount, currency, due_date, status, party_id, fin_parties!fin_cheques_party_id_fkey(name), endorsed:fin_parties!fin_cheques_endorsed_party_id_fkey(name)").order("due_date").limit(3000),
    supabase.from("fin_parties").select("id, name, currency").eq("is_active", true).order("name").limit(5000),
    supabase.from("fin_accounts").select("id, name, currency, kind").in("kind", ["bank", "cash"]).eq("is_active", true).order("name"),
    latestRates(),
  ]);
  const all = (data ?? []) as unknown as C[];
  const t = today();
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const open = (c: C) => ["portfolio", "deposited", "issued"].includes(c.status);
  const rows = all.filter((c) => g === "portfoy" ? c.direction === "in" && ["portfolio", "deposited"].includes(c.status)
    : g === "verilen" ? c.direction === "out" && c.status === "issued"
    : g === "vade" ? open(c) && c.due_date <= in30
    : !open(c));
  const tl = (c: C) => Math.round(Number(c.amount) * (c.currency === "TRY" ? 1 : rates[c.currency] ?? 0));
  const sum = (f: (c: C) => boolean) => all.filter(f).reduce((x, c) => x + tl(c), 0);
  // 8 haftalık vade takvimi
  const monday = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d; })();
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const a = new Date(monday.getTime() + i * 7 * 86400000).toISOString().slice(0, 10);
    const b = new Date(monday.getTime() + (i * 7 + 6) * 86400000).toISOString().slice(0, 10);
    return { a, b, inn: sum((c) => open(c) && c.direction === "in" && c.due_date >= a && c.due_date <= b), out: sum((c) => open(c) && c.direction === "out" && c.due_date >= a && c.due_date <= b) };
  });
  const overIn = sum((c) => open(c) && c.direction === "in" && c.due_date < monday.toISOString().slice(0, 10));
  const overOut = sum((c) => open(c) && c.direction === "out" && c.due_date < monday.toISOString().slice(0, 10));
  const max = Math.max(1, ...weeks.flatMap((w) => [w.inn, w.out]));

  return (
    <>
      <PageHeader title="Çek ve senet" subtitle="Alınan çekler portföyde izlenir: tahsile ver, tahsil et, ciro et, karşılıksız. Verilen çeklerin vadesinde ödeme kaydı." />
      <div className={page}>
        {error && <Notice tone="bad">Çek tabloları yok: Supabase&apos;de 20261205000000_finance_more.sql çalıştırın.</Notice>}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KPI label="Portföyde (alınan)" value={fmt(sum((c) => c.direction === "in" && c.status === "portfolio"))} href="/finans/cek-senet?g=portfoy" />
          <KPI label="Tahsilde (bankada)" value={fmt(sum((c) => c.direction === "in" && c.status === "deposited"))} />
          <KPI label="Ödenecek (verilen)" value={fmt(sum((c) => c.direction === "out" && c.status === "issued"))} href="/finans/cek-senet?g=verilen" tone="bad" />
          <KPI label="Vadesi geçmiş" value={fmt(overIn + overOut)} sub={`alınan ${fmt(overIn)} · verilen ${fmt(overOut)}`} tone={overIn + overOut ? "bad" : undefined} href="/finans/cek-senet?g=vade" />
        </div>

        <section className="bg-white border border-line rounded-[14px] p-4">
          <h2 className="font-semibold mb-1">8 haftalık vade takvimi <span className="text-xs font-normal text-muted">(TL karşılığı · yeşil tahsil edilecek, kırmızı ödenecek)</span></h2>
          <div className="flex items-end gap-3 h-40 mt-3">
            {weeks.map((w) => (
              <div key={w.a} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${formatDate(w.a)} – ${formatDate(w.b)}: +${fmt(w.inn)} / −${fmt(w.out)}`}>
                <div className="flex items-end gap-0.5 h-28 w-full justify-center">
                  <div className="w-1/3 rounded-t bg-ok/70" style={{ height: `${Math.max(w.inn ? 4 : 0, (w.inn / max) * 112)}px` }} />
                  <div className="w-1/3 rounded-t bg-bad/70" style={{ height: `${Math.max(w.out ? 4 : 0, (w.out / max) * 112)}px` }} />
                </div>
                <span className="text-[11px] text-muted whitespace-nowrap">{formatDate(w.a).slice(0, 5)}</span>
              </div>
            ))}
          </div>
        </section>

        <Tabs active={`/finans/cek-senet?g=${g}`} items={[["/finans/cek-senet?g=portfoy", "Portföy"], ["/finans/cek-senet?g=verilen", "Verilen"], ["/finans/cek-senet?g=vade", "30 gün içinde vadeli"], ["/finans/cek-senet?g=gecmis", "Kapananlar"]]} />
        <Table head={["Vade", "Tür", "Seri / banka", "Keşideci", "Cari", "Tutar", "Durum"]} min={860}>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className={`${td} ${open(c) && c.due_date < t ? "text-bad font-semibold" : ""}`}>{formatDate(c.due_date)}</td>
              <td className={td}>{c.direction === "in" ? "Alınan" : "Verilen"} {c.doc_type === "note" ? "senet" : "çek"}</td>
              <td className={td}><Link href={`/finans/cek-senet/${c.id}`} className="font-semibold text-brand-700">{c.serial_no ?? "—"}</Link>{c.bank_name && <span className="block text-xs text-muted">{c.bank_name}</span>}</td>
              <td className={td}>{c.drawer ?? ""}</td>
              <td className={td}><Link href={`/finans/cariler/${c.party_id}`} className="hover:underline">{c.fin_parties?.name}</Link>{c.endorsed && <span className="block text-xs text-muted">ciro: {c.endorsed.name}</span>}</td>
              <td className={tdNum}><Money v={c.amount} cur={c.currency} strong /></td>
              <td className={td}><Chip tone={CHEQUE_STATUS[c.status]?.[1]}>{CHEQUE_STATUS[c.status]?.[0]}</Chip></td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow cols={7} />}
        </Table>

        {lvl >= 2 && (
          <Card title="Yeni çek / senet">
            <form action={newCheque} className="grid gap-4 md:grid-cols-4">
              <Field label="Yön">
                <select name="direction" className={selectCls}><option value="in">Alınan (müşteriden)</option><option value="out">Verilen (firmaya)</option></select>
              </Field>
              <Field label="Belge"><select name="doc_type" className={selectCls}><option value="cheque">Çek</option><option value="note">Senet</option></select></Field>
              <Field label="Cari" className="md:col-span-2">
                <select name="party_id" required className={selectCls}><option value="">Seçin</option>{(parties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>)}</select>
              </Field>
              <Field label="Tutar"><input name="amount" required inputMode="decimal" placeholder="0,00" className={inputCls} /></Field>
              <Field label="Para birimi"><select name="currency" className={selectCls}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Vade"><input type="date" name="due_date" required className={inputCls} /></Field>
              <Field label="Alış / veriliş tarihi"><input type="date" name="date" defaultValue={t} className={inputCls} /></Field>
              <Field label="Seri no"><input name="serial_no" maxLength={40} className={inputCls} /></Field>
              <Field label="Banka"><input name="bank_name" maxLength={80} className={inputCls} /></Field>
              <Field label="Şube"><input name="branch" maxLength={80} className={inputCls} /></Field>
              <Field label="Hesap no"><input name="account_no" maxLength={40} className={inputCls} /></Field>
              <Field label="Keşideci / borçlu" hint="boş = cari"><input name="drawer" maxLength={160} className={inputCls} /></Field>
              <Field label="Keşideci VKN / TCKN"><input name="drawer_tax_no" maxLength={11} inputMode="numeric" className={inputCls} /></Field>
              <Field label="Keşide tarihi"><input type="date" name="issue_date" className={inputCls} /></Field>
              <Field label="Ödeme bankası" hint="verilen çek için">
                <select name="bank_account_id" className={selectCls}><option value="">—</option>{(banks ?? []).filter((b) => b.kind === "bank").map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</select>
              </Field>
              <Field label="Not" className="md:col-span-4"><textarea name="note" rows={2} maxLength={500} className={textareaCls} /></Field>
              <div className="md:col-span-4"><PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit> <span className="text-xs text-muted ml-2">Alınan çek cari bakiyesinden düşer (hekim kartına bağlıysa hekim ekstresine “çek” tahsilatı yazılır).</span></div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
