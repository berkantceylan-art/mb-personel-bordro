"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPdksAgent, setPdksAgentActive } from "@/lib/pdks-agent-actions";

/** Yeni anahtar oluştur → ayar dosyasını indir (anahtar yalnız bu ekranda bir kez görünür) */
export function NewAgent({ origin }: { origin: string }) {
  const [name, setName] = useState("Ofis bilgisayarı");
  const [file, setFile] = useState("C:\\Program Files (x86)\\EromPDKS\\Bilgi Aktar ZK\\hareketler.txt");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function go() {
    setBusy(true); setErr(null);
    const r = await createPdksAgent(name);
    setBusy(false);
    if (!r.ok || !r.token) { setErr(r.message ?? "Oluşturulamadı"); return; }
    setToken(r.token); router.refresh();
  }
  function download() {
    if (!token) return;
    const cfg = { url: `${origin}/api/pdks/push`, token, dosya: file, aralik_dk: 5 };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" }));
    a.download = "ayar.json"; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex flex-col gap-3">
      {!token ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">Bilgisayar adı<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 w-56" /></label>
          <button type="button" onClick={go} disabled={busy} className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold disabled:opacity-50">{busy ? "…" : "Anahtar oluştur"}</button>
          {err && <span className="text-sm text-bad">{err}</span>}
        </div>
      ) : (
        <div className="rounded-xl border border-[#F2C38B] bg-[#FFF7ED] p-3 flex flex-col gap-2 text-sm">
          <p className="font-semibold">Anahtar oluşturuldu. Bu ekrandan çıkınca bir daha gösterilmez; ayar dosyasını şimdi indirin.</p>
          <label className="flex flex-col gap-1">Erom&apos;un okutmaları yazdığı dosya (tam yol)
            <input value={file} onChange={(e) => setFile(e.target.value)} className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 font-mono text-xs" />
          </label>
          <p className="text-xs text-muted">Varsayılan yol Erom&apos;un Bilgi Aktar ZK programının yazdığı dosyadır; gerekirse ayar.json içinde sonra da düzeltebilirsiniz.</p>
          <button type="button" onClick={download} className="h-10 px-4 self-start rounded-[10px] bg-brand-700 text-white text-sm font-semibold">⬇ ayar.json indir</button>
        </div>
      )}
    </div>
  );
}

export function ToggleAgent({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  return (
    <button type="button" onClick={async () => { if (active && !confirm("Bu bilgisayarın aktarımı durdurulsun mu?")) return; await setPdksAgentActive(id, !active); router.refresh(); }}
      className={`text-xs font-semibold ${active ? "text-bad" : "text-brand-700"}`}>{active ? "Durdur" : "Yeniden aç"}</button>
  );
}
