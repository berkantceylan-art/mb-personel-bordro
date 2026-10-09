import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export const STATUS: Record<string, [string, string]> = {
  pending: ["Bekliyor", "bg-warn-bg text-warn"],
  approved: ["Onaylandı", "bg-ok-bg text-ok"],
  rejected: ["Reddedildi", "bg-bad-bg text-bad"],
  cancelled: ["İptal", "bg-[#EEF2F6] text-[#33414F]"],
};
export const Chip = ({ s }: { s: string }) => {
  const [l, c] = STATUS[s] ?? STATUS.pending!;
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${c}`}>{l}</span>;
};

/** Personel self-servis menüsü (mobil ana sayfa kutuları ve menü) */
export const MY_MENU: Array<{ href: string; label: string; icon: string; desc: string }> = [
  { href: "/benim/avans", label: "Avans iste", icon: "money", desc: "Avans talebi ve geçmişi" },
  { href: "/benim/izin", label: "İzin", icon: "calendar", desc: "Bakiyem, izin talebi, tercih, rapor bildir" },
  { href: "/benim/bordro", label: "Bordrolarım", icon: "doc", desc: "Aylık bordro özetleri" },
  { href: "/benim/hareketler", label: "Hesap hareketlerim", icon: "list", desc: "Hakediş, avans, ödeme, kesinti" },
  { href: "/benim/puantaj", label: "Puantajım", icon: "clock", desc: "Giriş-çıkış, fazla mesai, eksik okutma" },
  { href: "/benim/takvim", label: "Takvimim", icon: "calendar", desc: "Vardiya, tatil ve izin günleri" },
  { href: "/benim/ozluk", label: "Özlük bilgilerim", icon: "id", desc: "Kimlik, iletişim, banka" },
  { href: "/benim/belgeler", label: "Belgelerim", icon: "folder", desc: "e-Devlet belgeleri ve özlük dosyam" },
  { href: "/benim/zimmet", label: "Zimmetim", icon: "box", desc: "Üzerimdeki demirbaşlar" },
  { href: "/benim/imza", label: "İmzalarım", icon: "pen", desc: "Formları telefonda imzala" },
  { href: "/benim/bes", label: "BES", icon: "piggy", desc: "Emeklilik kesintilerim" },
  { href: "/benim/icra", label: "İcra ve nafaka", icon: "gavel", desc: "Yasal kesintilerim" },
  { href: "/benim/isg", label: "İş güvenliği", icon: "shield", desc: "Eğitim ve sertifikalarım" },
  { href: "/benim/saglik", label: "Sağlık", icon: "heart", desc: "Muayene ve raporlarım" },
  { href: "/benim/ilk-gunlerim", label: "İlk günlerim", icon: "flag", desc: "Uyum adımları ve ustam" },
  { href: "/benim/performans", label: "Performansım", icon: "star", desc: "Öz değerlendirme ve sonuçlarım" },
  { href: "/benim/hedefler", label: "Hedef ve becerilerim", icon: "target", desc: "Hedeflerim, beceri seviyelerim" },
  { href: "/benim/ilanlar", label: "İş ilanları", icon: "briefcase", desc: "Açık pozisyonlar, arkadaşını öner" },
  { href: "/benim/yazilar", label: "Bana gelen yazılar", icon: "mail", desc: "Savunma istemi, değişiklik bildirimi, izin planım" },
  { href: "/benim/kvkk", label: "Kişisel verilerim", icon: "lock", desc: "KVKK metni, izinlerim, başvurularım" },
  { href: "/benim/ayarlar", label: "Ayarlar", icon: "gear", desc: "Bildirim ve görünüm" },
];

export const th = "py-2 px-2 font-semibold border-b border-line";
export const td = "py-2 px-2 border-b border-[#EEF2F6]";

/** Oturumdaki personel kaydı; yoksa açıklama sayfası döner */
export async function me() {
  const s = await getSession();
  const supabase = await createClient();
  const { data } = await supabase.from("employees").select("id, first_name, last_name, card_no, hire_date, department_id, departments(name), branches(name)").eq("user_id", s.userId).maybeSingle();
  return { s, supabase, me: data };
}

export function NotLinked({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="p-6 text-muted">Hesabınız bir personel kaydına bağlı değil. Yönetim panelinden davet koduyla bağlanabilir.</div>
    </>
  );
}

export function MyHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return <PageHeader title={title} subtitle={subtitle} actions={<Link href="/benim" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">← Ana sayfa</Link>} />;
}
