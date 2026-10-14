"use client";
import { useMemo, useState } from "react";
import { postTxn } from "@/lib/fin-actions";
import { ACCOUNT_KIND, CUR_SYMBOL, fmt, parseAmount, parseRate } from "@/lib/fin";
import { Field, btnPrimary, inputCls, selectCls, textareaCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";

type Acc = { id: string; name: string; kind: string; currency: string; balance: number };
type Party = { id: string; name: string; currency: string; kind: string; balance: number ; internalBook?: boolean; payBook?: string; twin?: string };
type Cat = { id: string; name: string; kind: string };

const KINDS: [string, string, string][] = [
  ["collection", "Tahsilat", "Cariden kasaya / bankaya para girişi"],
  ["payment", "Ödeme", "Kasadan / bankadan cariye ödeme"],
  ["transfer", "Virman", "Hesaplar arası (döviz alım-satım dahil)"],
  ["expense", "Masraf", "Gider: kira, elektrik, yakıt…"],
  ["income", "Gelir", "Cari dışı gelir: faiz, kira geliri…"],
];

export function TxnForm({ accounts, parties, categories, rates, initial, back, today }: {
  accounts: Acc[]; parties: Party[]; categories: Cat[]; rates: Record<string, number>; today: string; back?: string;
  initial: { kind?: string; party?: string; account?: string; category?: string };
}) {
  const [kind, setKind] = useState(KINDS.some(([k]) => k === initial.kind) ? initial.kind! : "collection");
  const [accountId, setAccountId] = useState(initial.account ?? "");
  const [toId, setToId] = useState("");
  const [partyId, setPartyId] = useState(initial.party ?? "");
  const [partyFilter, setPartyFilter] = useState("");
  const [amount, setAmount] = useState("");
  const [partyAmount, setPartyAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [rate, setRate] = useState("");
  const [counter, setCounter] = useState<"account" | "party">("account");
  const [vat, setVat] = useState("20");

  const acc = accounts.find((a) => a.id === accountId);
  const to = accounts.find((a) => a.id === toId);
  const party = parties.find((p) => p.id === partyId);
  const moneyAccounts = accounts.filter((a) => ["cash", "bank", "pos", "credit_card", "advance", "partner"].includes(a.kind));
  const forKind = kind === "collection" ? moneyAccounts.filter((a) => a.kind !== "credit_card") : moneyAccounts;
  const shownParties = useMemo(() => {
    const q = partyFilter.toLocaleLowerCase("tr");
    return parties.filter((p) => !q || p.name.toLocaleLowerCase("tr").includes(q)).slice(0, 300);
  }, [parties, partyFilter]);
  const amt = parseAmount(amount) ?? 0;
  const autoRate = acc && acc.currency !== "TRY" ? rates[acc.currency] : undefined;
  const crossParty = (kind === "collection" || kind === "payment") && acc && party && acc.currency !== party.currency;
  const crossTransfer = kind === "transfer" && acc && to && acc.currency !== to.currency;
  // farklı para biriminde karşı tutar önerisi
  const suggest = (fromCur: string, toCur: string) => {
    const r1 = fromCur === "TRY" ? 1 : parseRate(rate) ?? rates[fromCur];
    const r2 = toCur === "TRY" ? 1 : rates[toCur];
    if (!amt || !r1 || !r2) return "";
    return ((amt * r1) / r2 / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const cats = categories.filter((c) => c.kind === (kind === "income" ? "income" : "expense"));

  return (
    <form action={postTxn} className="flex flex-col gap-5">
      <input type="hidden" name="kind" value={kind} />
      {back && <input type="hidden" name="back" value={back} />}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" role="tablist" aria-label="İşlem türü">
        {KINDS.map(([k, label, sub]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
            className={`rounded-[12px] border px-3 py-2.5 text-left ${kind === k ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white hover:border-brand-600"}`}>
            <span className="block font-semibold">{label}</span>
            <span className={`block text-[11px] leading-snug ${kind === k ? "text-white/80" : "text-muted"}`}>{sub}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(kind === "collection" || kind === "payment") && (
          <>
            <Field label="Cari">
              <input placeholder="Cari ara…" value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)} className={inputCls} />
              <select name="party_id" required value={partyId} onChange={(e) => setPartyId(e.target.value)} className={selectCls} size={6}>
                {shownParties.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.currency} · bakiye {fmt(p.balance, p.currency)}</option>)}
              </select>
            </Field>
            <Field label={kind === "collection" ? "Giren hesap" : "Çıkan hesap"}>
              <select name="account_id" required value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectCls}>
                <option value="">Seçin</option>
                {forKind.map((a) => <option key={a.id} value={a.id}>{ACCOUNT_KIND[a.kind]?.label} · {a.name} ({a.currency}) · {fmt(a.balance, a.currency)}</option>)}
              </select>
              {party?.twin && (kind === "payment" || kind === "collection") && <span className="text-xs font-semibold text-[#B45309]">↔ Aynı tutar “{party.twin}” carisine de işlenir (fişli / faturalı cari).</span>}
              {party && <span className="text-xs font-normal text-muted">Cari bakiyesi: {fmt(party.balance, party.currency)} {party.balance > 0 ? "(bize borçlu)" : party.balance < 0 ? "(biz borçluyuz)" : ""}</span>}
            </Field>
          </>
        )}

        {kind === "transfer" && (
          <>
            <Field label="Çıkan hesap">
              <select name="account_id" required value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectCls}>
                <option value="">Seçin</option>
                {moneyAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency}) · {fmt(a.balance, a.currency)}</option>)}
              </select>
            </Field>
            <Field label="Giren hesap">
              <select name="to_account_id" required value={toId} onChange={(e) => setToId(e.target.value)} className={selectCls}>
                <option value="">Seçin</option>
                {accounts.filter((a) => a.id !== accountId && ["cash", "bank", "pos", "credit_card", "loan", "advance", "partner"].includes(a.kind)).map((a) => <option key={a.id} value={a.id}>{ACCOUNT_KIND[a.kind]?.label} · {a.name} ({a.currency})</option>)}
              </select>
            </Field>
          </>
        )}

        {(kind === "income" || kind === "expense") && (
          <>
            <Field label={kind === "expense" ? "Gider hesabı" : "Gelir hesabı"}>
              <select name="category_id" required defaultValue={initial.category ?? ""} className={selectCls}>
                <option value="">Seçin</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label={kind === "expense" ? "Nasıl ödendi?" : "Nereye girdi?"}>
              <div className="flex gap-2 text-sm font-normal">
                <label className="flex items-center gap-1.5"><input type="radio" checked={counter === "account"} onChange={() => setCounter("account")} /> Kasa / banka / kart</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={counter === "party"} onChange={() => setCounter("party")} /> {kind === "expense" ? "Veresiye (cariye borç)" : "Cariye alacak"}</label>
              </div>
              {counter === "account" ? (
                <select name="account_id" required value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectCls}>
                  <option value="">Seçin</option>
                  {moneyAccounts.map((a) => <option key={a.id} value={a.id}>{ACCOUNT_KIND[a.kind]?.label} · {a.name} ({a.currency})</option>)}
                </select>
              ) : (
                <select name="party_id" required value={partyId} onChange={(e) => setPartyId(e.target.value)} className={selectCls}>
                  <option value="">Cari seçin</option>
                  {parties.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>)}
                </select>
              )}
            </Field>
          </>
        )}

        <Field label="Tutar" hint={acc ? `${acc.currency}${kind === "expense" || kind === "income" ? ", KDV dahil" : ""}` : undefined}>
          <div className="relative">
            <input name="amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" className={`${inputCls} pr-12 text-lg font-semibold`} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">{CUR_SYMBOL[acc?.currency ?? party?.currency ?? "TRY"]}</span>
          </div>
          {amt > 0 && <span className="text-xs font-normal text-muted">= {fmt(amt, acc?.currency ?? party?.currency ?? "TRY")}</span>}
        </Field>

        {(kind === "income" || kind === "expense") && (
          <Field label="KDV oranı" hint="tutarın içinden ayrılır">
            <select name="vat_rate" value={vat} onChange={(e) => setVat(e.target.value)} className={selectCls}>
              {["0", "1", "10", "20"].map((v) => <option key={v} value={v}>%{v}</option>)}
            </select>
            {amt > 0 && Number(vat) > 0 && <span className="text-xs font-normal text-muted">KDV: {fmt(Math.round((amt * Number(vat)) / (100 + Number(vat))), acc?.currency ?? "TRY")}</span>}
          </Field>
        )}

        {(autoRate || crossParty || crossTransfer) && (
          <Field label={`Kur (1 ${acc?.currency} = ? ₺)`} hint={autoRate ? `son kur ${autoRate.toLocaleString("tr-TR")}` : undefined}>
            <input name="rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={autoRate ? String(autoRate).replace(".", ",") : ""} className={inputCls} />
          </Field>
        )}
        {kind === "collection" && party?.internalBook && (
          <Field label="Hangi cariye işlensin?" hint="Bu müşteri iç hesap kullanıyor">
            <select name="book" defaultValue={party.payBook === "official" ? "official" : "both"} key={party.id} className={selectCls}>
              <option value="both">Resmi + iç cari (ikisine)</option>
              <option value="official">Yalnız resmi cari</option>
            </select>
          </Field>
        )}
        {crossParty && (
          <Field label={`Cari hesabına işlenecek tutar (${party!.currency})`} hint="boş bırakılırsa güncel kurla hesaplanır">
            <input name="party_amount" inputMode="decimal" value={partyAmount} onChange={(e) => setPartyAmount(e.target.value)} placeholder={suggest(acc!.currency, party!.currency)} className={inputCls} />
          </Field>
        )}
        {crossTransfer && (
          <Field label={`Giren hesaba geçen tutar (${to!.currency})`}>
            <input name="to_amount" required inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} placeholder={suggest(acc!.currency, to!.currency)} className={inputCls} />
          </Field>
        )}
        {kind === "transfer" && (
          <Field label="Banka masrafı / komisyon" hint="isteğe bağlı, çıkan hesaptan">
            <input name="fee" inputMode="decimal" placeholder="0,00" className={inputCls} />
          </Field>
        )}

        <Field label="Tarih"><input type="date" name="date" defaultValue={today} className={inputCls} /></Field>
        <Field label="Belge no" hint="makbuz, dekont, fatura"><input name="doc_no" maxLength={60} className={inputCls} /></Field>
        <Field label="Açıklama" className="md:col-span-2"><textarea name="description" rows={2} maxLength={500} className={textareaCls} /></Field>
      </div>
      <div className="flex items-center gap-3">
        <PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit>
        <span className="text-xs text-muted">Kayıt çift taraflı tutulur; yanlış kayıt İşlem defterinden iptal edilir.</span>
      </div>
    </form>
  );
}
