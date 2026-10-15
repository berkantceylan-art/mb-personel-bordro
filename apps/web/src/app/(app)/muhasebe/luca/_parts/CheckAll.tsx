"use client";

/** Formdaki aktarılabilir fiş kutularının hepsini seç / bırak */
export function CheckAll({ label = "Tümünü seç" }: { label?: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm font-semibold">
      <input
        type="checkbox"
        defaultChecked
        onChange={(e) => {
          const form = e.currentTarget.closest("form");
          form?.querySelectorAll<HTMLInputElement>('input[name="id"]:not(:disabled)').forEach((x) => { x.checked = e.currentTarget.checked; });
        }}
      />
      {label}
    </label>
  );
}
