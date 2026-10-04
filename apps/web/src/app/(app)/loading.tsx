/** Sayfa geçişlerinde gösterilen iskelet (telefonda boş ekran yerine) */
export default function Loading() {
  return (
    <div className="p-4 md:p-8 flex flex-col gap-4 max-w-[1240px] animate-pulse" aria-busy="true" aria-label="Yükleniyor">
      <div className="h-7 w-48 rounded-lg bg-[#E1E7EE]" />
      <div className="grid gap-3 md:gap-4 grid-cols-2 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-[14px] bg-white border border-line" />)}
      </div>
      <div className="h-72 rounded-[14px] bg-white border border-line" />
    </div>
  );
}
