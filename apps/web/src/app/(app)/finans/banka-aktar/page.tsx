import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { deleteBankRule, markBankLine, postBankLine, postSuggested } from "@/lib/bank-actions";
import { BankUpload } from "./BankUpload";

export const dynamic = "force-dynamic";

type L = { id: string; txn_date: string; description: string; amount: number; status: string; suggested_party_id: string | null; suggested_category_id: string | null; suggest_reason: string | null; txn_id: string | null; bank_ref: string | null };
const TABS = [["bekleyen", "Bekleyen"], ["eslesen", "Zaten kayıtlı"], ["islenen", "İşlenen"], ["yoksayilan", "Yoksayılan"]] as const;

/** Banka ekstresi içe aktarma ve eşleştirme */
export default async function BankImportPage({ searchParams }: { searchParams: Promise<{ hesap?: string; sekme?: string }> }) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: ac } = await supabase.from("fin_accounts").select("id, name, currency, kind").in("kind", ["bank", "pos", "credit_card", "cash"]).eq("is_active", true).order("kind").order("sort");
  const accounts = (ac ?? []) as { id: string; name: string; currency: string; kind: string }[];
  const account = accounts.find((a) => a.id === sp.hesap) ?? accounts.find((a) => a.kind === "bank") ?? accounts[0];
  const tab = TABS.some(([k]) => k === sp.sekme) ? sp.sekme! : "bekleyen";
  const status = { bekleyen: "new", eslesen: "matched", islenen: "posted", yoksayilan: "ignored" }[tab]!;
  const [{ data: ld, error }, { data: counts }, { data: pd }, { data: cd }, { data: rd }] = await Promise.all([
    account ? supabase.from("fin_bank_lines").select("id, txn_date, description, amount, status, suggested_party_id, suggested_category_id, suggest_reason, txn_id, bank_ref").eq("account_id", account.id).eq("status", status).order("txn_date", { ascending: tab !== "islenen" }).limit(300) : Promise.resolve({ data: [], error: null }),
    account ? supabase.from("fin_bank_lines").select("status").eq("account_id", account.id).in("status", ["new", "matched"]).limit(5000) : Promise.resolve({ data: [] }),
    supabase.from("fin_parties").select("id, name, kind, lab_customer_id").eq("is_active", true).order("name").limit(3000),
    supabase.from("fin_categories").select("id, name, kind").in("kind", ["income", "expense"]).eq("is_active", true).order("kind").order("sort"),
    supabase.from("fin_bank_rules").select("id, pattern, direction, party_id, category_id, hits").order("hits", { ascending: false }).limit(100),
  ]);
  const lines = (ld ?? []) as L[];
  const parties = (pd ?? []) as { id: string; name: string; kind: string; lab_customer_id: string | null }[];
  const cats = (cd ?? []) as { id: string; name: string; kind: string }[];
  const pname = new Map(parties.map((p) => [p.id, p.name]));
  const cname = new Map(cats.map((c) => [c.id, c.name]));
  const nNew = (counts ?? []).filter((c) => c.status === "new").length;
  const nMatched = (counts ?? []).filter((c) => c.status === "matched").length;
  const nSug = lines.filter((l) => l.suggested_party_id || l.suggested_category_id).length;
  const cur = account?.currency ?? "TRY";
  const href = (p: Record<string, string>) => `/finans/banka-aktar?${new URLSearchParams({ hesap: account?.id ?? "", sekme: tab, ...p })}`;

  return (
    <>
      <PageHeader title="Banka ekstresi aktarımı" subtitle="İnternet bankacılığından indirilen ekstreyi yükleyin: kayıtlı olanlar eşleşir, kalanlar için cari / kategori önerilir, tek tıkla işlenir" actions={<Link href="/finans/banka" className="text-sm font-semibold text-brand-700">Banka hesapları</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261225000000_bank_recon.sql çalıştırılmalı.</Notice>}
        {accounts.length === 0 ? <Notice tone="warn">Önce Finans &gt; Banka&apos;dan bir banka hesabı açın.</Notice> : (
          <Card title="Ekstre yükle"><BankUpload accounts={accounts} defaultAccount={account?.id ?? null} /></Card>
        )}
        {account && (
          <Card
            title={`${account.name} hareketleri`}
            action={<span className="flex flex-wrap gap-1">{accounts.length > 1 && accounts.map((a) => <Link key={a.id} href={`/finans/banka-aktar?hesap=${a.id}`} className={`h-8 px-3 inline-flex items-center rounded-[8px] text-xs font-semibold ${a.id === account.id ? "bg-brand-700 text-white" : "border border-line"}`}>{a.name}</Link>)}</span>}
          >
            <div className="flex flex-wrap gap-1 items-center">
              {TABS.map(([k, l]) => <Link key={k} href={href({ sekme: k })} className={`h-9 px-3 inline-flex items-center rounded-[10px] text-sm font-semibold ${k === tab ? "bg-ink text-white" : "border border-line"}`}>{l}{k === "bekleyen" && nNew ? ` (${nNew})` : k === "eslesen" && nMatched ? ` (${nMatched})` : ""}</Link>)}
              {tab === "bekleyen" && nSug > 0 && (
                <form action={postSuggested} className="ml-auto"><input type="hidden" name="account" value={account.id} /><PendingSubmit className="h-9 px-3 rounded-[10px] bg-ok text-white text-sm font-semibold">Önerilenlerin hepsini işle ({nSug})</PendingSubmit></form>
              )}
            </div>
            <ul className="divide-y divide-[#EEF2F6]">
              {lines.map((l) => {
                const def = l.suggested_party_id ? `p:${l.suggested_party_id}` : l.suggested_category_id ? `c:${l.suggested_category_id}` : "";
                const isLab = l.suggested_party_id && parties.find((p) => p.id === l.suggested_party_id)?.lab_customer_id;
                return (
                  <li key={l.id} className="py-2.5 flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                    <div className="md:w-[42%] min-w-0">
                      <div className="flex gap-2 items-baseline"><span className="text-xs text-muted whitespace-nowrap">{formatDate(l.txn_date)}</span><b className={`num whitespace-nowrap ${l.amount < 0 ? "text-bad" : "text-ok"}`}>{fmt(l.amount, cur, { sign: true })}</b></div>
                      <div className="text-sm break-words">{l.description || "—"}</div>
                      {l.suggest_reason && <div className="text-[11px] text-brand-700">{l.suggest_reason}{l.suggested_party_id ? `: ${pname.get(l.suggested_party_id)}` : l.suggested_category_id ? `: ${cname.get(l.suggested_category_id)}` : ""}</div>}
                    </div>
                    {tab === "bekleyen" && (
                      <form action={postBankLine} className="flex flex-wrap gap-2 items-center flex-1">
                        <input type="hidden" name="id" value={l.id} />
                        <select name="target" defaultValue={def} required className="h-9 rounded-[8px] border border-line bg-white px-2 text-sm max-w-[260px]">
                          <option value="">Cari ya da kategori seçin…</option>
                          <optgroup label="Cariler">{parties.filter((p) => (l.amount > 0 ? p.kind !== "supplier" : p.kind !== "customer") || p.id === l.suggested_party_id).map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>
                          <optgroup label={l.amount > 0 ? "Gelir" : "Gider"}>{cats.filter((c) => c.kind === (l.amount > 0 ? "income" : "expense")).map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>
                        </select>
                        {l.amount > 0 && isLab && <select name="book" defaultValue="" className="h-9 rounded-[8px] border border-line bg-white px-2 text-xs" title="Hekim tahsilatı hangi cariye"><option value="">Defter: kart ayarı</option><option value="official">Yalnız resmi</option><option value="both">Resmi + iç</option></select>}
                        <input name="rule" maxLength={80} placeholder="Kural: açıklamada geçen kelime (isteğe bağlı)" className="h-9 rounded-[8px] border border-line px-2 text-xs w-56" />
                        <PendingSubmit className="h-9 px-3 rounded-[8px] bg-brand-700 text-white text-sm font-semibold">İşle</PendingSubmit>
                      </form>
                    )}
                    {tab === "eslesen" && (
                      <div className="flex gap-2 items-center flex-1 text-sm">
                        <span className="text-muted">Finans kaydıyla eşleşti</span>
                        <form action={markBankLine}><input type="hidden" name="id" value={l.id} /><PendingSubmit name="action" value="confirm" className="h-9 px-3 rounded-[8px] bg-ok text-white text-sm font-semibold">Doğru</PendingSubmit></form>
                        <form action={markBankLine}><input type="hidden" name="id" value={l.id} /><PendingSubmit name="action" value="reopen" className="h-9 px-3 rounded-[8px] border border-line text-sm font-semibold">Farklı işlem</PendingSubmit></form>
                      </div>
                    )}
                    {tab === "islenen" && <span className="flex-1 text-xs text-muted">İşlendi</span>}
                    {(tab === "bekleyen" || tab === "eslesen") && <form action={markBankLine}><input type="hidden" name="id" value={l.id} /><PendingSubmit name="action" value="ignore" className="text-xs text-muted font-semibold">Yoksay</PendingSubmit></form>}
                    {tab === "yoksayilan" && <form action={markBankLine}><input type="hidden" name="id" value={l.id} /><PendingSubmit name="action" value="reopen" className="text-xs text-brand-700 font-semibold">Geri al</PendingSubmit></form>}
                  </li>
                );
              })}
              {lines.length === 0 && <li className="py-6 text-center text-sm text-muted">{tab === "bekleyen" ? "Bekleyen hareket yok." : "Kayıt yok."}</li>}
            </ul>
          </Card>
        )}
        {(rd ?? []).length > 0 && (
          <Card title="Eşleştirme kuralları">
            <ul className="divide-y divide-[#EEF2F6] text-sm">
              {(rd ?? []).map((r) => (
                <li key={r.id} className="py-1.5 flex items-center gap-3">
                  <span className="font-mono text-xs bg-[#F1F5F9] px-2 py-0.5 rounded">{r.pattern}</span>
                  <span className="text-xs text-muted">{r.direction === "in" ? "giriş" : r.direction === "out" ? "çıkış" : "her yön"}</span>
                  <span className="flex-1">→ {r.party_id ? pname.get(r.party_id) : cname.get(r.category_id!)}</span>
                  <span className="text-xs text-muted">{r.hits} kez</span>
                  <form action={deleteBankRule}><input type="hidden" name="id" value={r.id} /><PendingSubmit className="text-xs text-bad font-semibold">Sil</PendingSubmit></form>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
