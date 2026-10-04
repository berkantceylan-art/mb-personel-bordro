import { NextResponse, type NextRequest } from "next/server";

/** Eski bağlantı: Garanti Emeklilik dosyasına yönlendirir */
export function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("donem") ?? "";
  return NextResponse.redirect(new URL(`/raporlar/bes-liste/excel${/^\d{4}-\d{2}$/.test(period) ? `?donem=${period}` : ""}`, req.url));
}
