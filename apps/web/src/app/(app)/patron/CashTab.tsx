import Link from "next/link";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/jobs";
import { ACCOUNT_KIND, TXN_KIND } from "@/lib/fin";

type SB = Awaited<ReturnType<typeof createClient>>;
type Acc = { id: string; kind: string; name: string; currency: string; bank: string | null; opening: number; in: number; out: number; closing: number; closing_try: number; moves: number };
type Move = { date: string; amount: number; amount_try: number; currency: string; account: string; account_kind: string; txn_id: string; no: number; kind: string; description: string | null; party: string | null; category: string | null };
type Cash = {
  from: string; to: string; accounts: Acc[]; moves: Move[]; moves_total: number;
  by_kind: Array<{ kind: string; in: number; out: number; n: number }>;
  by_party: Array<{ party: string; in: number; out: number }>;
  daily: Array<{ date: string; in: number; out: number }>;
  upcoming: Array<{ date: string; type: string; label: string; amount: number; currency: string; dir: number }>;
};

const TL = (v: number) => money(v, "TRY");
const d = (s: string) => s.slice(0, 10).split("-").reverse().join(".");
const iso = (x: Date) => x.toISOString().slice(0, 10);
const addD = (s: string, n: number) => iso(new Date(Date.parse(`${s}T12:00:00Z`) + n * 86400000));
const LIQUID = ["cash", "bank", "pos"];
const GROUPS: Array<[string, string[]]> = [["Kasalar", ["cash"]], ["Bankalar", ["bank"]], ["POS / sanal POS", ["pos"]], ["Kredi kartları", ["credit_card"]], ["Krediler", ["loan"]], ["Çek / senet", ["cheque_in", "cheque_out"]], ["Ortak / avans hesapları", ["partner", "advance"]]];

export function cashRange(today: string, aralik?: string, gun?: string): { from: string; to: string; key: string } {
  const base = gun && /^\d{4}-\d{2}-\d{2}$/.test(gun) ? gun : today;
  if (aralik === "dun") return { from: addD(today, -1), to: addD(today, -1), key: "dun" };
  if (aralik === "hafta") {
    const dow = (new Date(`${base}T12:00:00Z`).getUTCDay() + 6) % 7;
    return { from: addD(base, -dow), to: base, key: "hafta" };
  }
  if (aralik === "ay") return { from: `${base.slice(0, 8)}01`, to: base, key: "ay" };
  return { from: base, to: base, key: gun && gun !== today ? "gun" : "bugun" };
}

/** Patron ekranı · Nakit: günün özeti, kasa / banka kalanları, hareketler, beklenen ödemeler */
export async function CashTab({ sb, today, aralik, gun }: { sb: SB; today: string; aralik?: string; gun?: string }) {
  const r = cashRange(today, aralik, gun);
  const { data, error } = await sb.rpc("boss_cash", { p_from: r.from, p_to: r.to });
  if (error) {
    return <p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">{/boss_cash|does not exist/.test(error.message) ? "Supabase'de 20270123000000_boss_cash.sql çalıştırılmalı." : /not_allowed/.test(error.message) ? "Bu ekran için yetkiniz yok." : error.message}</p>;
  }
  const c = data as Cash;
  const liquid = c.accounts.filter((a) => LIQUID.includes(a.kind));
  const sumBy = (kinds: string[]) => c.accounts.filter((a) => kinds.includes(a.kind)).reduce((x, a) => x + a.closing_try, 0);
  const cash = sumBy(["cash"]);
  const bank = sumBy(["bank"]);
  const pos = sumBy(["pos"]);
  const total = cash + bank + pos;
  const inflow = c.by_kind.reduce((x, k) => x + k.in, 0);
  const outflow = c.by_kind.reduce((x, k) => x + k.out, 0);
  const net = inflow - outflow;
  const opening = liquid.reduce((x, a) => x + Math.round(a.opening * (a.closing ? a.closing_try / a.closing : 1)), 0);
  const cards = -sumBy(["credit_card"]);
  const loans = -sumBy(["loan"]);
  const chequesIn = sumBy(["cheque_in"]);
  const upIn = c.upcoming.filter((u) => u.dir > 0).reduce((x, u) => x + u.amount, 0);
  const upOut = c.upcoming.filter((u) => u.dir < 0).reduce((x, u) => x + u.amount, 0);
  const maxDay = Math.max(1, ...c.daily.map((x) => Math.max(x.in, x.out)));
  const label = r.from === r.to ? (r.to === today ? "Bugün" : d(r.to)) : `${d(r.from)} – ${d(r.to)}`;
  const tab = (key: string, text: string, extra = "") => (
    <Link href={`/patron?sekme=nakit&aralik=${key}${extra}`} className={`h-10 px-4 rounded-full grid place-items-center text-sm font-semibold ${r.key === key ? "bg-brand-800 text-white" : "bg-white border border-line text-brand-700"}`}>{text}</Link>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {tab("bugun", "Bugün")}
        {tab("dun", "Dün")}
        {tab("hafta", "Bu hafta")}
        {tab("ay", "Bu ay")}
        <form action="/patron" className="flex items-center gap-2 ml-auto">
          <input type="hidden" name="sekme" value="nakit" />
          <input type="date" name="gun" defaultValue={r.to} max={today} aria-label="Gün seç" className="h-10 rounded-lg border border-[#D5DEE8] bg-white px-2 text-sm" />
          <select name="aralik" defaultValue={r.key === "hafta" || r.key === "ay" ? r.key : "gun"} aria-label="Aralık" className="h-10 rounded-lg border border-[#D5DEE8] bg-white px-2 text-sm">
            <option value="gun">O gün</option><option value="hafta">O hafta</option><option value="ay">O ay</option>
          </select>
          <button className="h-10 px-3 rounded-lg bg-brand-700 text-white text-sm font-semibold">Göster</button>
        </form>
      </div>

      <section className="rounded-[16px] bg-brand-800 text-white p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/60">Kasa + banka + POS · {d(r.to)} sonu</p>
            <p className="font-display text-3xl md:text-4xl font-bold num">{TL(total)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-white/60">{label} net akış</p>
            <p className={`font-display text-2xl font-bold num ${net >= 0 ? "text-[#7BE0AE]" : "text-[#FFB4A8]"}`}>{net >= 0 ? "+" : "−"}{TL(Math.abs(net))}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          {([["Kasalarda", cash], ["Bankalarda", bank], ["Giren", inflow], ["Çıkan", outflow]] as const).map(([l, v]) => (
            <div key={l} className="rounded-xl bg-white/10 px-3 py-2"><span className="block text-white/60 text-xs">{l}</span><b className="num">{TL(v)}</b></div>
          ))}
        </div>
        <p className="text-xs text-white/60">Dönem başı likit {TL(opening)}{pos ? ` · POS'ta bekleyen ${TL(pos)}` : ""}{chequesIn ? ` · portföydeki çekler ${TL(chequesIn)}` : ""}{cards ? ` · kart borcu ${TL(cards)}` : ""}{loans ? ` · kredi borcu ${TL(loans)}` : ""}. Virmanlar (hesaplar arası aktarım) giriş / çıkışa sayılmaz.</p>
      </section>

      <Card title="Hesaplar: açılış → giren / çıkan → kalan" action={<Link href="/finans" className="text-sm font-semibold text-brand-700">Finans →</Link>}>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[620px]">
            <thead><tr className="text-left text-xs text-muted"><th className="py-2 px-1">Hesap</th><th className="py-2 px-1 text-right">Açılış</th><th className="py-2 px-1 text-right">Giren</th><th className="py-2 px-1 text-right">Çıkan</th><th className="py-2 px-1 text-right">Kalan</th></tr></thead>
            <tbody>
              {GROUPS.map(([g, kinds]) => {
                const rows = c.accounts.filter((a) => kinds.includes(a.kind));
                if (!rows.length) return null;
                const gt = rows.reduce((x, a) => x + a.closing_try, 0);
                return [
                  <tr key={g} className="bg-[#F5F7FA]"><td colSpan={4} className="py-1.5 px-1 text-xs font-bold text-brand-800">{g}</td><td className="py-1.5 px-1 text-right text-xs font-bold num">{TL(gt)}</td></tr>,
                  ...rows.map((a) => (
                    <tr key={a.id} className="border-t border-[#EEF2F6]">
                      <td className="py-2 px-1"><Link href={`/finans/hesap/${a.id}`} className="font-semibold text-brand-700">{a.name}</Link>{a.bank ? <span className="block text-xs text-muted">{a.bank}</span> : null}</td>
                      <td className="py-2 px-1 text-right num text-muted">{money(a.opening, a.currency)}</td>
                      <td className="py-2 px-1 text-right num text-ok">{a.in ? `+${money(a.in, a.currency)}` : "—"}</td>
                      <td className="py-2 px-1 text-right num text-bad">{a.out ? `−${money(a.out, a.currency)}` : "—"}</td>
                      <td className={`py-2 px-1 text-right num font-bold ${a.closing < 0 && !ACCOUNT_KIND[a.kind]?.liability ? "text-bad" : ""}`}>{money(a.closing, a.currency)}{a.currency !== "TRY" && <span className="block text-[11px] font-normal text-muted">≈ {TL(a.closing_try)}</span>}</td>
                    </tr>
                  )),
                ];
              })}
              {!c.accounts.length && <tr><td colSpan={5} className="py-6 text-center text-muted">Henüz kasa / banka hesabı tanımlı değil (Finans › Hesaplar).</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`${label}: nereden geldi, nereye gitti`}>
          {c.by_kind.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {c.by_kind.map((k) => (
                <li key={k.kind} className="flex items-center gap-2">
                  <span className="flex-1">{TXN_KIND[k.kind] ?? k.kind} <span className="text-xs text-muted">· {k.n}</span></span>
                  {k.in > 0 && <span className="num text-ok font-semibold">+{TL(k.in)}</span>}
                  {k.out > 0 && <span className="num text-bad font-semibold">−{TL(k.out)}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Bu aralıkta kasa / banka hareketi yok.</p>}
          {c.by_party.length > 0 && (
            <>
              <h3 className="text-xs font-bold text-muted mt-2">En çok para alınan / ödenen cariler</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {c.by_party.slice(0, 8).map((p) => (
                  <li key={p.party} className="flex items-center gap-2"><span className="flex-1 truncate">{p.party}</span>{p.in > 0 && <span className="num text-ok">+{TL(p.in)}</span>}{p.out > 0 && <span className="num text-bad">−{TL(p.out)}</span>}</li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card title="Önümüzdeki 14 gün beklenenler">
          {c.upcoming.length ? (
            <>
              <ul className="flex flex-col gap-1.5 text-sm">
                {c.upcoming.map((u, i) => (
                  <li key={i} className="flex items-center gap-2"><span className="num text-muted w-14">{d(u.date).slice(0, 5)}</span><span className="flex-1 truncate">{u.label}</span><span className={`num font-semibold ${u.dir > 0 ? "text-ok" : "text-bad"}`}>{u.dir > 0 ? "+" : "−"}{money(u.amount, u.currency)}</span></li>
                ))}
              </ul>
              <p className="text-xs text-muted border-t border-line pt-2">Beklenen giriş {TL(upIn)} · çıkış {TL(upOut)} · bugünkü likitle birlikte ≈ <b className={total + upIn - upOut < 0 ? "text-bad" : "text-ink"}>{TL(total + upIn - upOut)}</b></p>
            </>
          ) : <p className="text-sm text-muted">Vadesi gelen çek, kredi taksiti ya da kart ekstresi yok.</p>}
          <Link href="/patron?sekme=para#takvim" className="text-xs font-semibold text-brand-700">Maaş, SGK, vergi ödeme takvimi →</Link>
        </Card>
      </div>

      <Card title="Son 30 gün günlük giriş / çıkış">
        <div className="flex items-end gap-[3px] h-36" role="img" aria-label="Son 30 gün günlük giriş ve çıkış grafiği">
          {c.daily.map((x) => (
            <Link key={x.date} href={`/patron?sekme=nakit&aralik=gun&gun=${x.date}`} title={`${d(x.date)} · giren ${TL(x.in)} · çıkan ${TL(x.out)}`} className={`flex-1 flex items-end gap-px h-full rounded-sm ${x.date === r.to ? "bg-[#EEF4FB]" : ""}`}>
              <span className="flex-1 bg-[#2E9E6A] rounded-t-sm" style={{ height: `${(x.in / maxDay) * 100}%` }} />
              <span className="flex-1 bg-[#D64545] rounded-t-sm" style={{ height: `${(x.out / maxDay) * 100}%` }} />
            </Link>
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-muted"><span>{d(c.daily[0]?.date ?? r.to)}</span><span><span className="inline-block w-2 h-2 bg-[#2E9E6A] rounded-sm" /> giren · <span className="inline-block w-2 h-2 bg-[#D64545] rounded-sm" /> çıkan · güne dokunun</span><span>{d(r.to)}</span></div>
      </Card>

      <Card title={`Hareketler (${c.moves_total})`} action={c.moves_total > c.moves.length ? <span className="text-xs text-muted">son {c.moves.length} hareket</span> : undefined}>
        {c.moves.length ? (
          <ul className="flex flex-col">
            {c.moves.map((m, i) => (
              <li key={`${m.txn_id}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 border-b border-[#EEF2F6] text-sm">
                <span className="num text-muted w-12">{d(m.date).slice(0, 5)}</span>
                <span className="flex-1 min-w-[180px]">
                  <span className="font-semibold">{m.party ?? m.category ?? TXN_KIND[m.kind] ?? m.kind}</span>
                  <span className="block text-xs text-muted truncate">{[TXN_KIND[m.kind] ?? m.kind, m.account, m.description].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={`num font-bold ${m.amount >= 0 ? "text-ok" : "text-bad"}`}>{m.amount >= 0 ? "+" : "−"}{money(Math.abs(m.amount), m.currency)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Bu aralıkta hareket yok.</p>}
      </Card>
    </>
  );
}

/** Özet sekmesi için: bugünün nakit özeti (kalan likit, giren, çıkan) */
export async function CashMini({ sb, today }: { sb: SB; today: string }) {
  const { data, error } = await sb.rpc("boss_cash", { p_from: today, p_to: today });
  if (error || !data) return null;
  const c = data as Cash;
  const total = c.accounts.filter((a) => LIQUID.includes(a.kind)).reduce((x, a) => x + a.closing_try, 0);
  const inflow = c.by_kind.reduce((x, k) => x + k.in, 0);
  const outflow = c.by_kind.reduce((x, k) => x + k.out, 0);
  return (
    <Link href="/patron?sekme=nakit" className="rounded-[14px] bg-brand-800 text-white p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
      <span className="flex-1 min-w-[180px]"><span className="block text-xs text-white/60">Kasa + banka kalan</span><b className="font-display text-2xl num">{TL(total)}</b></span>
      <span><span className="block text-xs text-white/60">Bugün giren</span><b className="num text-[#7BE0AE]">+{TL(inflow)}</b></span>
      <span><span className="block text-xs text-white/60">Bugün çıkan</span><b className="num text-[#FFB4A8]">−{TL(outflow)}</b></span>
      <span className="text-xs font-semibold text-white/80">Nakit akışı →</span>
    </Link>
  );
}
