"use client";
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="h-11 px-5 rounded-[10px] bg-[#0A3D73] text-white font-semibold">
      Yazdır / PDF olarak kaydet
    </button>
  );
}
