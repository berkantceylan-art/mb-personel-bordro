import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="bg-white border border-line rounded-2xl p-6 max-w-md text-center flex flex-col gap-3">
        <h1 className="font-display text-lg font-bold text-brand-800">Sayfa bulunamadı</h1>
        <p className="text-sm text-muted">Aradığınız kayıt silinmiş ya da bağlantı hatalı olabilir.</p>
        <Link href="/" className="h-11 px-4 inline-flex items-center justify-center rounded-[10px] bg-brand-700 text-white font-semibold">Ana sayfaya dön</Link>
      </div>
    </main>
  );
}
