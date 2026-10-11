import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, EmptyRow, Notice, Table, btnSecondary, inputCls, page, selectCls, td } from "@/components/erp";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dateOk, today } from "@/lib/fin";

export const dynamic = "force-dynamic";

const GROUPS: Record<string, { label: string; tables: string[] }> = {
  finans: { label: "Finans", tables: ["fin_txns", "fin_accounts", "fin_parties", "fin_cheques", "fin_loans", "module_permissions"] },
  fatura: { label: "Alış / satış", tables: ["inv_invoices"] },
  stok: { label: "Stok", tables: ["stk_items", "stk_moves", "stk_counts", "stk_transfers"] },
  uretim: { label: "Laboratuvar / üretim", tables: ["jobs", "lab_customers", "lab_products", "prd_remakes"] },
  masraf: { label: "Masraf / demirbaş", tables: ["exp_claims", "exp_recurring", "assets"] },
  ik: { label: "İK / bordro", tables: ["employees", "leave_requests", "ledger_entries", "advance_requests", "memberships", "user_types"] },
};
const TABLE: Record<string, string> = {
  fin_txns: "Finans işlemi", fin_accounts: "Kasa / banka hesabı", fin_parties: "Cari kart", fin_cheques: "Çek / senet", fin_loans: "Kredi", module_permissions: "Modül yetkisi",
  inv_invoices: "Fatura", stk_items: "Stok kartı", stk_moves: "Stok hareketi", stk_counts: "Sayım", stk_transfers: "Depo transferi", jobs: "İş kaydı", lab_customers: "Hekim kartı",
  lab_products: "Protez ürünü", prd_remakes: "Yeniden yapım", exp_claims: "Masraf", exp_recurring: "Tekrarlayan masraf", assets: "Demirbaş", employees: "Personel", memberships: "Kullanıcı", user_types: "Kullanıcı türü",
  leave_requests: "İzin", ledger_entries: "Hesap hareketi", advance_requests: "Avans talebi",
};
const LINK: Record<string, (id: string) => string> = {
  inv_invoices: (id) => `/fatura/${id}`, fin_parties: (id) => `/finans/cariler/${id}`, fin_accounts: (id) => `/finans/hesap/${id}`, fin_cheques: (id) => `/finans/cek-senet/${id}`,
  fin_loans: (id) => `/finans/krediler/${id}`, jobs: (id) => `/isler/${id}`, stk_items: (id) => `/stok/urunler/${id}`, stk_counts: (id) => `/stok/sayim/${id}`, stk_transfers: (id) => `/stok/transfer/${id}`,
  assets: (id) => `/demirbas/${id}`, employees: (id) => `/personel/${id}`,
};
const SKIP = new Set(["updated_at", "created_at", "company_id", "id", "ubl_xml", "ai"]);
const short = (v: unknown) => { const s = v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v); return s.length > 40 ? s.slice(0, 40) + "…" : s; };

type Row = { id: number; table_name: string; row_id: string | null; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; actor: string | null; at: string };

/** İşlem geçmişi: kim, ne zaman, hangi kayıtta neyi değiştirdi */
export default async function AuditFeed({ searchParams }: { searchParams: Promise<{ g?: string; kim?: string; bas?: string; bit?: string; islem?: string }> }) {
  const s = await getSession();
  if ((s.modules.users ?? 0) < 2 && s.role !== "owner") redirect("/");
  const sp = await searchParams;
  const from = dateOk(sp.bas) ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = dateOk(sp.bit) ?? today();
  const supabase = await createClient();
  let q = supabase.from("audit_log").select("id, table_name, row_id, action, old_data, new_data, actor, at").gte("at", `${from}T00:00:00+03:00`).lte("at", `${to}T23:59:59+03:00`).order("at", { ascending: false }).limit(400);
  if (sp.g && GROUPS[sp.g]) q = q.in("table_name", GROUPS[sp.g].tables);
  if (sp.kim) q = q.eq("actor", sp.kim);
  if (sp.islem && ["INSERT", "UPDATE", "DELETE"].includes(sp.islem)) q = q.eq("action", sp.islem);
  const [{ data, error }, { data: names }] = await Promise.all([q, supabase.rpc("audit_actor_names")]);
  const who = new Map(((names ?? []) as { user_id: string; name: string }[]).map((n) => [n.user_id, n.name]));
  const rows = (data ?? []) as Row[];

  return (
    <>
      <PageHeader title="İşlem geçmişi" subtitle="ERP'de yapılan ekleme, değişiklik ve silmeler (denetim kaydı)" actions={<Link href="/yonetim/yetkiler" className="text-sm font-semibold text-brand-700">Modül yetkileri</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{error.message}</Notice>}
        <form className="grid gap-2 grid-cols-2 md:grid-cols-6">
          <select name="g" defaultValue={sp.g ?? ""} className={selectCls} aria-label="Modül"><option value="">Tüm modüller</option>{Object.entries(GROUPS).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}</select>
          <select name="kim" defaultValue={sp.kim ?? ""} className={selectCls} aria-label="Kullanıcı"><option value="">Tüm kullanıcılar</option>{[...who.entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          <select name="islem" defaultValue={sp.islem ?? ""} className={selectCls} aria-label="İşlem"><option value="">Tüm işlemler</option><option value="INSERT">Ekleme</option><option value="UPDATE">Değişiklik</option><option value="DELETE">Silme</option></select>
          <input type="date" name="bas" defaultValue={from} className={inputCls} aria-label="Başlangıç" />
          <input type="date" name="bit" defaultValue={to} className={inputCls} aria-label="Bitiş" />
          <button className={btnSecondary}>Göster</button>
        </form>
        <Table head={["Zaman", "Kullanıcı", "Kayıt", "İşlem", "Ayrıntı"]} min={960}>
          {rows.map((r) => {
            const rec = r.new_data ?? r.old_data ?? {};
            const label = String(rec.name ?? rec.doc_no ?? rec.description ?? rec.no ?? rec.code ?? rec.patient ?? "");
            const changes = r.action === "UPDATE" && r.old_data && r.new_data
              ? Object.keys(r.new_data).filter((k) => !SKIP.has(k) && JSON.stringify(r.old_data![k]) !== JSON.stringify(r.new_data![k])).slice(0, 6)
              : [];
            const link = r.row_id && LINK[r.table_name] && r.action !== "DELETE" ? LINK[r.table_name](r.row_id) : null;
            return (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>{new Date(r.at).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td className={td}>{r.actor ? who.get(r.actor) ?? "Kullanıcı" : <span className="text-muted">Sistem</span>}</td>
                <td className={td}><span className="text-xs text-muted">{TABLE[r.table_name] ?? r.table_name}</span>{link ? <Link href={link} className="block font-semibold text-brand-700 truncate max-w-64">{label || "aç"}</Link> : <span className="block truncate max-w-64">{label}</span>}</td>
                <td className={td}><Chip tone={r.action === "INSERT" ? "green" : r.action === "DELETE" ? "red" : "blue"}>{r.action === "INSERT" ? "Ekledi" : r.action === "DELETE" ? "Sildi" : "Değiştirdi"}</Chip></td>
                <td className={`${td} text-xs`}>
                  {changes.map((k) => <span key={k} className="block"><b>{k}</b>: <span className="text-bad line-through">{short(r.old_data![k])}</span> → <span className="text-ok">{short(r.new_data![k])}</span></span>)}
                  {r.action === "UPDATE" && changes.length === 0 && <span className="text-muted">zaman damgası</span>}
                  {r.table_name === "fin_txns" && r.action === "UPDATE" && !!r.new_data?.voided_at && !r.old_data?.voided_at && <span className="text-bad font-semibold">İptal edildi: {String(r.new_data.void_reason ?? "")}</span>}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <EmptyRow cols={5} text="Bu aralıkta kayıt yok." />}
        </Table>
        <p className="text-xs text-muted">En son 400 kayıt gösterilir; aralığı daraltın. Kayıtlar silinemez ve değiştirilemez.</p>
      </div>
    </>
  );
}
