"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCardRule, createPdksAgent, removeCardRule, setPdksAgentActive } from "@/lib/pdks-agent-actions";

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

/** Yok sayılacak / başka personele bağlanacak cihaz numaraları */
export function NewCardRule({ employees }: { employees: { id: string; name: string }[] }) {
  const [card, setCard] = useState("");
  const [action, setAction] = useState<"IGNORE" | "MAP">("IGNORE");
  const [emp, setEmp] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  async function go() {
    if (action === "IGNORE" && !confirm(`${card} numaralı kartın okutmaları bundan sonra hiç alınmayacak ve kimseye bağlı olmayan eski okutmaları silinecek. Devam edilsin mi?`)) return;
    setBusy(true); setMsg(null);
    const r = await addCardRule({ cardNo: card, action, employeeId: action === "MAP" ? emp : null, note });
    setBusy(false); setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setCard(""); setNote(""); setEmp(""); router.refresh(); }
  }

  const input = "h-10 rounded-[10px] border border-[#D5DEE8] px-3";
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1">Kart no<input value={card} onChange={(e) => setCard(e.target.value.replace(/\D/g, ""))} maxLength={12} inputMode="numeric" className={`${input} w-28 font-mono`} /></label>
      <label className="flex flex-col gap-1">İşlem
        <select value={action} onChange={(e) => setAction(e.target.value as "IGNORE" | "MAP")} className={input}>
          <option value="IGNORE">Hiç alma (personel değil)</option>
          <option value="MAP">Personele bağla</option>
        </select>
      </label>
      {action === "MAP" && (
        <label className="flex flex-col gap-1">Personel
          <select value={emp} onChange={(e) => setEmp(e.target.value)} className={`${input} w-56`}>
            <option value="">Seçin…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1">Not<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="ör. ziyaretçi kartı" className={`${input} w-48`} /></label>
      <button type="button" onClick={go} disabled={busy || !card || (action === "MAP" && !emp)} className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-50">{busy ? "…" : "Ekle"}</button>
      {msg && <span className={msg.ok ? "text-ok" : "text-bad"}>{msg.text}</span>}
    </div>
  );
}

export function RemoveCardRule({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button type="button" onClick={async () => { if (!confirm("Bu kural kaldırılsın mı? Silinmiş eski okutmalar geri gelmez; sonraki aktarımlarda bu kartın okutmaları yeniden alınır.")) return; await removeCardRule(id); router.refresh(); }}
      className="text-xs font-semibold text-bad">Kaldır</button>
  );
}
