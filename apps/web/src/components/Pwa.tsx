"use client";
import { useEffect, useState } from "react";
import { removeWebPush, saveWebPush } from "@/lib/push-actions";

/** Service worker'ı kaydeder (bildirimler ve ana ekrana ekleme için) */
export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
const isMobile = () => typeof navigator !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

function b64ToUint8(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Telefonda, uygulama ana ekrana eklenmemişse nasıl ekleneceğini gösterir */
export function InstallHint() {
  const [show, setShow] = useState(false);
  const [bip, setBip] = useState<BIP | null>(null);
  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem("mb-install-dismissed") === "1"; } catch {}
    if (!dismissed && isMobile() && !isStandalone()) setShow(true);
    const h = (e: Event) => { e.preventDefault(); setBip(e as BIP); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  if (!show) return null;
  const close = () => { setShow(false); try { localStorage.setItem("mb-install-dismissed", "1"); } catch {} };
  return (
    <div className="md:hidden mx-4 mt-3 rounded-[14px] bg-brand-900 text-white p-4 flex gap-3 items-start">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="" className="w-11 h-11 rounded-[10px]" />
      <div className="flex-1 text-sm">
        <div className="font-semibold">Uygulama olarak ekleyin</div>
        {bip ? (
          <button onClick={async () => { await bip.prompt(); close(); }} className="mt-2 h-10 px-4 rounded-lg bg-accent font-semibold">Ana ekrana ekle</button>
        ) : isIos() ? (
          <p className="text-[#C9D6E5] mt-0.5">Safari&apos;de alttaki <b>Paylaş</b> simgesine (kare ve yukarı ok), sonra <b>Ana Ekrana Ekle</b>&apos;ye dokunun.</p>
        ) : (
          <p className="text-[#C9D6E5] mt-0.5">Tarayıcı menüsünden (⋮) <b>Ana ekrana ekle</b> / <b>Uygulamayı yükle</b>&apos;yi seçin.</p>
        )}
      </div>
      <button onClick={close} aria-label="Kapat" className="text-[#8FA6BF] text-xl leading-none px-1">×</button>
    </div>
  );
}

/** Telefon bildirimlerini açma düğmesi */
export function EnablePush({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<"loading" | "unsupported" | "ios-install" | "off" | "on" | "denied" | "busy">("loading");
  const [err, setErr] = useState<string | null>(null);
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
      }
      if (!key) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, [key]);

  async function enable() {
    setErr(null);
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(key!) }));
      const r = await saveWebPush(JSON.parse(JSON.stringify(sub)), navigator.userAgent);
      if (!r.ok) throw new Error(r.message);
      setState("on");
    } catch (e) {
      setErr((e as Error).message);
      setState("off");
    }
  }

  async function disable() {
    setState("busy");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await removeWebPush(sub.endpoint); await sub.unsubscribe(); }
    setState("off");
  }

  if (state === "loading" || state === "unsupported") return null;
  const box = compact ? "flex flex-wrap items-center gap-3 text-sm" : "flex flex-wrap items-center gap-3 text-sm bg-white border border-line rounded-[14px] p-4";
  return (
    <div className={box}>
      <span className="flex-1 min-w-48">
        {state === "on" && "🔔 Bu cihazda bildirimler açık."}
        {state === "off" && "Mesaj, duyuru ve onaylar telefonunuza bildirim olarak gelsin mi?"}
        {state === "busy" && "Bekleyin…"}
        {state === "denied" && "Bildirim izni reddedilmiş. Telefon ayarlarından bu uygulamaya bildirim izni verin."}
        {state === "ios-install" && "iPhone'da bildirim almak için önce uygulamayı ana ekrana ekleyin, sonra oradan açın."}
      </span>
      {state === "off" && <button onClick={enable} className="h-10 px-4 rounded-lg bg-brand-700 text-white font-semibold">Bildirimleri aç</button>}
      {state === "on" && <button onClick={disable} className="h-10 px-3 rounded-lg border border-[#D5DEE8] text-muted font-semibold">Kapat</button>}
      {err && <span className="w-full text-bad">{err}</span>}
    </div>
  );
}
