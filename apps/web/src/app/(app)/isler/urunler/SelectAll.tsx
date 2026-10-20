"use client";
/** Görünen tüm ürün kutucuklarını işaretler / kaldırır */
export function SelectAll() {
  return (
    <input type="checkbox" title="Görünenlerin hepsini seç" onChange={(e) => {
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="ids"][form="toplu"]').forEach((c) => { c.checked = e.target.checked; });
    }} />
  );
}
