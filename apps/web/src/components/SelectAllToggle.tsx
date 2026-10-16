"use client";

/** Aynı formdaki belirli addaki tüm onay kutularını seç / kaldır */
export function SelectAllToggle({ name, label = "Tümünü seç / kaldır" }: { name: string; label?: string }) {
  return (
    <button type="button" className="h-10 px-3 rounded-[10px] border border-line bg-white text-sm font-semibold text-brand-700"
      onClick={(e) => {
        const form = (e.currentTarget as HTMLButtonElement).closest("form");
        const boxes = [...(form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`) ?? [])];
        const on = boxes.some((b) => !b.checked);
        boxes.forEach((b) => { b.checked = on; });
      }}>{label}</button>
  );
}
