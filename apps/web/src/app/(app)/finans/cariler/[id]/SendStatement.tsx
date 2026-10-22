"use client";
import { useState } from "react";
import Link from "next/link";
import { sendPartyStatementMail } from "@/lib/party-send-actions";

/** Cari ekstresini e-posta (bağlı Gmail hesabından) veya WhatsApp ile gönderme */
export function SendStatement({ partyId, email, waHref, accounts, from, to }: {
  partyId: string; email: string | null; waHref: string | null; accounts: { id: string; email: string }[]; from: string | null; to: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const input = "h-10 rounded-lg border border-[#D5DEE8] px-3 bg-white text-sm";
  async function submit(f: FormData) {
    setBusy(true); setMsg(null);
    const r = await sendPartyStatementMail(f);
    setMsg({ ok: r.ok, text: r.message });
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Dönem: {from ?? "başlangıç"} – {to ?? "bugün"} (yukarıdaki tarih filtresiyle değişir).</p>
      <div className="flex flex-wrap items-center gap-3">
        {waHref
          ? <a href={waHref} target="_blank" rel="noreferrer" className="h-10 px-4 inline-flex items-center rounded-lg border border-ok text-ok font-semibold bg-white">WhatsApp ile gönder</a>
          : <span className="text-sm text-muted">WhatsApp için carinin telefonu yok.</span>}
        <span className="text-xs text-muted">Bakiye ve son hareketlerin özeti mesaj olarak hazırlanır; PDF eklemek için “Cari yazdır” → “PDF olarak kaydet”.</span>
      </div>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted">E-posta göndermek için önce <Link href="/posta" className="text-brand-700 font-semibold underline">Posta</Link> ekranından Gmail hesabınızı bağlayın.</p>
      ) : (
        <form action={submit} className="flex flex-col gap-3">
          <input type="hidden" name="party" value={partyId} />
          {from && <input type="hidden" name="bas" value={from} />}
          {to && <input type="hidden" name="bit" value={to} />}
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">Gönderen
              <select name="account" defaultValue={accounts[0]!.id} className={input}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted flex-1 min-w-[260px]">Alıcı (virgülle birden fazla)
              <input name="to" type="text" defaultValue={email ?? ""} placeholder="ornek@firma.com" className={input} required />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">Mesaj (isteğe bağlı)
            <textarea name="note" rows={3} placeholder="Boş bırakılırsa standart metin gider." className="rounded-lg border border-[#D5DEE8] px-3 py-2 bg-white text-sm" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={busy} className="h-10 px-5 rounded-lg bg-brand-700 text-white font-semibold disabled:opacity-50">{busy ? "Gönderiliyor…" : "✉ E-postayla gönder"}</button>
            {msg && <span className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
