import Link from "next/link";
import { ADMIN_NAV } from "@/lib/admin-nav";
import { RailNav, TR_LABELS } from "../RailNav";
import { AdminIcon } from "./AdminIcon";

/** Site yönetimi menüsü (ortak RailNav üzerinde) */
export function AdminNav({ badges, email, showErp, signOut }: { badges: Record<string, number>; email: string; showErp: boolean; signOut: () => Promise<void> }) {
  return (
    <RailNav
      groups={ADMIN_NAV}
      root="/admin"
      homeHref="/admin"
      hubBase="/admin/modul"
      badges={badges}
      storageKey="mb-admin-nav-v1"
      brand="MB Dental · Site yönetimi"
      labels={{ ...TR_LABELS, placeholder: "Sayfa ara… (ör. blog, slayt, portal)" }}
      footer={
        <>
          {showErp && (
            <a href="/auth/erp" className="mb-2 flex items-center justify-between rounded-lg bg-navy px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue" title="Aynı oturumla ERP'ye geçin">
              <span className="flex items-center gap-2"><AdminIcon name="erp" className="h-4 w-4" /> ERP paneline geç</span>
              <span aria-hidden="true">↗</span>
            </a>
          )}
          <p className="truncate px-1">{email}</p>
          <div className="mt-1.5 flex gap-3 px-1">
            <Link href="/tr" target="_blank" className="hover:text-navy">Siteyi aç ↗</Link>
            <form action={signOut}><button type="submit" className="hover:text-bad">Çıkış</button></form>
          </div>
        </>
      }
    />
  );
}
