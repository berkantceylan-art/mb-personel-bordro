import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import type { MailAccount } from "@/lib/mail";
import { Mailbox } from "./Mailbox";

export const maxDuration = 60;

const ERR: Record<string, string> = {
  ayar: "Google bağlantı ayarları eksik (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
  iptal: "Google izni verilmedi.",
  oturum: "Bağlantı süresi doldu ya da başka bir oturumdan açıldı; tekrar deneyin.",
  google: "Google'dan yanıt alınamadı; tekrar deneyin.",
  izin: "Gmail izinleri onaylanmadı. Tekrar bağlanırken tüm kutucukları işaretleyin.",
  yenile: "Google yenileme izni vermedi; hesabı Google hesabınızdaki üçüncü taraf erişimlerinden kaldırıp tekrar bağlayın.",
  sinir: "En fazla 10 hesap bağlanabilir.",
  sql: "Supabase'de 20270104000000_mail.sql çalıştırılmalı.",
  kayit: "Hesap kaydedilemedi.",
};

export default async function PostaPage({ searchParams }: { searchParams: Promise<{ a?: string; t?: string; ok?: string; hata?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase.from("mail_accounts").select("id, email, display_name, color, status, last_error, signature").order("created_at");
  const accounts = (data ?? []) as MailAccount[];
  const flash = sp.ok ? { ok: true, text: "Gmail hesabı bağlandı." } : sp.hata ? { ok: false, text: ERR[sp.hata] ?? "Bağlantı kurulamadı." } : null;
  return (
    <>
      <PageHeader title="Posta" subtitle="Gmail / Google Workspace hesaplarınız · e-postayı siparişe, CRM'e, hatırlatmaya aktarın" />
      <Mailbox
        accounts={accounts}
        initial={{ account: sp.a, thread: sp.t }}
        flash={flash}
        needSql={!!error}
        configured={!!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)}
        aiEnabled={!!process.env.ANTHROPIC_API_KEY}
        canOrder={s.logistics}
      />
    </>
  );
}
