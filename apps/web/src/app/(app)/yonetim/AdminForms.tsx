"use client";
import { useActionForm } from "@/lib/use-action-form";
import { useState } from "react";
import { bulkInvites, createInvite, saveBranch } from "./actions";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full";
type R = { ok: boolean; message: string } | null;
const Msg = ({ s }: { s: R }) => (s ? <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${s.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{s.message}</span> : null);

export function InviteForm({ employees, isOwner }: { employees: Array<{ id: string; name: string }>; isOwner: boolean }) {
  const { state, pending, formProps: actionProps } = useActionForm(createInvite);
  const [role, setRole] = useState("employee");
  return (
    <form {...actionProps} className="grid gap-4 md:grid-cols-4 items-end">
      <label className="flex flex-col gap-1.5 text-sm text-muted">Rol
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={input}>
          <option value="employee">Personel (mobil uygulama)</option>
          <option value="branch_manager">Şube / bölüm sorumlusu</option>
          {isOwner && <option value="hr">İnsan kaynakları</option>}
          {isOwner && <option value="accountant">Muhasebe</option>}
          <option value="safety">İSG uzmanı / işyeri hekimi</option>
          {isOwner && <option value="owner">Şirket sahibi</option>}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Personel kaydı {role === "employee" ? "*" : "(varsa)"}
        <select name="employeeId" required={role === "employee"} className={input}>
          <option value="">—</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Görünen ad<input name="display_name" placeholder="Personelden gelir" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Giriş e-postası<input name="email" type="email" placeholder="Boşsa PDKS no ile" className={input} /></label>
      <div className="md:col-span-4 flex gap-3 items-center flex-wrap">
        <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Davet kodu oluştur</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function BulkInviteForm({ departments }: { departments: Array<{ id: string; name: string }> }) {
  const { state, pending, formProps: actionProps } = useActionForm(bulkInvites);
  return (
    <form {...actionProps} className="flex flex-wrap gap-3 items-end">
      <label className="flex flex-col gap-1.5 text-sm text-muted">Bölüm
        <select name="department_id" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white">
          <option value="">Tüm bölümler</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <button disabled={pending} className="h-11 px-5 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700 disabled:opacity-60">Hesabı olmayan herkese kod üret</button>
      <a href="/yazdir/davetler" target="_blank" className="h-11 px-5 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Davet listesini yazdır</a>
      <Msg s={state} />
    </form>
  );
}

export function BranchForm({ branch }: { branch?: { id: string; name: string; address: string | null; lat: number | null; lng: number | null; radius_m: number; mobile_punch_enabled: boolean } }) {
  const { state, pending, formProps: actionProps } = useActionForm(saveBranch);
  const [lat, setLat] = useState(branch?.lat?.toString() ?? "");
  const [lng, setLng] = useState(branch?.lng?.toString() ?? "");
  const [geoMsg, setGeoMsg] = useState("");
  const locate = () => {
    if (!navigator.geolocation) return setGeoMsg("Tarayıcı konum desteklemiyor.");
    setGeoMsg("Konum alınıyor…");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setGeoMsg(`Doğruluk ±${Math.round(p.coords.accuracy)} m`); },
      () => setGeoMsg("Konum izni verilmedi."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <form {...actionProps} className="grid gap-3 md:grid-cols-6 items-end">
      {branch && <input type="hidden" name="id" value={branch.id} />}
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Şube adı<input name="name" required defaultValue={branch?.name} className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-4">Adres<input name="address" defaultValue={branch?.address ?? ""} className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Enlem<input name="lat" value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Boylam<input name="lng" value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Yarıçap (m)<input name="radius_m" type="number" min={30} max={2000} defaultValue={branch?.radius_m ?? 150} className={input} /></label>
      <button type="button" onClick={locate} className="h-11 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">Şu anki konumumu kullan</button>
      <label className="flex gap-2 items-center text-sm h-11"><input type="checkbox" name="mobile_punch_enabled" defaultChecked={branch?.mobile_punch_enabled ?? true} className="w-5 h-5" />Mobil giriş açık</label>
      <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">{branch ? "Kaydet" : "Şube ekle"}</button>
      <div className="md:col-span-6 flex gap-3 items-center text-xs text-muted">{geoMsg}<Msg s={state} /></div>
    </form>
  );
}
