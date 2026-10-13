"use client";
import { useState } from "react";
import { Capture } from "../../Capture";

const MODES = [
  { k: "docs", l: "Evrak", h: "Klasördeki tüm evraklar; sistem türünü kendisi tanır." },
  { k: "id", l: "Kimlik", h: "Nüfus cüzdanı önü ve arkası." },
  { k: "sgk", l: "SGK", h: "İşe giriş / işten ayrılış bildirgesi." },
  { k: "payslip", l: "Bordro", h: "Eski bordrolar; her ay bir fotoğraf. Onayı bilgisayardan yapılır." },
  { k: "leave", l: "İzin", h: "İzin formları ve raporlar. Onayı bilgisayardan yapılır." },
  { k: "exit", l: "Çıkış", h: "İstifa, ayrılış bildirgesi, ibraname." },
] as const;

export function PhoneCapture({ employeeId, companyId }: { employeeId: string; companyId: string }) {
  const [mode, setMode] = useState<(typeof MODES)[number]["k"]>("docs");
  const m = MODES.find((x) => x.k === mode)!;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-1.5">
        {MODES.map((x) => (
          <button key={x.k} type="button" onClick={() => setMode(x.k)} className={`h-12 rounded-[10px] font-semibold ${mode === x.k ? "bg-brand-700 text-white" : "bg-white border border-line text-[#33414F]"}`}>{x.l}</button>
        ))}
      </div>
      <Capture key={mode} employeeId={employeeId} companyId={companyId} mode={mode} title={`${m.l} çek`} hint={m.h} autoUpload big />
      <p className="text-xs text-muted">Belgeyi düz bir zemine koyun, ışık gelen yöne dikkat edin, sayfanın tamamı kadrajda olsun. Çekilenler birkaç saniye içinde bilgisayardaki sihirbaza düşer.</p>
    </div>
  );
}
