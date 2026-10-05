import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, PageHead, formatTr } from "@/components/admin/ui";
import { saveAccountNote, setAccountStatus, setPriceAccess } from "@/lib/portal-actions";
import { PORTAL_UI, STATUS_CLS, type PortalAccount, type PortalCase } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Portal hesabı" };

const STATUS_LABEL = { pending: "Onay bekliyor", active: "Aktif", suspended: "Askıda" } as const;

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; hata?: string }> }) {
  const { id } = await params;
  const { ok, hata } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("portal_accounts").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const a = data as PortalAccount;
  const { data: cs } = await supabase.from("portal_cases").select("*").eq("account_id", id).order("created_at", { ascending: false }).limit(100);
  const cases = (cs ?? []) as PortalCase[];
  const ui = PORTAL_UI.tr;
  const btn = "rounded-full px-5 py-2.5 text-sm font-semibold";

  return (
    <>
      <PageHead title={a.name} lead={`${ui.types[a.type]} · ${STATUS_LABEL[a.status]}`} />
      <Flash ok={ok} hata={hata} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid content-start gap-4">
          <dl className="grid gap-3 rounded-2xl border border-gypsum bg-white p-5 text-sm">
            {(
              [
                ["Kurum", a.company],
                ["E-posta", a.email],
                ["Telefon", a.phone],
                ["Konum", [a.city, a.country].filter(Boolean).join(", ")],
                ["Başvuru", formatTr(a.created_at)],
                ["Onay", a.approved_at ? formatTr(a.approved_at) : null],
              ] as [string, string | null][]
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-slate">{k}</dt>
                  <dd className="break-words font-semibold">{v}</dd>
                </div>
              ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            {a.status !== "active" && (
              <form action={setAccountStatus}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="status" value="active" />
                <button type="submit" className={`${btn} bg-ok text-white hover:opacity-90`}>
                  {a.status === "pending" ? "Onayla" : "Yeniden etkinleştir"}
                </button>
              </form>
            )}
            {a.status !== "suspended" && (
              <form action={setAccountStatus}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="status" value="suspended" />
                <button type="submit" className={`${btn} border border-bad text-bad hover:bg-bad-bg`}>
                  {a.status === "pending" ? "Reddet / askıya al" : "Askıya al"}
                </button>
              </form>
            )}
            {a.email && (
              <a href={`mailto:${a.email}`} className={`${btn} border border-gypsum bg-white text-navy hover:border-navy`}>
                E-posta yaz
              </a>
            )}
          </div>
          <div className={`rounded-2xl border p-5 ${a.price_requested_at && !a.price_access ? "border-smile bg-smile/10" : "border-gypsum bg-white"}`}>
            <h2 className="font-semibold text-navy">Genel fiyat listesi</h2>
            <p className="mt-1 text-sm text-slate">
              {a.price_access
                ? `Erişimi var${a.price_granted_at ? ` (${formatTr(a.price_granted_at)} tarihinden beri)` : ""}. Portalda fiyat listesini görür.`
                : a.price_requested_at
                  ? `${formatTr(a.price_requested_at)} tarihinde fiyat listesi talep etti.`
                  : "Erişimi yok. Hekim portaldan talep edebilir ya da siz doğrudan erişim verebilirsiniz."}
              {a.status !== "active" && " Hesap aktif olmadan liste görünmez."}
            </p>
            <form action={setPriceAccess} className="mt-3">
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="on" value={a.price_access ? "0" : "1"} />
              <button type="submit" className={`${btn} ${a.price_access ? "border border-bad text-bad hover:bg-bad-bg" : "bg-navy text-white hover:bg-blue"}`}>
                {a.price_access ? "Erişimi kaldır" : a.price_requested_at ? "Talebi onayla" : "Erişim ver"}
              </button>
            </form>
          </div>
          <form action={saveAccountNote} className="grid gap-3 rounded-2xl border border-gypsum bg-white p-5">
            <input type="hidden" name="id" value={a.id} />
            <label className="grid gap-1 text-sm font-semibold text-navy">
              Portal dili
              <select name="language" defaultValue={a.language} className="field font-normal">
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-navy">
              İç not
              <textarea name="note" defaultValue={a.note ?? ""} rows={3} maxLength={2000} className="field font-normal" placeholder="Yalnız ekip görür (fiyat grubu, ödeme koşulu…)." />
            </label>
            <button type="submit" className="justify-self-start rounded-full border border-gypsum px-4 py-2 text-sm font-semibold text-navy hover:border-navy">
              Kaydet
            </button>
          </form>
        </div>
        <section className="rounded-2xl border border-gypsum bg-white p-5">
          <h2 className="display text-lg font-semibold text-navy">Vakaları ({cases.length})</h2>
          {cases.length === 0 ? (
            <p className="mt-3 text-sm text-slate">Henüz vaka yok.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gypsum text-sm">
              {cases.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/portal/vaka/${c.id}`} className="flex items-center gap-3 py-2.5 hover:text-navy">
                    <span className="num font-semibold text-navy">#{c.no}</span>
                    <span className="flex-1 truncate">{c.patient_ref}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[c.status]}`}>{ui.statuses[c.status]}</span>
                    <span className="text-xs text-slate">{formatTr(c.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
