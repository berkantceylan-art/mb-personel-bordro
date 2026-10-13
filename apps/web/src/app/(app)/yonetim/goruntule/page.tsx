import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABEL } from "@/lib/users";
import { ViewList, type Person } from "./ViewList";

export const dynamic = "force-dynamic";

const ERR: Record<string, string> = {
  yetki: "Bu işlemi yalnız şirket sahibi yapabilir.",
  kendi: "Kendi hesabınızı görüntüleyemezsiniz.",
  "ic-ice": "Görüntüleme modundayken başka bir hesap açılamaz.",
  eposta: "Bu kişinin giriş e-postası yok.",
  hedef: "Kişi bulunamadı ya da bu şirkete ait değil.",
  sql: "Supabase'de 20270118000000_impersonation.sql çalıştırılmalı.",
  anahtar: "Sunucu anahtarı (SUPABASE_SERVICE_ROLE_KEY) tanımlı değil.",
  baglanti: "Oturum açılamadı, tekrar deneyin.",
};

const dt = (d: string) => new Date(d).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function ViewAsPage({ searchParams }: { searchParams: Promise<{ hata?: string; bitti?: string }> }) {
  const s = await getSession();
  if (s.role !== "owner") redirect("/yonetim");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: ud }, { data: logs, error: logErr }] = await Promise.all([
    supabase.rpc("users_overview"),
    supabase.from("impersonation_log").select("id, admin_name, target_name, target_kind, reason, started_at, ended_at").order("started_at", { ascending: false }).limit(50),
  ]);
  const people: Person[] = ((ud ?? []) as Array<{ user_id: string; display_name: string; role: string; email: string | null; department: string | null; user_type: string | null; last_sign_in_at: string | null }>)
    .filter((u) => u.user_id !== s.userId && u.email)
    .map((u) => ({ id: u.user_id, name: u.display_name || u.email!, sub: [u.user_type ?? ROLE_LABEL[u.role] ?? u.role, u.department].filter(Boolean).join(" · "), email: u.email!, kind: "erp" }));
  try {
    const admin = createAdminClient();
    const { data: pm } = await admin.from("portal_members").select("user_id, display_name, email, role, title, portal_accounts(name, type)").not("user_id", "is", null).limit(2000);
    for (const m of (pm ?? []) as unknown as Array<{ user_id: string; display_name: string | null; email: string | null; role: string | null; title: string | null; portal_accounts: { name: string; type: string } | null }>) {
      const acc = m.portal_accounts;
      people.push({ id: m.user_id, name: m.display_name || m.email || "—", sub: [acc?.name, ({ clinic: "Klinik", doctor_tr: "Hekim", doctor_foreign: "Yurt dışı hekim", agency: "Aracı kurum" } as Record<string, string>)[acc?.type ?? ""] ?? acc?.type, m.title].filter(Boolean).join(" · "), email: m.email ?? "", kind: "portal" });
    }
  } catch {
    // anahtar yoksa yalnız ERP kullanıcıları listelenir
  }

  return (
    <>
      <PageHeader title="Kullanıcı olarak görüntüle" subtitle="Personel, yönetici, klinik ve hekim ekranlarını şifreleri olmadan, yalnız görüntüleme modunda açın" />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1100px]">
        {sp.hata && <p className="text-sm rounded-[12px] px-4 py-3 bg-bad-bg text-bad">{ERR[sp.hata] ?? "İşlem yapılamadı."}</p>}
        {sp.bitti && <p className="text-sm rounded-[12px] px-4 py-3 bg-ok-bg text-ok">Görüntüleme bitti, kendi hesabınıza döndünüz.</p>}
        {logErr && <p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">{ERR.sql}</p>}
        <section className="rounded-[14px] bg-[#F0F6FD] border border-[#CFE0F3] p-4 text-sm text-brand-800 flex flex-col gap-1">
          <b>Nasıl çalışır?</b>
          <span>• Kişinin ekranı tam olarak onun gördüğü gibi açılır; <b>hiçbir şey kaydedilemez, silinemez, gönderilemez</b> (veritabanında da engellidir).</span>
          <span>• Kişiye &quot;Yöneticiniz hesabınızı görüntüledi&quot; bildirimi gider; her açılış aşağıdaki geçmişe yazılır.</span>
          <span>• ERP kullanıcıları bu sekmede açılır; üstteki kırmızı şeritten &quot;Görüntülemeyi bitir&quot; ile kendi hesabınıza dönersiniz. Klinik / hekim ekranı web sitesi portalında açılır.</span>
          <span>• Görüntüleme oturumu en geç 1 saatte kendiliğinden kapanır.</span>
        </section>
        <ViewList people={people} />
        <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2">
          <h2 className="font-display font-bold text-brand-800">Görüntüleme geçmişi</h2>
          {(logs ?? []).length ? (
            <ul className="flex flex-col">
              {(logs ?? []).map((l) => (
                <li key={l.id} className="flex flex-wrap gap-x-3 py-2 border-b border-[#EEF2F6] text-sm">
                  <span className="num text-muted w-36">{dt(l.started_at)}</span>
                  <span className="flex-1 min-w-[200px]"><b>{l.admin_name}</b> → {l.target_name} <span className="text-xs text-muted">({l.target_kind === "portal" ? "portal" : "ERP"})</span>{l.reason ? <span className="block text-xs text-muted">Neden: {l.reason}</span> : null}</span>
                  <span className="text-xs text-muted">{l.ended_at ? `bitti ${dt(l.ended_at)}` : "açık / süre doldu"}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Henüz görüntüleme yapılmadı.</p>}
        </section>
      </div>
    </>
  );
}
