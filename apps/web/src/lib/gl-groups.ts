/** Bilanço / gelir tablosu grup başlıkları (Tek Düzen Hesap Planı) */
export const GROUP: Record<string, string> = {
  "1": "I. DÖNEN VARLIKLAR", "2": "II. DURAN VARLIKLAR", "3": "III. KISA VADELİ YABANCI KAYNAKLAR", "4": "IV. UZUN VADELİ YABANCI KAYNAKLAR", "5": "V. ÖZKAYNAKLAR",
  "10": "A. Hazır Değerler", "11": "B. Menkul Kıymetler", "12": "C. Ticari Alacaklar", "13": "D. Diğer Alacaklar", "15": "E. Stoklar", "17": "F. Yıllara Yaygın İnşaat ve Onarım Maliyetleri", "18": "G. Gelecek Aylara Ait Giderler ve Gelir Tahakkukları", "19": "H. Diğer Dönen Varlıklar",
  "22": "A. Ticari Alacaklar", "23": "B. Diğer Alacaklar", "24": "C. Mali Duran Varlıklar", "25": "D. Maddi Duran Varlıklar", "26": "E. Maddi Olmayan Duran Varlıklar", "27": "F. Özel Tükenmeye Tabi Varlıklar", "28": "G. Gelecek Yıllara Ait Giderler ve Gelir Tahakkukları", "29": "H. Diğer Duran Varlıklar",
  "30": "A. Mali Borçlar", "32": "B. Ticari Borçlar", "33": "C. Diğer Borçlar", "34": "D. Alınan Avanslar", "35": "E. Yıllara Yaygın İnşaat ve Onarım Hakedişleri", "36": "F. Ödenecek Vergi ve Diğer Yükümlülükler", "37": "G. Borç ve Gider Karşılıkları", "38": "H. Gelecek Aylara Ait Gelirler ve Gider Tahakkukları", "39": "I. Diğer Kısa Vadeli Yabancı Kaynaklar",
  "40": "A. Mali Borçlar", "42": "B. Ticari Borçlar", "43": "C. Diğer Borçlar", "44": "D. Alınan Avanslar", "47": "E. Borç ve Gider Karşılıkları", "48": "F. Gelecek Yıllara Ait Gelirler ve Gider Tahakkukları", "49": "G. Diğer Uzun Vadeli Yabancı Kaynaklar",
  "50": "A. Ödenmiş Sermaye", "52": "B. Sermaye Yedekleri", "54": "C. Kâr Yedekleri", "57": "D. Geçmiş Yıllar Kârları", "58": "E. Geçmiş Yıllar Zararları (-)", "59": "F. Dönem Net Kârı (Zararı)",
};
export const gl_group_label = (c: string) => GROUP[c] ?? c;
