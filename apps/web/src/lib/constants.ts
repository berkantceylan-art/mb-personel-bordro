export const PERSONNEL_DOMAIN = "personel.mbdental.app";

/** "ABCD2345EFGH" → "ABCD-2345-EFGH" (eski 6 haneli kodlar olduğu gibi) */
export const formatInviteCode = (c: string) => (c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}` : c);
