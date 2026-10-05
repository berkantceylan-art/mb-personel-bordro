import { deleteForever, moveToTrash, restoreFromTrash, setActive } from "@/lib/admin-actions";
import { ConfirmButton } from "./ConfirmButton";

const btn = "rounded-full border border-gypsum bg-white px-3 py-1 text-xs font-semibold text-slate hover:border-navy hover:text-navy";

export function RowActions({ table, id, active, trashed }: { table: "cms_slides" | "cms_announcements" | "cms_products" | "cms_stories" | "cms_pages" | "cms_cases" | "cms_faqs"; id: string; active: boolean; trashed: boolean }) {
  if (trashed) {
    return (
      <div className="flex flex-wrap gap-2">
        <form action={restoreFromTrash}>
          <input type="hidden" name="table" value={table} />
          <input type="hidden" name="id" value={id} />
          <button type="submit" className={btn}>
            Geri al
          </button>
        </form>
        <form action={deleteForever}>
          <input type="hidden" name="table" value={table} />
          <input type="hidden" name="id" value={id} />
          <ConfirmButton message="Bu kayıt ve dosyaları kalıcı olarak silinecek. Geri alınamaz. Devam edilsin mi?" className={`${btn} text-bad hover:border-bad hover:text-bad`}>
            Kalıcı sil
          </ConfirmButton>
        </form>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <form action={setActive}>
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="on" value={active ? "0" : "1"} />
        <button type="submit" className={btn}>
          {active ? "Yayından kaldır" : "Yayına al"}
        </button>
      </form>
      <form action={moveToTrash}>
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <button type="submit" className={btn}>
          Sil
        </button>
      </form>
    </div>
  );
}
