"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="no-print rounded-full border border-gypsum bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy">
      {label}
    </button>
  );
}
