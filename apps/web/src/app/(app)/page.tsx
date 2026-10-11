import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { FLOW_STAGE } from "@/lib/flow";
import { DashGrid, type DashCard } from "./DashGrid";

export const dynamic = "force-dynamic";

type Cur = Record<string, number>;
type D = {
  today: string;
  lab?: { open: number; open_units: number; late: number; due_today: number; in_today: number; out_today: number; tryin: number; orders: number; stages: Record<string, number>; unbilled: Cur; trend: { d: string; n: number }[] };
  finance?: { cash: { currency: string; kind: string; total: number }[]; receivable: Cur; payable: Cur; cheques_in_7: { n: number; total: number }; cheques_out_7: { n: number; total: number }; loans_7: { n: number; total: number } };
  sales?: { month: Cur; prev: Cur; drafts: number; statements: number };
  purchases?: { pending: number; open: number; late: number; month: Cur };
  stock?: { critical: number; expiring: number; value: number };
  expenses?: { pending: number; pending_total: number; month: number };
  hr?: { active: number; present: number; on_leave: number; leave_pending: number; ot_pending: number; advance_pending: number; birthdays: number };
  payroll?: { period: string; accrued: number; paid: number; balance: number };
  users?: { total: number; no_account: number; untyped: number };
};

const SYM: Record<string, string> = { TRY: "₺", EUR: "€", USD: "$" };
const short = (minor: number, cur = "TRY") => {
  const v = Number(minor ?? 0) / 100;
  const a = Math.abs(v);
  const t = a >= 1e6 ? `${(v / 1e6).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} mn` : a >= 1e4 ? `${(v / 1e3).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} bin` : v.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
  return `${t} ${SYM[cur] ?? cur}`;
};
const curs = (c: Cur | undefined) => Object.entries(c ?? {}).filter(([, v]) => Number(v));

function Tile({ title, href, accent, children, foot }: { title: string; href?: string; accent: string; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <section className="group relative h-full rounded-[22px] border border-line bg-white p-5 flex flex-col gap-3 overflow-hidden transition hover:shadow-[0_12px_40px_-12px_rgba(10,61,115,.25)]">
      <span className="absolute -right-10 -top-10 w-32 h-32 rounded-full opacity-[.08] transition group-hover:scale-125" style={{ background: accent }} />
      <header className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ background: accent }} />
        <h2 className="text-xs font-bold uppercase tracking-[.12em] text-muted flex-1">{title}</h2>
        {href && <Link href={href} className="text-xs font-semibold text-brand-700 opacity-0 group-hover:opacity-100 transition">Aç →</Link>}
      </header>
      <div className="flex-1 flex flex-col gap-3">{children}</div>
      {foot && <footer className="text-xs text-muted border-t border-[#EEF2F6] pt-2">{foot}</footer>}
    </section>
  );
}
const Big = ({ v, label, tone }: { v: React.ReactNode; label: string; tone?: string }) => (
  <div><div className="font-display text-[34px] font-black leading-none tabular-nums" style={tone ? { color: tone } : undefined}>{v}</div><div className="text-xs text-muted mt-1">{label}</div></div>
);

/** Gösterge paneli: tüm modüllerden — yetkiye göre — tek bakışta durum; "Bugün dikkat" şeridi; kişiye özel düzen */
export default async function Home() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data, error }, { data: pref }, { data: me }] = await Promise.all([
    supabase.rpc("dash_summary"),
    supabase.from("user_dashboard").select("hidden, card_order").eq("user_id", s.userId).maybeSingle(),
    supabase.from("memberships").select("display_name").eq("user_id", s.userId).maybeSingle(),
  ]);
  if (s.role === "employee" && !Object.values(s.modules).some((v) => v > 0)) redirect("/benim");
  const d = (data ?? { today: "" }) as D;
  const { data: rk } = d.lab ? await supabase.rpc("prd_delay_risk") : { data: [] };
  const riskHigh = ((rk ?? []) as { risk: string }[]).filter((r) => r.risk === "high").length;
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Istanbul" }));
  const hello = hour < 6 ? "İyi geceler" : hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
  const name = ((me?.display_name as string | null) ?? "").split(" ")[0];

  // Bugün dikkat
  const alerts: { label: string; href: string; tone: "red" | "amber" | "blue" }[] = [];
  if (d.lab?.late) alerts.push({ label: `${d.lab.late} geciken iş`, href: "/uretim/nerede?gec=1", tone: "red" });
  if (riskHigh) alerts.push({ label: `✨ ${riskHigh} iş teslime yetişmeyebilir`, href: "/uretim/nerede?risk=1", tone: "red" });
  if (d.lab?.due_today) alerts.push({ label: `${d.lab.due_today} iş bugün teslim`, href: "/isler/prova", tone: "amber" });
  if (d.lab?.orders) alerts.push({ label: `${d.lab.orders} sipariş iş kaydı bekliyor`, href: "/isler/siparisler", tone: "blue" });
  if (d.purchases?.pending) alerts.push({ label: `${d.purchases.pending} satın alma onayı`, href: "/alis/siparisler?durum=pending", tone: "amber" });
  if (d.purchases?.late) alerts.push({ label: `${d.purchases.late} tedarik gecikti`, href: "/alis/siparisler?durum=sent", tone: "red" });
  if (d.expenses?.pending) alerts.push({ label: `${d.expenses.pending} masraf onayı`, href: "/masraf", tone: "amber" });
  if (d.hr?.leave_pending) alerts.push({ label: `${d.hr.leave_pending} izin talebi`, href: "/izin", tone: "amber" });
  if (d.hr?.advance_pending) alerts.push({ label: `${d.hr.advance_pending} avans talebi`, href: "/talepler", tone: "amber" });
  if (d.hr?.ot_pending) alerts.push({ label: `${d.hr.ot_pending} fazla mesai onayı`, href: "/fazla-mesai", tone: "blue" });
  if (d.finance?.cheques_in_7?.n) alerts.push({ label: `${d.finance.cheques_in_7.n} çek tahsil vadesi (7 gün)`, href: "/finans/cek-senet", tone: "blue" });
  if (d.finance?.cheques_out_7?.n) alerts.push({ label: `${d.finance.cheques_out_7.n} çek ödeme vadesi (7 gün)`, href: "/finans/cek-senet", tone: "red" });
  if (d.finance?.loans_7?.n) alerts.push({ label: `${d.finance.loans_7.n} kredi taksiti (7 gün)`, href: "/finans/krediler", tone: "amber" });
  if (d.stock?.critical) alerts.push({ label: `${d.stock.critical} kritik stok`, href: "/alis/siparisler", tone: "red" });
  if (d.stock?.expiring) alerts.push({ label: `${d.stock.expiring} lot 30 günde bitiyor`, href: "/stok", tone: "amber" });
  if (d.hr?.birthdays) alerts.push({ label: `${d.hr.birthdays} doğum günü 🎂`, href: "/personel", tone: "blue" });
  if (d.users?.no_account) alerts.push({ label: `${d.users.no_account} personelin hesabı yok`, href: "/yonetim?sekme=hesap-ac", tone: "blue" });
  const TONE = { red: "bg-[#FDECEC] text-[#B42318] border-[#F7C9C9]", amber: "bg-[#FFF6E5] text-[#8A5A00] border-[#F5D9A8]", blue: "bg-[#EAF2FB] text-brand-700 border-[#CFE0F3]" };

  // Hızlı işlemler
  const quick: [string, string][] = [];
  if ((s.modules.production ?? 0) >= 1) quick.push(["Kutu okut", "/uretim/okut"]);
  if (s.logistics) quick.push(["İş kayıt", "/isler/yeni"], ["Sipariş al", "/isler/siparisler"], ["Günlük irsaliye", "/isler/irsaliye"]);
  if ((s.modules.finance ?? 0) >= 2) quick.push(["Tahsilat / ödeme", "/finans/islem"]);
  if ((s.modules.sales ?? 0) >= 2) quick.push(["Fatura kes", "/satis/yeni"]);
  if ((s.modules.production ?? 0) >= 1 || s.logistics) quick.push(["Atölye ekranı", "/atolye"]);
  if ((s.modules.users ?? 0) >= 2) quick.push(["Hesap aç", "/yonetim?sekme=hesap-ac"]);

  const cards: DashCard[] = [];
  if (d.lab) {
    const L = d.lab;
    const stageKeys = ["reception", "production", "chief", "qc", "dispatch", "tryin"];
    const totalSt = Math.max(1, stageKeys.reduce((a, k) => a + (L.stages[k] ?? 0), 0));
    const maxT = Math.max(1, ...L.trend.map((t) => t.n));
    cards.push({ id: "lab", title: "Üretim", wide: true, node: (
      <Tile title="Üretim ve laboratuvar" href="/uretim/nerede" accent="#2563EB" foot={<span className="flex flex-wrap gap-x-4"><Link href="/atolye" className="font-semibold text-brand-700">Atölye ekranı</Link><span>{L.tryin} iş provada</span>{curs(L.unbilled).length > 0 && <Link href="/isler/aylik-fatura" className="font-semibold text-brand-700">Bu ay faturalanmamış: {curs(L.unbilled).map(([c, v]) => short(v, c)).join(" · ")}</Link>}</span>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Big v={L.open} label={`açık iş · ${Number(L.open_units).toLocaleString("tr-TR")} birim`} />
          <Big v={L.in_today} label="bugün giren" tone="#2563EB" />
          <Big v={L.out_today} label="bugün çıkan" tone="#059669" />
          <Big v={L.late} label="geciken" tone={L.late ? "#DC2626" : "#94A3B8"} />
        </div>
        <div>
          <div className="flex h-3 rounded-full overflow-hidden bg-[#EEF2F6]">{stageKeys.map((k) => (L.stages[k] ? <span key={k} title={`${FLOW_STAGE[k]?.[0]}: ${L.stages[k]}`} style={{ width: `${(L.stages[k]! / totalSt) * 100}%`, background: FLOW_STAGE[k]?.[1] }} /> : null))}</div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">{stageKeys.filter((k) => L.stages[k]).map((k) => <span key={k} className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: FLOW_STAGE[k]?.[1] }} />{FLOW_STAGE[k]?.[0]} <b className="text-ink">{L.stages[k]}</b></span>)}</div>
        </div>
        <div className="flex items-end gap-1 h-14" aria-label="Son 14 gün çıkan iş">
          {L.trend.map((t) => <span key={t.d} title={`${t.d}: ${t.n} iş`} className="flex-1 rounded-t-md bg-gradient-to-t from-[#2563EB] to-[#60A5FA]" style={{ height: `${Math.max(3, (t.n / maxT) * 56)}px`, opacity: t.d === d.today ? 1 : 0.55 }} />)}
        </div>
      </Tile>
    ) });
  }
  if (d.finance) {
    const F = d.finance;
    const byCur = new Map<string, { cash: number; bank: number }>();
    for (const c of F.cash) { const x = byCur.get(c.currency) ?? { cash: 0, bank: 0 }; x[c.kind === "cash" ? "cash" : "bank"] += Number(c.total); byCur.set(c.currency, x); }
    cards.push({ id: "finance", title: "Finans", node: (
      <Tile title="Nakit ve cari" href="/finans" accent="#059669" foot={<span>Alacak {curs(F.receivable).map(([c, v]) => short(v, c)).join(" · ") || "—"} · Borç {curs(F.payable).map(([c, v]) => short(v, c)).join(" · ") || "—"}</span>}>
        {[...byCur.entries()].map(([cur, v]) => (
          <div key={cur} className="flex items-end justify-between gap-2">
            <Big v={short(v.cash + v.bank, cur)} label={`${cur} · kasa ${short(v.cash, cur)} · banka ${short(v.bank, cur)}`} />
          </div>
        ))}
        {byCur.size === 0 && <p className="text-sm text-muted">Kasa / banka hesabı yok.</p>}
        {(F.cheques_in_7.n > 0 || F.cheques_out_7.n > 0 || F.loans_7.n > 0) && <div className="text-xs flex flex-wrap gap-2">{F.cheques_in_7.n > 0 && <span className="rounded-md bg-ok-bg text-ok px-2 py-0.5">+{short(F.cheques_in_7.total)} çek gelecek</span>}{F.cheques_out_7.n > 0 && <span className="rounded-md bg-bad-bg text-bad px-2 py-0.5">−{short(F.cheques_out_7.total)} çek ödenecek</span>}{F.loans_7.n > 0 && <span className="rounded-md bg-warn-bg text-warn px-2 py-0.5">−{short(F.loans_7.total)} kredi taksiti</span>}</div>}
      </Tile>
    ) });
  }
  if (d.sales) {
    const S = d.sales;
    cards.push({ id: "sales", title: "Satış", node: (
      <Tile title="Bu ay satış" href="/satis" accent="#7C3AED" foot={<span>{S.drafts} taslak fatura · {S.statements} aylık fatura kesildi</span>}>
        {curs(S.month).length ? curs(S.month).map(([c, v]) => {
          const p = Number(S.prev[c] ?? 0);
          const pct = p ? Math.round(((Number(v) - p) / p) * 100) : null;
          return <div key={c} className="flex items-end justify-between"><Big v={short(v, c)} label={`geçen ay ${short(p, c)}`} />{pct !== null && <span className={`text-sm font-bold ${pct >= 0 ? "text-ok" : "text-bad"}`}>{pct >= 0 ? "▲" : "▼"} %{Math.abs(pct)}</span>}</div>;
        }) : <Big v="—" label="bu ay işlenmiş satış faturası yok" />}
      </Tile>
    ) });
  }
  if (d.hr) {
    const H = d.hr;
    const pct = H.active ? Math.round((H.present / H.active) * 100) : 0;
    cards.push({ id: "hr", title: "Personel", node: (
      <Tile title="Bugün personel" href="/ik-ozet" accent="#D97706" foot={<span>{H.on_leave} izinde · {H.leave_pending} izin, {H.ot_pending} mesai, {H.advance_pending} avans talebi</span>}>
        <div className="flex items-center gap-4">
          <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90"><circle cx="18" cy="18" r="15.9" fill="none" stroke="#EEF2F6" strokeWidth="3.5" /><circle cx="18" cy="18" r="15.9" fill="none" stroke="#D97706" strokeWidth="3.5" strokeDasharray={`${pct} 100`} strokeLinecap="round" /></svg>
          <Big v={`${H.present}/${H.active}`} label={`işte (%${pct})`} />
        </div>
      </Tile>
    ) });
  }
  if (d.payroll) {
    const P = d.payroll;
    const pct = P.accrued ? Math.min(100, Math.round((Number(P.paid) / Number(P.accrued)) * 100)) : 0;
    cards.push({ id: "payroll", title: "Bordro", node: (
      <Tile title="Bu ay maaş" href="/ay-sonu" accent="#0891B2" foot={<span>Kalan ödeme {short(P.balance)}</span>}>
        <Big v={short(P.accrued)} label="hakediş" />
        <div><div className="h-2.5 rounded-full bg-[#EEF2F6] overflow-hidden"><span className="block h-full bg-[#0891B2]" style={{ width: `${pct}%` }} /></div><div className="text-xs text-muted mt-1">%{pct} ödendi · {short(P.paid)}</div></div>
      </Tile>
    ) });
  }
  if (d.stock) cards.push({ id: "stock", title: "Stok", node: (
    <Tile title="Stok" href="/stok" accent="#9333EA" foot={<span>Stok değeri {short(d.stock.value)}</span>}>
      <div className="grid grid-cols-2 gap-3"><Big v={d.stock.critical} label="kritik kalem" tone={d.stock.critical ? "#DC2626" : undefined} /><Big v={d.stock.expiring} label="30 günde SKT" tone={d.stock.expiring ? "#D97706" : undefined} /></div>
    </Tile>
  ) });
  if (d.purchases) cards.push({ id: "purchases", title: "Satın alma", node: (
    <Tile title="Satın alma" href="/alis/siparisler" accent="#475569" foot={<span>Bu ay alış {curs(d.purchases.month).map(([c, v]) => short(v, c)).join(" · ") || "—"}</span>}>
      <div className="grid grid-cols-3 gap-3"><Big v={d.purchases.pending} label="onay bekliyor" tone={d.purchases.pending ? "#D97706" : undefined} /><Big v={d.purchases.open} label="yolda" /><Big v={d.purchases.late} label="gecikmiş" tone={d.purchases.late ? "#DC2626" : undefined} /></div>
    </Tile>
  ) });
  if (d.expenses) cards.push({ id: "expenses", title: "Masraf", node: (
    <Tile title="Masraflar" href="/masraf" accent="#DC2626" foot={<span>Bu ay işlenen {short(d.expenses.month)}</span>}>
      <Big v={d.expenses.pending} label={`onay bekliyor · ${short(d.expenses.pending_total)}`} tone={d.expenses.pending ? "#D97706" : undefined} />
    </Tile>
  ) });
  if (d.users) cards.push({ id: "users", title: "Kullanıcılar", node: (
    <Tile title="Kullanıcılar" href="/yonetim" accent="#0A3D73" foot={<span>{d.users.untyped} kullanıcının türü yok</span>}>
      <div className="grid grid-cols-2 gap-3"><Big v={d.users.total} label="kullanıcı" /><Big v={d.users.no_account} label="hesabı olmayan personel" tone={d.users.no_account ? "#D97706" : undefined} /></div>
    </Tile>
  ) });
  if (quick.length) cards.push({ id: "quick", title: "Hızlı işlemler", node: (
    <Tile title="Hızlı işlemler" accent="#0F172A">
      <div className="grid grid-cols-2 gap-2">{quick.map(([l, h]) => <Link key={h} href={h} className="rounded-[12px] border border-line px-3 py-2.5 text-sm font-semibold hover:border-brand-600 hover:bg-[#F7FAFD]">{l}</Link>)}</div>
    </Tile>
  ) });

  return (
    <div className="p-4 md:p-8 flex flex-col gap-6 max-w-[1400px]">
      <section className="relative overflow-hidden rounded-[28px] bg-[#07111F] text-white p-6 md:p-8" style={{ backgroundImage: "radial-gradient(circle at 0% 0%, rgba(37,99,235,.35), transparent 50%), radial-gradient(circle at 100% 100%, rgba(5,150,105,.25), transparent 45%)" }}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-60">
            <div className="text-sm text-white/60">{new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" })}</div>
            <h1 className="font-display text-3xl md:text-4xl font-bold leading-tight">{hello}{name ? `, ${name}` : ""}</h1>
            <p className="text-white/70 mt-1">{alerts.length ? `Bugün ilgilenmeniz gereken ${alerts.length} konu var.` : "Bugün dikkat isteyen bir konu yok."}</p>
          </div>
          {d.lab && (
            <div className="flex gap-6">
              <div><div className="font-display text-4xl font-black tabular-nums">{d.lab.open}</div><div className="text-xs text-white/60">kalan iş</div></div>
              <div><div className="font-display text-4xl font-black tabular-nums text-[#34D399]">{d.lab.out_today}</div><div className="text-xs text-white/60">bugün çıkan</div></div>
            </div>
          )}
        </div>
        {alerts.length > 0 && (
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {alerts.map((a) => <Link key={a.label} href={a.href} className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold ${TONE[a.tone]}`}>{a.label}</Link>)}
          </div>
        )}
      </section>
      {error && <p className="rounded-xl bg-warn-bg text-warn p-3 text-sm">Gösterge paneli verisi için Supabase&apos;de 20261214000000_dashboard.sql çalıştırılmalı. İK özetine <Link href="/ik-ozet" className="underline font-semibold">buradan</Link> ulaşabilirsiniz.</p>}
      <DashGrid cards={cards} hidden={(pref?.hidden as string[] | undefined) ?? []} order={(pref?.card_order as string[] | undefined) ?? []} />
    </div>
  );
}
