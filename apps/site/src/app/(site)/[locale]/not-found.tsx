import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-navy px-6 text-white">
      <div className="max-w-md text-center">
        <p className="display text-7xl font-semibold text-smile">404</p>
        <h1 className="display mt-4 text-3xl font-semibold">Bu sayfa bulunamadı</h1>
        <p className="mt-3 text-white/70">Adres değişmiş ya da sayfa kaldırılmış olabilir.</p>
        <Link href="/tr" className="mt-8 inline-block rounded-full bg-smile px-6 py-3 font-semibold text-navy hover:bg-white">
          Anasayfaya dön
        </Link>
      </div>
    </main>
  );
}
