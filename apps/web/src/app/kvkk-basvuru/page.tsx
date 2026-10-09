import type { Metadata } from "next";
import { PublicKvkkForm } from "./Form";

export const metadata: Metadata = { title: "KVKK başvurusu" };

/** Herkese açık KVKK başvuru formu (adaylar, eski çalışanlar, diğer ilgili kişiler) */
export default function PublicKvkkRequestPage() {
  return (
    <main className="min-h-dvh bg-[#F5F7FA] p-4 md:p-8">
      <div className="max-w-[640px] mx-auto bg-white border border-line rounded-2xl p-6 flex flex-col gap-4">
        <h1 className="font-display text-2xl font-bold text-brand-900">KVKK başvurusu</h1>
        <p className="text-sm text-muted">6698 sayılı Kanun md. 11 kapsamındaki haklarınız için başvurabilirsiniz. Başvurunuz en geç 30 gün içinde ücretsiz yanıtlanır. Kimliğinizi doğrulamak için sizinle iletişime geçebiliriz.</p>
        <PublicKvkkForm />
      </div>
    </main>
  );
}
