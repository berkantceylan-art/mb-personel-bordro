import { Card } from "@/components/ui";
import { formatDate } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";

const mask = (v: string | null | undefined, keep = 4) => (v ? `${"•".repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : "—");

export default async function MyProfilePage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Özlük bilgilerim" />;
  const [{ data: p }, { data: c }] = await Promise.all([
    supabase.from("employee_private").select("*").eq("employee_id", e.id).maybeSingle(),
    supabase.from("pay_contracts").select("bes_rate").eq("employee_id", e.id).order("valid_from", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const v = (p ?? {}) as Record<string, string | number | null>;
  const d = (x: string | number | null | undefined) => (x === null || x === undefined || x === "" ? "—" : String(x));
  const groups: Array<[string, Array<[string, string]>]> = [
    ["Görev", [["Ad soyad", `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`], ["Bölüm", (e.departments as unknown as { name: string } | null)?.name ?? "—"], ["Şube", (e.branches as unknown as { name: string } | null)?.name ?? "—"], ["PDKS no", d(e.card_no)], ["İşe giriş", e.hire_date ? formatDate(e.hire_date) : "—"]]],
    ["Kimlik", [["TC kimlik no", mask(v.national_id as string)], ["Doğum", [v.birth_place, v.birth_date ? formatDate(String(v.birth_date)) : ""].filter(Boolean).join(" · ") || "—"], ["Cinsiyet", d(v.gender)], ["Medeni durum", d(v.marital_status)], ["Çocuk sayısı", d(v.children_count)], ["Kan grubu", d(v.blood_type)], ["Askerlik", d(v.military_status)]]],
    ["İletişim", [["Telefon", d(v.phone)], ["E-posta", d(v.email)], ["Adres", [v.address, v.district, v.city].filter(Boolean).join(" ") || "—"], ["Acil durumda", [v.emergency_contact_name, v.emergency_contact_relation, v.emergency_contact_phone].filter(Boolean).join(" · ") || "—"]]],
    ["Öğrenim ve ehliyet", [["Öğrenim", [v.education_level, v.school, v.school_department].filter(Boolean).join(" · ") || "—"], ["Ehliyet", d(v.license_class)]]],
    ["Banka", [["Banka", d(v.bank_name)], ["IBAN", mask(v.iban as string, 6)], ["BES", c?.bes_rate ? `%${Number(c.bes_rate) * 100}` : "yok"]]],
  ];
  return (
    <>
      <MyHeader title="Özlük bilgilerim" subtitle="Yanlış bilgi için İK'ya yazın" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        {groups.map(([title, rows]) => (
          <Card key={title} title={title}>
            <dl className="text-sm">
              {rows.map(([k, val]) => (
                <div key={k} className="flex gap-3 py-1.5 border-b border-[#EEF2F6] last:border-0"><dt className="text-muted w-36 shrink-0">{k}</dt><dd className="flex-1 break-words">{val}</dd></div>
              ))}
            </dl>
          </Card>
        ))}
        <p className="text-xs text-muted">TC kimlik ve IBAN güvenlik için kısmen gizlenir. Bilgilerinizi düzeltmek için Mesajlar&apos;dan İK&apos;ya yazabilirsiniz.</p>
      </div>
    </>
  );
}
