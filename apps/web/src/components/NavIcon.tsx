/** ERP menü ikonları (24px, çizgi) */
const P: Record<string, React.ReactNode> = {
  genel: <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" />,
  benim: <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM4 21a8 8 0 0 1 16 0" />,
  "insan-kaynaklari": <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-5-6" />,
  "puantaj-izin": <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
  "genel-muhasebe": <path d="M4 4h16v16H4zM4 9h16M9 9v11M13 13h4M13 16h4" />,
  "muhasebe-bordro": <path d="M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-3v3M16 13.5h.01" />,
  finans: <path d="M12 3v18M16.5 6.5C15.5 5 13.9 4.5 12 4.5c-2.5 0-4.5 1.3-4.5 3.3 0 4.6 9 2.4 9 7 0 2-2 3.4-4.5 3.4-2.2 0-3.9-.7-4.9-2.2" />,
  stok: <path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7.5 5l9 4" />,
  "alis-satis": <path d="M4 7h13l-3-3M20 17H7l3 3" />,
  satinalma: <path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 19.5a1 1 0 1 0 0 .01M17 19.5a1 1 0 1 0 0 .01" />,
  uretim: <path d="M3 21V10l5 3V10l5 3V10l5 3v8zM17 3h3v7h-3z" />,
  masraf: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />,
  yetki: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 8v5M12 16h.01" />,
  cari: <path d="M5 4h11l3 3v13H5zM9 9h6M9 13h6M9 17h3" />,
  laboratuvar: <path d="M7 3c-2.2 0-4 1.8-4 4.5 0 2 .8 3.2 1.4 5 .6 2 .8 4.5 1.6 6.5.4 1 1.6 1.2 2 .2.6-1.6.9-4.2 2-4.2s1.4 2.6 2 4.2c.4 1 1.6.8 2-.2.8-2 1-4.5 1.6-6.5.6-1.8 1.4-3 1.4-5C21 4.8 19.2 3 17 3c-1.8 0-2.8 1-5 1S8.8 3 7 3z" />,
  lojistik: <path d="M2 6h12v10H2zM14 9h4l4 4v3h-8M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
  demirbas: <path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8" />,
  "isg-uyum": <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" />,
  raporlar: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  "web-sitesi": <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />,
  sistem: <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4" />,
  favoriler: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  search: <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />,
  collapse: <path d="M15 6l-6 6 6 6M20 4v16" />,
  expand: <path d="M9 6l6 6-6 6M4 4v16" />,
  logout: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
};

export function NavIcon({ name, className = "w-5 h-5", filled = false }: { name: string; className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name] ?? P.genel}
    </svg>
  );
}
