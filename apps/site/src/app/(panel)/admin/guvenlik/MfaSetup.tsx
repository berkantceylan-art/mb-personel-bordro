"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; friendly_name?: string; status: string; created_at: string };

/** TOTP (doğrulayıcı uygulama) kurulumu ve kaldırma */
export function MfaSetup() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await createClient().auth.mfa.listFactors();
    setFactors(((data?.all ?? []) as (Factor & { factor_type?: string })[]).filter((f) => f.factor_type === "totp"));
  }
  useEffect(() => {
    void load();
  }, []);

  async function start() {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    // Yarım kalmış (doğrulanmamış) kayıtları temizle
    for (const f of factors ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `MB Dental ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (error || !data) return setMsg({ ok: false, text: `Başlatılamadı: ${error?.message ?? ""}` });
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll) return;
    setBusy(true);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Kod hatalı. Uygulamadaki güncel kodu yazın." });
    setEnroll(null);
    setCode("");
    setMsg({ ok: true, text: "İki adımlı doğrulama açıldı. Sonraki girişlerde kod sorulacak." });
    void load();
  }

  async function remove(id: string) {
    if (!confirm("İki adımlı doğrulama kapatılsın mı?")) return;
    setBusy(true);
    const { error } = await createClient().auth.mfa.unenroll({ factorId: id });
    setBusy(false);
    setMsg(error ? { ok: false, text: `Kaldırılamadı: ${error.message} (önce kodla doğrulanmış oturum gerekir)` } : { ok: true, text: "Kapatıldı." });
    void load();
  }

  const verified = (factors ?? []).filter((f) => f.status === "verified");
  return (
    <div className="grid gap-4">
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</p>}
      {factors === null ? (
        <p className="text-sm text-slate">Yükleniyor…</p>
      ) : verified.length ? (
        <ul className="grid gap-2">
          {verified.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-ok-bg px-4 py-3 text-sm text-ok">
              <span className="font-semibold">Açık</span>
              <span>{f.friendly_name ?? "Doğrulayıcı"}</span>
              <button type="button" disabled={busy} onClick={() => remove(f.id)} className="ml-auto font-semibold text-bad">Kapat</button>
            </li>
          ))}
        </ul>
      ) : enroll ? (
        <form onSubmit={verify} className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="Doğrulayıcı QR kodu" className="h-44 w-44 rounded-xl border border-gypsum bg-white p-2" />
          <div className="grid gap-3">
            <p className="text-sm text-slate">1) Telefonda Google Authenticator / Microsoft Authenticator uygulamasıyla QR kodu okutun. Okutamazsanız anahtarı elle girin:</p>
            <code className="break-all rounded-lg bg-porcelain px-3 py-2 text-xs">{enroll.secret}</code>
            <p className="text-sm text-slate">2) Uygulamada görünen 6 haneli kodu yazın:</p>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={7} required className="field num w-40 text-center text-xl tracking-[0.3em]" />
            <button disabled={busy} className="w-fit rounded-full bg-navy px-5 py-2.5 font-semibold text-white disabled:opacity-60">Doğrula ve aç</button>
          </div>
        </form>
      ) : (
        <button type="button" disabled={busy} onClick={start} className="w-fit rounded-full bg-navy px-5 py-3 font-semibold text-white hover:bg-blue disabled:opacity-60">İki adımlı doğrulamayı aç</button>
      )}
    </div>
  );
}
