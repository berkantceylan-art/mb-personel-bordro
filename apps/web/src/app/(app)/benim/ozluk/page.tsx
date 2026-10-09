import { Card, Stat } from "@/components/ui";
import { annualLeaveEntitlement, formatTL, netToGross, paramsFor } from "@mb/core";
import { todayIso } from "@/lib/session";
import { formatDate } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";
import { severanceCapAt } from "@/lib/mevzuat";
import { ProfileChangeForm } from "./ProfileChangeForm";
import { EDITABLE, FIELD_LABEL } from "./fields";

const mask = (v: string | null | undefined, keep = 4) => (v ? `${"•".repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : "—");

export default async function MyProfilePage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Özlük bilgilerim" />;
  const [{ data: p }, { data: c }, { data: reqs }] = await Promise.all([
    supabase.from("employee_private").select("*").eq("employee_id", e.id).maybeSingle(),
    supabase.from("pay_contracts").select("bes_rate").eq("employee_id", e.id).order("valid_from", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("profile_change_requests").select("id, status, changes, decision_note, created_at, decided_at").eq("employee_id", e.id).order("created_at", { ascending: false }).limit(5),
  ]);
  // Haklarım: kıdem, ihbar, yıllık izin (tahmini; resmi brüt üzerinden)
  const today = todayIso();
  const [{ data: contract }, { data: usedRows }, { data: adjRows }] = await Promise.all([
    supabase.from("pay_contracts").select("total_net, insurance_type, fixed_official_net").eq("employee_id", e.id).lte("valid_from", today).order("valid_from", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("leave_requests").select("days, leave_types!inner(code)").eq("employee_id", e.id).eq("status", "approved").eq("leave_types.code", "YILLIK"),
    supabase.from("leave_adjustments").select("days").eq("employee_id", e.id),
  ]);
  const rights = (() => {
    if (!e.hire_date) return null;
    const days = Math.round((Date.parse(today) - Date.parse(e.hire_date)) / 86_400_000) + 1;
    const years = days / 365;
    const ent = annualLeaveEntitlement(e.hire_date, today, (p as { birth_date?: string | null } | null)?.birth_date ?? null);
    const used = (usedRows ?? []).reduce((a, l) => a + Number(l.days), 0);
    const adj = (adjRows ?? []).reduce((a, l) => a + Number(l.days), 0);
    const prm = paramsFor(Number(today.slice(0, 4)));
    const gross = contract ? (contract.insurance_type === "MIN_WAGE" ? prm.minWageGross : netToGross({ targetNet: Number(contract.fixed_official_net ?? 0), month: Number(today.slice(5, 7)), cumulativeTaxBaseBefore: 0, besRate: 0, params: prm }).gross) : prm.minWageGross;
    const weeks = years < 0.5 ? 2 : years < 1.5 ? 4 : years < 3 ? 6 : 8;
    return { years, days, earned: ent.earned + adj, used, left: Math.max(0, ent.earned + adj - used), nextDays: ent.nextYearDays, next: ent.nextAnniversary, gross, kidem: years >= 1 ? Math.round(Math.min(gross, severanceCapAt(today) ?? gross) * years) : 0, ihbar: weeks * 7 * Math.round(gross / 30), weeks };
  })();
  const editable: Record<string, string> = {};
  for (const k of EDITABLE) { const x = (p as Record<string, unknown> | null)?.[k]; editable[k] = x === null || x === undefined ? "" : String(x); }
  const LABEL = FIELD_LABEL;
  const STATUS: Record<string, string> = { pending: "Bekliyor", approved: "Onaylandı", rejected: "Reddedildi" };
  const v = (p ?? {}) as Record<string, string | number | null>;
  const d = (x: string | number | null | undefined) => (x === null || x === undefined || x === "" ? "—" : String(x));
  const groups: Array<[string, Array<[string, string]>]> = [
    ["Görev", [["Ad soyad", `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`], ["Bölüm", (e.departments as unknown as { name: string } | null)?.name ?? "—"], ["Şube", (e.branches as unknown as { name: string } | null)?.name ?? "—"], ["PDKS no", d(e.card_no)], ["İşe giriş", e.hire_date ? formatDate(e.hire_date) : "—"]]],
    ["Kimlik", [["TC kimlik no", mask(v.national_id as string)], ["Doğum", [v.birth_place, v.birth_date ? formatDate(String(v.birth_date)) : ""].filter(Boolean).join(" · ") || "—"], ["Cinsiyet", d(v.gender)], ["Medeni durum", d(v.marital_status)], ["Çocuk sayısı", d(v.children_count)], ["Kan grubu", d(v.blood_type)], ["Askerlik", d(v.military_status)]]],
    ["İletişim", [["Telefon", d(v.phone)], ["E-posta", d(v.email)], ["Adres", [v.address, v.district, v.city].filter(Boolean).join(" ") || "—"], ["Acil durumda", [v.emergency_contact_name, v.emergency_contact_relation, v.emergency_contact_phone].filter(Boolean).join(" · ") || "—"]]],
    ["Öğrenim ve ehliyet", [["Öğrenim", [v.education_level, v.school, v.school_department].filter(Boolean).join(" · ") || "—"], ["Ehliyet", d(v.license_class)]]],
    ["Banka", [["Banka", d(v.bank_name)], ["IBAN", mask(v.iban as string, 6)], ["BES", c?.bes_rate ? `%${Number(c.bes_rate) * 100}` : "yok"]]],
  ];
  const { data: orgRows } = await supabase.rpc("my_org");
  const org = (orgRows as Array<{ unit_name: string | null; unit_path: string | null; title: string | null; manager_name: string | null; manager_phone: string | null }> | null)?.[0];
  return (
    <>
      <MyHeader title="Özlük bilgilerim" subtitle="Değişiklikler İK onayıyla uygulanır" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        {org && (org.unit_name || org.manager_name) && (
          <Card title="Organizasyondaki yerim">
            <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
              {org.unit_path && <><dt className="text-muted">Birim</dt><dd>{org.unit_path}</dd></>}
              {org.title && <><dt className="text-muted">Unvan</dt><dd>{org.title}</dd></>}
              {org.manager_name && <><dt className="text-muted">Amirim</dt><dd>{org.manager_name}{org.manager_phone ? <> · <a href={`tel:${org.manager_phone}`} className="font-semibold text-brand-700">ara</a></> : null}</dd></>}
            </dl>
          </Card>
        )}
        {rights && (
          <Card title="Haklarım" action={<span className="text-xs text-muted">tahmini</span>}>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Kıdem" value={`${Math.floor(rights.years)} yıl ${Math.floor((rights.years % 1) * 12)} ay`} sub={`işe giriş ${formatDate(e.hire_date!)}`} />
              <Stat label="Yıllık izin" value={`${rights.left} gün`} sub={`hak ${rights.earned} · kullanılan ${rights.used} · ${formatDate(rights.next)}'de +${rights.nextDays}`} />
              <Stat label="Kıdem tazminatı" value={rights.kidem ? formatTL(rights.kidem) : "—"} sub={rights.kidem ? "1 yılı dolduranlara; istifada ödenmez" : "1 yıl dolunca hak edilir"} />
              <Stat label="İhbar tazminatı" value={formatTL(rights.ihbar)} sub={`${rights.weeks} hafta ihbar süresi`} />
            </div>
            <p className="text-xs text-muted">Tutarlar resmi brüt ücret ({formatTL(rights.gross)}) ve bugünkü kıdem üzerinden hesaplanmıştır; kıdem tazminatı tavanı uygulanmış, kesintiler düşülmemiştir. Kesin tutar işten ayrılışta mali müşavir tarafından hesaplanır.</p>
          </Card>
        )}
        {groups.map(([title, rows]) => (
          <Card key={title} title={title}>
            <dl className="text-sm">
              {rows.map(([k, val]) => (
                <div key={k} className="flex gap-3 py-1.5 border-b border-[#EEF2F6] last:border-0"><dt className="text-muted w-36 shrink-0">{k}</dt><dd className="flex-1 break-words">{val}</dd></div>
              ))}
            </dl>
          </Card>
        ))}
        <Card title="Bilgi güncelleme">
          <ProfileChangeForm values={editable} pending={(reqs ?? []).some((r) => r.status === "pending")} />
          {(reqs ?? []).length > 0 && (
            <ul className="divide-y divide-[#EEF2F6] text-sm">
              {(reqs ?? []).map((r) => (
                <li key={r.id} className="py-2 flex flex-col gap-1">
                  <div className="flex justify-between"><span className="text-muted">{formatDate(r.created_at.slice(0, 10))}</span><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${r.status === "approved" ? "bg-ok-bg text-ok" : r.status === "rejected" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}>{STATUS[r.status]}</span></div>
                  <div className="text-xs text-muted">{Object.entries(r.changes as Record<string, { old: string | null; new: string | null }>).map(([k, v]) => `${LABEL[k] ?? k}: ${v.new ?? "—"}`).join(" · ")}</div>
                  {r.decision_note && <div className="text-xs">{r.decision_note}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="text-xs text-muted">TC kimlik ve IBAN güvenlik için kısmen gizlenir. Kimlik bilgileri (ad, TC, doğum) için İK&apos;ya başvurun.</p>
      </div>
    </>
  );
}
