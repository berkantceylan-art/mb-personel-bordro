"use client";
import { removeWebPush } from "@/lib/push-actions";

/**
 * Çıkış: önce bu cihazın telefon bildirimi aboneliği silinir (ortak tablette önceki kişinin
 * bildirimleri gelmeye devam etmesin), sonra oturum kapatılır. En fazla 2 sn beklenir.
 */
export function SignOutForm({ className, buttonClassName }: { className?: string; buttonClassName: string }) {
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    if (form.dataset.done) return;
    e.preventDefault();
    const cleanup = (async () => {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await removeWebPush(sub.endpoint);
          await sub.unsubscribe();
        }
      } catch {
        /* bildirim yoksa sorun değil */
      }
    })();
    await Promise.race([cleanup, new Promise((r) => setTimeout(r, 2000))]);
    form.dataset.done = "1";
    form.submit();
  }
  return (
    <form action="/auth/signout" method="post" className={className} onSubmit={onSubmit}>
      <button className={buttonClassName}>Çıkış yap</button>
    </form>
  );
}
