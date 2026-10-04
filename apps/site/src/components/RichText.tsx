/**
 * Admin panelinde yazılan sade metni gösterir:
 * boş satırla ayrılan paragraflar, "## " ara başlık, "> " alıntı, "- " madde listesi.
 * HTML yorumlanmaz (güvenli).
 */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  return (
    <div className={`grid gap-5 ${className}`}>
      {blocks.map((b, i) => {
        if (b.startsWith("## "))
          return (
            <h2 key={i} className="display mt-4 text-2xl font-semibold text-navy first:mt-0">
              {b.slice(3)}
            </h2>
          );
        if (b.split("\n").every((l) => /^[-•]\s+/.test(l.trim())))
          return (
            <ul key={i} className="grid gap-2 sm:grid-cols-2">
              {b.split("\n").map((l, j) => (
                <li key={j} className="flex gap-3 leading-relaxed text-ink/85">
                  <span aria-hidden="true" className="mt-[0.6em] h-2 w-2 shrink-0 rounded-full bg-smile" />
                  {l.trim().replace(/^[-•]\s+/, "")}
                </li>
              ))}
            </ul>
          );
        if (b.startsWith(">"))
          return (
            <blockquote key={i} className="border-l-4 border-smile py-1 pl-5 text-lg leading-relaxed text-navy">
              {b
                .split("\n")
                .map((l) => l.replace(/^>\s?/, ""))
                .join(" ")
                .replace(/^["“]|["”]$/g, "")}
            </blockquote>
          );
        return (
          <p key={i} className="leading-relaxed text-ink/85">
            {b.split("\n").map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {l}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
