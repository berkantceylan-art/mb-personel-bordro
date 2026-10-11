/** Modül yetki şablonları */
export const MODS = ["finance", "sales", "purchases", "stock", "production", "assets", "expenses", "users"] as const;

export const TEMPLATES: Record<string, { label: string; levels: Partial<Record<(typeof MODS)[number], number | null>> }> = {
  default: { label: "Rol varsayılanına dön", levels: Object.fromEntries(MODS.map((m) => [m, null])) },
  accounting: { label: "Muhasebe", levels: { finance: 3, sales: 3, purchases: 3, expenses: 3, assets: 3, stock: 2, production: 1, users: 0 } },
  sales: { label: "Satış / ön büro", levels: { finance: 1, sales: 2, purchases: 0, stock: 1, production: 1, assets: 0, expenses: 1, users: 0 } },
  warehouse: { label: "Satın alma / depo", levels: { finance: 0, sales: 0, purchases: 2, stock: 3, production: 1, assets: 1, expenses: 1, users: 0 } },
  technician: { label: "Teknisyen", levels: { finance: 0, sales: 0, purchases: 0, stock: 1, production: 2, assets: 0, expenses: 1, users: 0 } },
  chief: { label: "Üretim şefi", levels: { finance: 0, sales: 1, purchases: 1, stock: 2, production: 3, assets: 1, expenses: 1, users: 0 } },
  viewer: { label: "Yalnız görüntüleme", levels: { finance: 1, sales: 1, purchases: 1, stock: 1, production: 1, assets: 1, expenses: 1, users: 0 } },
};

