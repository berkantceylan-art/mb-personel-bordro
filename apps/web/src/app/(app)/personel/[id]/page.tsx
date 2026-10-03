import Link from "next/link";
import { notFound } from "next/navigation";
import { formatTL, splitContract, summarize, withRunningBalance, type LedgerEntry } from "@mb/core";
import { Card, ChannelChip, TYPE_LABEL } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, formatDate, getSession, periodLabel } from "@/lib/session";
import { deleteContract } from "../../zamlar/actions";
import { deleteDocument, uploadDocument } from "./document-actions";

function yearsSince(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) y--;
  return Math.max(0, y);
}

type Priv = Record<string, string | number | null>;
const INFO: Array<{ title: string; items: Array<[string, string, ("date" | "iban")?]> }> = [
  {
    title: "Kimlik",
    items: [
      ["TC kimlik no", "national_id"], ["SGK no", "sgk_no"], ["Doğum tarihi", "birth_date", "date"], ["Doğum yeri", "birth_place"],
      ["Cinsiyet", "gender"], ["Uyruk", "nationality"], ["Baba adı", "father_name"], ["Anne adı", "mother_name"],
      ["Medeni durum", "marital_status"], ["Çocuk sayısı", "children_count"], ["Kan grubu", "blood_type"], ["Askerlik", "military_status"],
    ],
  },
  {
    title: "İletişim ve adres",
    items: [
      ["Cep telefonu", "phone"], ["İkinci telefon", "phone2"], ["E-posta", "email"], ["İl / ilçe", "city_district"], ["Adres", "address"],
      ["Acil durum kişisi", "emergency"], ["Acil durum telefonu", "emergency_contact_phone"],
    ],
  },
  {
    title: "Öğrenim ve ehliyet",
    items: [
      ["Öğrenim durumu", "education_level"], ["Okul", "school"], ["Bölüm", "school_department"], ["Mezuniyet yılı", "graduation_year"],
      ["Diploma no", "diploma_no"], ["Ehliyet sınıfı", "license_class"], ["Ehliyet no", "license_no"], ["Ehliyet tarihi", "license_date", "date"],
    ],
  },
  { title: "Banka", items: [["Banka", "bank_name"], ["IBAN", "iban", "iban"], ["Hesap sahibi", "iban_holder"]] },
];

export default async function EmployeeProfile({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ donem?: string; iptal?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  const showVoided = sp.iptal === "1";
  const s = await getSession();
  const pay = canManagePay(s.role);
  const hr = ["owner", "accountant", "hr"].includes(s.role);
  const supabase = await createClient();

  const { data: e } = await supabase
    .from("employees")
    .select("id, card_no, first_name, last_name, hire_date, termination_date, termination_reason, status, position_title, notes, departments(name), branches(name)")
    .eq("id", id)
    .maybeSingle();
  if (!e) notFound();

  const [{ data: priv }, { data: contracts }, { data: entries }, { data: docTypes }, { data: docs }, { data: periods }] = await Promise.all([
    supabase.from("employee_private").select("*").eq("employee_id", id).maybeSingle(),
    supabase.from("pay_contracts").select("*").eq("employee_id", id).order("valid_from", { ascending: false }),
    supabase.from("ledger_entries").select("*").eq("employee_id", id).eq("period", period),
    supabase.from("document_types").select("id, name, required, category, has_expiry").order("sort_order"),
    supabase.from("employee_documents").select("id, document_type_id, file_path, file_name, expires_on, uploaded_at").eq("employee_id", id),
    supabase.from("ledger_entries").select("period").eq("employee_id", id).is("voided_at", null),
  ]);

  const active = (entries ?? []).filter((r) => !r.voided_at);
  const ledger: LedgerEntry[] = active.map((r) => ({ id: r.id, period: r.period, date: r.entry_date, type: r.type, channel: r.channel, amount: Number(r.amount) }));
  const rows = withRunningBalance(ledger);
  const sum = summarize(ledger);
  const noteById = new Map(active.map((r) => [r.id, r.note as string | null]));
  const voided = (entries ?? []).filter((r) => r.voided_at);

  const contract = contracts?.[0];
  const split = contract
    ? splitContract(
        {
          totalNet: Number(contract.total_net),
          insuranceType: contract.insurance_type,
          fixedOfficialNet: contract.fixed_official_net ? Number(contract.fixed_official_net) : undefined,
          besRate: Number(contract.bes_rate),
        },
        Number(period.slice(5, 7)),
        0,
      )
    : null;

  // Belgeler: imzalı bağlantılar
  const docRows = docs ?? [];
  const signed = new Map<string, string>();
  if (docRows.length) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(docRows.map((d) => d.file_path), 600);
    (urls ?? []).forEach((u, i) => u.signedUrl && signed.set(docRows[i]!.id, u.signedUrl));
  }
  const docsByType = new Map<string, typeof docRows>();
  for (const d of docRows) docsByType.set(d.document_type_id, [...(docsByType.get(d.document_type_id) ?? []), d]);
  const types = (docTypes ?? []).filter((d) => d.category !== "cikis" || e.status === "terminated");
  const required = types.filter((d) => d.required);
  const missing = required.filter((d) => !docsByType.has(d.id)).length;

  const allPeriods = [...new Set([period, currentPeriod(), ...(periods ?? []).map((p) => p.period as string)])].sort().reverse();
  const dept = (e.departments as unknown as { name: string } | null)?.name;
  const branch = (e.branches as unknown as { name: string } | null)?.name;
  const p = (priv ?? {}) as Priv;
  const val = (key: string, fmt?: "date" | "iban"): string => {
    if (key === "city_district") return [p.city, p.district].filter(Boolean).join(" / ");
    if (key === "emergency") return [p.emergency_contact_name, p.emergency_contact_relation ? `(${p.emergency_contact_relation})` : ""].filter(Boolean).join(" ");
    const v = p[key];
    if (v === null || v === undefined || v === "") return "";
    if (fmt === "date") return formatDate(String(v));
    if (fmt === "iban") return String(v).replace(/(.{4})/g, "$1 ").trim();
    return String(v);
  };
  const btn = "h-11 px-4 inline-flex items-center rounded-[10px] font-semibold";

  return (
    <div className="flex flex-col">
      <div className="px-6 md:px-8 pt-5 text-[13px] text-muted">
        <Link href="/personel" className="text-brand-700">Personel</Link> / {dept ?? "—"} / {e.first_name} {e.last_name}
      </div>

      <section className="mx-6 md:mx-8 mt-3.5 bg-white border border-line rounded-2xl p-6 flex flex-wrap gap-5 items-center">
        <div className="w-[72px] h-[72px] rounded-full bg-brand-700 text-white grid place-items-center font-display font-bold text-2xl">{`${e.first_name[0] ?? ""}${e.last_name[0] ?? ""}`}</div>
        <div className="flex-1 min-w-72 flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2.5 items-center">
            <h1 className="font-display text-2xl font-bold text-brand-800">{e.first_name} {e.last_name}</h1>
            {e.status === "terminated" ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#EEF2F6] text-[#33414F]">Ayrıldı · {e.termination_date ? formatDate(e.termination_date) : ""}</span>
            ) : (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-ok-bg text-ok">Aktif</span>
            )}
          </div>
          <span className="text-muted">{[dept, e.position_title, branch].filter(Boolean).join(" · ")}</span>
          <div className="flex flex-wrap gap-4 text-[13px] text-[#33414F]">
            <span>PDKS no <b className="num">{e.card_no ?? "—"}</b></span>
            <span>İşe giriş <b className="num">{formatDate(e.hire_date)}</b> ({yearsSince(e.hire_date)} yıl)</span>
            {pay && contract && <span>Ücret <b className="num">{formatTL(Number(contract.total_net))}</b> · {contract.insurance_type === "MIN_WAGE" ? "asgari ücretli" : `${formatTL(Number(contract.fixed_official_net))} net sigortalı`}</span>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {hr && <Link href={`/personel/${id}/duzenle`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700`}>Düzenle</Link>}
          {pay && <Link href={`/personel/${id}/zam`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700`}>Zam / ücret</Link>}
          {pay && <Link href={`/odemeler/yeni?personel=${id}`} className={`${btn} bg-brand-700 text-white`}>+ Avans / Ödeme</Link>}
        </div>
      </section>

      <div className="p-6 md:p-8 flex flex-wrap gap-5 items-start max-w-[1320px]">
        <div className="flex-[999_1_560px] min-w-0 flex flex-col gap-5">
          {pay && (
            <Card
              title={`${periodLabel(period)} hakedişi`}
              action={
                <form className="flex items-center gap-2 text-[13px] text-muted">
                  <label htmlFor="donem">Dönem</label>
                  <select id="donem" name="donem" defaultValue={period} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white text-ink">
                    {allPeriods.map((x) => <option key={x} value={x}>{periodLabel(x)}</option>)}
                  </select>
                  <button className="h-10 px-3 rounded-lg border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Göster</button>
                </form>
              }
            >
              <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
                {([
                  ["Hakediş", sum.accrued, "bg-[#EEF2F6] text-ink"],
                  ["Bankadan", sum.paidBank, "bg-[#E7F1FB] text-brand-700"],
                  ["Elden", sum.paidCash, "bg-[#E0F5FB] text-accent-ink"],
                  ["Kesintiler", sum.deductions, "bg-[#F1ECFA] text-[#5B3A9A]"],
                  ["Kalan", sum.balance, "bg-warn-bg text-warn"],
                ] as const).map(([label, v, cls]) => (
                  <div key={label} className={`flex flex-col gap-1 rounded-[10px] px-3.5 py-3 ${cls}`}>
                    <span className="text-xs">{label}</span>
                    <span className="num font-display text-[18px] font-bold">{formatTL(v)}</span>
                  </div>
                ))}
              </div>
              {contract && split && (
                <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] text-[13px]">
                  <div className="border border-dashed border-[#C5D0DC] rounded-[10px] p-3.5 flex flex-col gap-1.5">
                    <span className="font-semibold text-brand-800">Resmi bordro (tahmini)</span>
                    <span className="flex justify-between"><span>Brüt</span><b className="num">{formatTL(split.official.gross)}</b></span>
                    <span className="flex justify-between"><span>SGK + işsizlik</span><span className="num">−{formatTL(split.official.sgkEmployee + split.official.unemploymentEmployee)}</span></span>
                    <span className="flex justify-between"><span>Gelir + damga vergisi</span><span className="num">−{formatTL(split.official.incomeTax + split.official.stampTax)}</span></span>
                    <span className="flex justify-between"><span>Net (bankaya)</span><b className="num">{formatTL(split.official.net)}</b></span>
                  </div>
                  <div className="border border-dashed border-[#C5D0DC] rounded-[10px] p-3.5 flex flex-col gap-1.5">
                    <span className="font-semibold text-brand-800">İç hakediş</span>
                    <span className="flex justify-between"><span>Anlaşılan toplam</span><b className="num">{formatTL(Number(contract.total_net))}</b></span>
                    <span className="flex justify-between"><span>Resmi net</span><span className="num">{formatTL(split.official.net)}</span></span>
                    <span className="flex justify-between"><span>Elden kısım</span><b className="num">{formatTL(split.cashPart)}</b></span>
                  </div>
                </div>
              )}
            </Card>
          )}

          {pay && (
            <Card
              title="Cari hareketler"
              action={
                <Link href={`/personel/${id}?donem=${period}${showVoided ? "" : "&iptal=1"}`} className="text-[13px] font-semibold text-brand-700">
                  {showVoided ? "İptal edilenleri gizle" : `İptal / silinenleri göster (${voided.length})`}
                </Link>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[640px]">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-2 px-1.5 font-semibold border-b border-line">Tarih</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line">Hareket</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line">Kanal</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line text-right">Tutar</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line text-right">Kalan</th>
                      <th className="py-2 px-1.5 border-b border-line"><span className="sr-only">İşlem</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const credit = ["ACCRUAL", "BONUS", "OVERTIME"].includes(r.type);
                      return (
                        <tr key={r.id}>
                          <td className="num py-2.5 px-1.5 border-b border-[#EEF2F6] text-muted">{formatDate(r.date)}</td>
                          <td className="py-2.5 px-1.5 border-b border-[#EEF2F6]">
                            {TYPE_LABEL[r.type]}
                            {noteById.get(r.id) && <><br /><span className="text-xs text-muted">{noteById.get(r.id)}</span></>}
                          </td>
                          <td className="py-2.5 px-1.5 border-b border-[#EEF2F6]"><ChannelChip channel={r.channel} credit={credit} /></td>
                          <td className={`num py-2.5 px-1.5 border-b border-[#EEF2F6] text-right font-semibold ${credit ? "text-ok" : ""}`}>{credit ? "+" : "−"}{formatTL(r.amount)}</td>
                          <td className="num py-2.5 px-1.5 border-b border-[#EEF2F6] text-right">{formatTL(r.balanceAfter)}</td>
                          <td className="py-2.5 px-1.5 border-b border-[#EEF2F6] text-right">
                            <Link href={`/personel/${id}/hareket/${r.id}`} className="text-xs font-semibold text-brand-700">Düzenle / sil</Link>
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Bu dönemde hareket yok.</td></tr>}
                    {showVoided && voided.map((r) => (
                      <tr key={r.id} className="text-muted line-through decoration-[#B42318]/50">
                        <td className="num py-2 px-1.5 border-b border-[#EEF2F6]">{formatDate(r.entry_date)}</td>
                        <td className="py-2 px-1.5 border-b border-[#EEF2F6] no-underline">{TYPE_LABEL[r.type]}<br /><span className="text-xs">{r.void_reason}</span></td>
                        <td className="py-2 px-1.5 border-b border-[#EEF2F6]">{r.channel === "BANK" ? "Banka" : r.channel === "CASH" ? "Elden" : "—"}</td>
                        <td className="num py-2 px-1.5 border-b border-[#EEF2F6] text-right">{formatTL(Number(r.amount))}</td>
                        <td className="py-2 px-1.5 border-b border-[#EEF2F6]" colSpan={2}>iptal {formatDate(r.voided_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {pay && (
            <Card title="Ücret geçmişi" action={<Link href={`/personel/${id}/zam`} className="text-[13px] font-semibold text-brand-700">+ Zam / ücret değişikliği</Link>}>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[600px]">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-2 px-1.5 font-semibold border-b border-line">Geçerlilik</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line text-right">Toplam net</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line text-right">Artış</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line">Sigorta</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line">Açıklama</th>
                      <th className="py-2 px-1.5 border-b border-line"><span className="sr-only">İşlem</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(contracts ?? []).map((c, i) => {
                      const prev = c.previous_total_net ? Number(c.previous_total_net) : null;
                      const inc = prev !== null ? Number(c.total_net) - prev : null;
                      return (
                        <tr key={c.id}>
                          <td className="num py-2.5 px-1.5 border-b border-[#EEF2F6]">{formatDate(c.valid_from)}{c.valid_to ? ` – ${formatDate(c.valid_to)}` : " →"}</td>
                          <td className="num py-2.5 px-1.5 border-b border-[#EEF2F6] text-right font-semibold">{formatTL(Number(c.total_net))}</td>
                          <td className="num py-2.5 px-1.5 border-b border-[#EEF2F6] text-right text-ok">{inc !== null && prev ? `+${formatTL(inc)} (%${Math.round((inc / prev) * 1000) / 10})` : "—"}</td>
                          <td className="py-2.5 px-1.5 border-b border-[#EEF2F6]">{c.insurance_type === "MIN_WAGE" ? "Asgari ücret" : `Net ${formatTL(Number(c.fixed_official_net))}`}{Number(c.bes_rate) > 0 ? " · BES" : ""}</td>
                          <td className="py-2.5 px-1.5 border-b border-[#EEF2F6] text-muted">{c.change_reason ?? ""}</td>
                          <td className="py-2.5 px-1.5 border-b border-[#EEF2F6] text-right">
                            {i === 0 && (
                              <form action={deleteContract}>
                                <input type="hidden" name="id" value={c.id} />
                                <input type="hidden" name="employeeId" value={id} />
                                <button className="text-xs font-semibold text-bad">Kaydı sil</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {(contracts ?? []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Ücret kaydı yok.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted">Yanlış girilen son ücret kaydı silinebilir; bir önceki kayıt yeniden geçerli olur. Hakedişi yazılmış dönemler kendiliğinden değişmez.</p>
            </Card>
          )}
        </div>

        <aside className="flex-[1_1_340px] min-w-0 flex flex-col gap-5">
          {hr && (
            <Card title="Kişisel bilgiler" action={<Link href={`/personel/${id}/duzenle`} className="text-[13px] font-semibold text-brand-700">Düzenle</Link>}>
              {INFO.map((sec) => (
                <div key={sec.title} className="flex flex-col gap-1.5">
                  <h3 className="text-xs uppercase tracking-wider text-muted font-semibold mt-1">{sec.title}</h3>
                  <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-1 text-[13px]">
                    {sec.items.map(([label, key, fmt]) => (
                      <div key={key} className="contents">
                        <dt className="text-muted">{label}</dt>
                        <dd className="num break-words">{val(key, fmt) || <span className="text-[#9AA6B2]">—</span>}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
              {e.notes && <p className="text-[13px] bg-[#F7F9FB] rounded-lg p-3 whitespace-pre-line">{e.notes}</p>}
            </Card>
          )}

          <Card title="Özlük dosyası" action={<span className="num text-xs text-muted">Zorunlu: {required.length - missing} / {required.length}</span>}>
            {types.map((d) => {
              const files = docsByType.get(d.id) ?? [];
              return (
                <div key={d.id} className="flex flex-col gap-1.5 pb-2.5 border-b border-[#EEF2F6] last:border-0">
                  <div className="flex gap-2.5 items-center text-[13px]">
                    <span aria-hidden className={`w-2.5 h-2.5 rounded-full shrink-0 ${files.length ? "bg-[#1E7A4C]" : d.required ? "bg-[#B42318]" : "bg-[#C5D0DC]"}`} />
                    <span className="flex-1">{d.name}{!d.required && <span className="text-muted"> (isteğe bağlı)</span>}</span>
                  </div>
                  {files.map((f) => (
                    <div key={f.id} className="flex gap-2 items-center pl-5 text-xs">
                      <a href={signed.get(f.id) ?? "#"} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold truncate flex-1">{f.file_name ?? "Dosya"}</a>
                      {f.expires_on && <span className="text-muted num">bitiş {formatDate(f.expires_on)}</span>}
                      {hr && (
                        <form action={deleteDocument}>
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="employeeId" value={id} />
                          <button className="text-bad font-semibold" aria-label={`${d.name} dosyasını sil`}>Sil</button>
                        </form>
                      )}
                    </div>
                  ))}
                  {hr && (
                    <form action={uploadDocument} className="flex flex-wrap gap-2 items-center pl-5">
                      <input type="hidden" name="employeeId" value={id} />
                      <input type="hidden" name="typeId" value={d.id} />
                      <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.heic" aria-label={`${d.name} yükle`} className="text-xs max-w-48" />
                      {d.has_expiry && <input type="date" name="expires_on" aria-label="Geçerlilik bitişi" className="h-8 rounded-md border border-[#D5DEE8] px-2 text-xs" />}
                      <button className="h-8 px-3 rounded-md border border-[#D5DEE8] text-xs font-semibold text-brand-700">Yükle</button>
                    </form>
                  )}
                </div>
              );
            })}
          </Card>
        </aside>
      </div>
    </div>
  );
}
