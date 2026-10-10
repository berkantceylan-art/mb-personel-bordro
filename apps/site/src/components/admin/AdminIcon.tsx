const P: Record<string, React.ReactNode> = {
  genel: <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" />,
  portal: <path d="M7 3c-2.2 0-4 1.8-4 4.5 0 2 .8 3.2 1.4 5 .6 2 .8 4.5 1.6 6.5.4 1 1.6 1.2 2 .2.6-1.6.9-4.2 2-4.2s1.4 2.6 2 4.2c.4 1 1.6.8 2-.2.8-2 1-4.5 1.6-6.5.6-1.8 1.4-3 1.4-5C21 4.8 19.2 3 17 3c-1.8 0-2.8 1-5 1S8.8 3 7 3z" />,
  icerik: <path d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01" />,
  kurumsal: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-5-6" />,
  sistem: <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4" />,
  favoriler: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  search: <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />,
  collapse: <path d="M15 6l-6 6 6 6M20 4v16" />,
  expand: <path d="M9 6l6 6-6 6M4 4v16" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  erp: <path d="M4 4h16v12H4zM8 20h8M12 16v4M8 9l2 2 4-4" />,
  site: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />,
};

export function AdminIcon({ name, className = "h-5 w-5", filled = false }: { name: string; className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name] ?? P.genel}
    </svg>
  );
}
