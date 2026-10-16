import { FlashMessage } from "@/components/FlashMessage";

export const metadata = { title: "Tedarikçi", robots: { index: false, follow: false } };

/** Tedarikçi ekranları: ERP menüsü olmadan sade düzen */
export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-[#F4F7FA] print:bg-white">{children}<FlashMessage /></div>;
}
