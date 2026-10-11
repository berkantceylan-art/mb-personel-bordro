import "server-only";
/**
 * ERP asistanı araçları: laboratuvar, üretim, finans, satış, stok, kalite, CRM.
 * Her araç kullanıcının KENDİ oturumuyla (RLS + yetkili RPC'ler) çalışır; yetkisi olmayan modülün aracı hiç sunulmaz.
 */
import type { Ctx } from "./tools";

type ErpTool = {
  name: string; description: string; modules: string[]; level?: number;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run: (c: Ctx, i: Record<string, string>) => Promise<unknown>;
};
const M = (minor: unknown, cur = "TRY") => `${(Number(minor ?? 0) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur === "TRY" ? "₺" : cur}`;
const D = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join(".") : null);
const like = (q: string) => `%${q.replace(/[%_,()]/g, " ").trim()}%`;

export const ERP_TOOLS: ErpTool[] = [
  {
    name: "cari_durum", modules: ["finance", "sales", "lab"],
    description: "Bir hekim / klinik / tedarikçinin cari durumu: resmi bakiye, iç (irsaliyeli) bakiye, son tahsilat, açık iş sayısı, kredi limiti. 'Odonto'dan ne kadar alacağımız var' gibi sorular için.",
    input_schema: { type: "object", properties: { ad: { type: "string", description: "Cari / hekim adı (parçası)" } }, required: ["ad"] },
    async run(c, i) {
      const q = String(i.ad ?? "").trim();
      if (q.length < 2) return { hata: "Ad yazın." };
      const [{ data: parties }, { data: custs }] = await Promise.all([
        c.sb.from("fin_party_balances").select("party_id, name, kind, currency, balance, lab_customer_id").ilike("name", like(q)).limit(5),
        c.sb.from("lab_customers").select("id, name, currency, internal_book, credit_limit").ilike("name", like(q)).limit(5),
      ]);
      const out = [];
      for (const p of (parties ?? []) as { party_id: string; name: string; kind: string; currency: string; balance: number; lab_customer_id: string | null }[]) {
        const cust = (custs ?? []).find((x) => x.id === p.lab_customer_id) as { id: string; internal_book: boolean; credit_limit: number | null } | undefined;
        const [{ data: ib }, { data: lp }, { count }] = await Promise.all([
          cust?.internal_book ? c.sb.from("lab_internal_balances").select("balance, currency").eq("customer_id", cust.id).maybeSingle() : Promise.resolve({ data: null }),
          p.lab_customer_id ? c.sb.from("lab_payments").select("paid_on, amount").eq("customer_id", p.lab_customer_id).order("paid_on", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
          p.lab_customer_id ? c.sb.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", p.lab_customer_id).not("status", "in", "(delivered,cancelled)") : Promise.resolve({ count: null }),
        ]);
        out.push({
          cari: p.name, tur: p.kind, resmi_bakiye: M(p.balance, p.currency), anlam: Number(p.balance) > 0 ? "bize borçlu" : Number(p.balance) < 0 ? "biz borçluyuz" : "bakiye yok",
          ...(ib ? { ic_cari_bakiye: M((ib as { balance: number }).balance, (ib as { currency: string }).currency) } : {}),
          ...(lp ? { son_tahsilat: `${D((lp as { paid_on: string }).paid_on)} · ${M((lp as { amount: number }).amount, p.currency)}` } : {}),
          ...(count !== null ? { acik_is: count } : {}),
          ...(cust?.credit_limit ? { kredi_limiti: M(cust.credit_limit, p.currency) } : {}),
        });
      }
      return out.length ? out : { mesaj: "Bu adla cari bulunamadı ya da görme yetkiniz yok." };
    },
  },
  {
    name: "is_bul", modules: ["lab", "production"],
    description: "İş numarası ya da hasta adıyla işin durumu: hekim, aşama, kimin elinde, teslim tarihi, tutar.",
    input_schema: { type: "object", properties: { ara: { type: "string", description: "İş no (ör. 1234) ya da hasta adı" } }, required: ["ara"] },
    async run(c, i) {
      const q = String(i.ara ?? "").trim();
      const no = Number(q.replace(/\D/g, ""));
      let query = c.sb.from("jobs").select("id, no, patient, status, flow_stage, due_date, total, currency, delivered_at, lab_customers(name), employees:holder_employee_id(first_name, last_name)").order("no", { ascending: false }).limit(5);
      query = no && /^\s*#?\d+\s*$/.test(q) ? query.eq("no", no) : query.ilike("patient", like(q));
      const { data } = await query;
      const rows = (data ?? []) as unknown as { no: number; patient: string | null; status: string; flow_stage: string | null; due_date: string | null; total: number; currency: string; delivered_at: string | null; lab_customers: { name: string } | null; employees: { first_name: string; last_name: string } | null }[];
      return rows.length ? rows.map((r) => ({ is: `#${r.no}`, hasta: r.patient, hekim: r.lab_customers?.name, durum: r.status, asama: r.flow_stage, elinde: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : null, teslim_tarihi: D(r.due_date), teslim_edildi: D(r.delivered_at), tutar: M(r.total, r.currency) })) : { mesaj: "İş bulunamadı." };
    },
  },
  {
    name: "geciken_isler", modules: ["lab", "production"],
    description: "Geciken ya da yetişmeme riski yüksek açık işler (geçmiş akış hızına göre tahmin).",
    input_schema: { type: "object", properties: {} },
    async run(c) {
      const { data, error } = await c.sb.rpc("prd_delay_risk");
      if (error) return { hata: error.message };
      const rows = ((data ?? []) as { no: number; customer: string | null; patient: string | null; due_date: string; flow_stage: string; risk: string; slack_hours: number }[]).filter((r) => r.risk === "late" || r.risk === "high");
      return { adet: rows.length, isler: rows.slice(0, 25).map((r) => ({ is: `#${r.no}`, hekim: r.customer, hasta: r.patient, teslim: D(r.due_date), asama: r.flow_stage, risk: r.risk === "late" ? "gecikmiş" : "yüksek", pay_saat: r.slack_hours })) };
    },
  },
  {
    name: "gunun_ozeti", modules: ["lab", "production", "finance", "sales", "stock", "hr", "attendance"],
    description: "Bugünün özeti: gelen / teslim edilen iş, geciken, onay bekleyenler, kasa-banka, tahsilat (yetkiye göre bölümler).",
    input_schema: { type: "object", properties: {} },
    async run(c) {
      const { data, error } = await c.sb.rpc("dash_summary");
      return error ? { hata: error.message } : data;
    },
  },
  {
    name: "nakit_durumu", modules: ["finance"],
    description: "Kasa ve banka bakiyeleri (TL karşılığı) ve önümüzdeki 4 haftanın beklenen giriş / çıkışları.",
    input_schema: { type: "object", properties: {} },
    async run(c) {
      const [{ data: acc }, { data: fc }] = await Promise.all([
        c.sb.from("fin_account_balances").select("name, kind, currency, balance, balance_try").in("kind", ["cash", "bank", "pos"]),
        c.sb.rpc("fin_cash_forecast", { p_weeks: 4 }),
      ]);
      const rows = (acc ?? []) as { name: string; currency: string; balance: number; balance_try: number }[];
      const f = (fc ?? []) as { week_start: string; kind: string; amount: number }[];
      const weeks = [...new Set(f.map((x) => x.week_start))].sort().map((w) => ({ hafta: D(w), giris: M(f.filter((x) => x.week_start === w && x.kind === "in").reduce((a, x) => a + Number(x.amount), 0)), cikis: M(f.filter((x) => x.week_start === w && x.kind === "out").reduce((a, x) => a + Number(x.amount), 0)) }));
      return { toplam_tl: M(rows.reduce((a, r) => a + Number(r.balance_try), 0)), hesaplar: rows.map((r) => ({ hesap: r.name, bakiye: M(r.balance, r.currency) })), haftalar: weeks };
    },
  },
  {
    name: "satis_ozeti", modules: ["sales", "finance"],
    description: "Son aylar: ciro (TL karşılığı), teslim edilen iş ve ünit, zamanında teslim %, yeniden yapım oranı, çalışılan klinik sayısı; hacmi düşen klinikler.",
    input_schema: { type: "object", properties: { ay: { type: "string", description: "Kaç ay (varsayılan 3)" } } },
    async run(c, i) {
      const n = Math.min(12, Math.max(1, Number(i.ay) || 3));
      const [{ data }, { data: w }] = await Promise.all([c.sb.rpc("kpi_monthly", { p_months: n }), c.sb.rpc("kpi_clinic_watch")]);
      return {
        aylar: ((data ?? []) as { month: string; revenue_try: number; jobs: number; units: number; on_time: number | null; remake_rate: number | null; clinics: number }[]).map((m) => ({ ay: m.month, ciro: M(m.revenue_try), is: m.jobs, unit: m.units, zamaninda: m.on_time, yeniden_yapim: m.remake_rate, klinik: m.clinics })),
        hacmi_dusen: ((w ?? []) as { name: string; prev60: number; last60: number }[]).slice(0, 10).map((x) => `${x.name}: ${x.prev60} → ${x.last60} iş`),
      };
    },
  },
  {
    name: "stok_durumu", modules: ["stock", "purchases"],
    description: "Kritik stok (asgari altı), son kullanma yaklaşan lotlar ve tüketim hızına göre kaç gün yeteceği.",
    input_schema: { type: "object", properties: { ara: { type: "string", description: "Belirli bir malzeme adı (isteğe bağlı)" } } },
    async run(c, i) {
      const { data } = await c.sb.rpc("dmd_material_forecast", { p_lead_days: 14 });
      let rows = (data ?? []) as { item: string; unit: string; stock: number; monthly: number; cover_days: number | null; suggest: number; min_qty: number }[];
      if (i.ara) rows = rows.filter((r) => r.item.toLocaleLowerCase("tr").includes(String(i.ara).toLocaleLowerCase("tr")));
      const { data: exp } = await c.sb.rpc("stk_lot_overview", { p_q: i.ara || null, p_status: null, p_days: 30 });
      return {
        malzemeler: rows.slice(0, 20).map((r) => ({ malzeme: r.item, eldeki: `${r.stock} ${r.unit}`, aylik_tuketim: r.monthly, yeter_gun: r.cover_days, onerilen_alim: r.suggest, asgari: r.min_qty })),
        skt_yaklasan: ((exp ?? []) as { item: string; lot_no: string; expiry_date: string; qty: number; days_left: number }[]).slice(0, 10).map((l) => `${l.item} lot ${l.lot_no}: ${D(l.expiry_date)} (${l.days_left} gün, ${l.qty})`),
      };
    },
  },
  {
    name: "kalite_ozeti", modules: ["production", "lab"],
    description: "Kalite: açık şikâyetler, şikâyet oranı, geciken düzeltici faaliyetler, memnuniyet puanı, yeniden yapımda olağan dışı kümeler.",
    input_schema: { type: "object", properties: {} },
    async run(c) {
      const [{ data: s }, { data: sig }] = await Promise.all([c.sb.rpc("qms_summary", { p_days: 90 }), c.sb.rpc("prd_remake_signals", { p_days: 90 })]);
      return { ozet_90_gun: s, kok_neden_sinyalleri: ((sig ?? []) as { dimension: string; label: string; rate: number; overall: number; top_reason: string }[]).map((x) => `${x.dimension} ${x.label}: %${x.rate} (genel %${x.overall}), en sık neden ${x.top_reason}`) };
    },
  },
  {
    name: "crm_bugun", modules: ["sales"],
    description: "Bugün aranacak / ziyaret edilecek adaylar ve hekimler, açık görevler, aday hattı özeti.",
    input_schema: { type: "object", properties: {} },
    async run(c) {
      const [{ data: leads }, { data: tasks }] = await Promise.all([
        c.sb.from("crm_leads").select("name, stage, next_action, next_date").not("stage", "in", "(won,lost)").lte("next_date", c.today).order("next_date").limit(20),
        c.sb.from("crm_activities").select("notes, due_date, lab_customers(name), crm_leads(name)").eq("done", false).lte("due_date", c.today).limit(20),
      ]);
      return { adaylar: leads ?? [], gorevler: ((tasks ?? []) as unknown as { notes: string; due_date: string; lab_customers: { name: string } | null; crm_leads: { name: string } | null }[]).map((t) => ({ kim: t.lab_customers?.name ?? t.crm_leads?.name, ne: t.notes, tarih: D(t.due_date) })) };
    },
  },
  {
    name: "onaylarim", modules: [],
    description: "Onay akışında kullanıcıyı bekleyen masraf ve satın alma talepleri.",
    input_schema: { type: "object", properties: {} },
    async run(c) {
      const { data } = await c.sb.rpc("apr_inbox");
      return ((data ?? []) as { title: string; amount: number; step: number; steps: number }[]).map((r) => ({ talep: r.title, tutar: M(r.amount), adim: `${r.step}/${r.steps}` }));
    },
  },
];

export function erpToolsFor(modules: Record<string, number>, role: string) {
  return ERP_TOOLS.filter((t) => role === "owner" || !t.modules.length || t.modules.some((m) => (modules[m] ?? 0) >= (t.level ?? 1)));
}
