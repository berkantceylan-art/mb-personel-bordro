export function PaySideSelect({ name = "pay_side", label = "Nereden ödensin / kesilsin" }: { name?: string; label?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-muted">
      {label}
      <select name={name} defaultValue="BOTH" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-ink">
        <option value="BOTH">Resmi + elden (ayrı ayrı)</option>
        <option value="OFFICIAL">Sadece resmi (bordroya)</option>
        <option value="CASH">Sadece elden</option>
      </select>
    </label>
  );
}
