// تحويل التاريخ الهجري (تقويم أم القرى) إلى ميلادي.
// نقدّر اليوم بالتقويم الهجري الحسابي ثم نصحّحه بمقارنة تنسيق Intl لتقويم أم القرى.

const umalqura = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric',
});

export interface HijriDate { year: number; month: number; day: number }

export function toHijri(date: Date): HijriDate {
  const parts = umalqura.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value.replace(/\D/g, ''));
  return { year: get('year'), month: get('month'), day: get('day') };
}

const cmp = (a: HijriDate, b: HijriDate) => a.year - b.year || a.month - b.month || a.day - b.day;

/** هجري → ميلادي بصيغة YYYY-MM-DD، أو null إذا كان التاريخ غير صالح */
export function hijriToGregorian(year: number, month: number, day: number): string | null {
  if (!(year >= 1300 && year <= 1600 && month >= 1 && month <= 12 && day >= 1 && day <= 30)) return null;
  // التقويم الحسابي: رقم اليوم اليولياني
  const jd = day + Math.ceil(29.5 * (month - 1)) + (year - 1) * 354 + Math.floor((3 + 11 * year) / 30) + 1948439.5 - 1;
  const base = (jd - 2440587.5) * 86400000; // ← منتصف الليل UTC
  const target = { year, month, day };
  let best: Date | null = null;
  for (let off = -4; off <= 4; off++) {
    const d = new Date(base + off * 86400000);
    const h = toHijri(d);
    if (cmp(h, target) === 0) return d.toISOString().slice(0, 10);
    // اليوم 30 في شهر من 29 يوماً: أول يوم بعده
    if (cmp(h, target) > 0 && (!best || d < best)) best = d;
  }
  return best ? best.toISOString().slice(0, 10) : null;
}

/** يلتقط تاريخاً من النص: 1447/03/12 أو 12/03/1447 (هجري) أو 2026-05-01 أو 01/05/2026 (ميلادي) */
export function findDate(text: string): { iso: string; hijri: boolean } | null {
  const s = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const ymd = /(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/.exec(s);
  const dmy = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/.exec(s);
  const pick = ymd ? { y: +ymd[1]!, m: +ymd[2]!, d: +ymd[3]! } : dmy ? { y: +dmy[3]!, m: +dmy[2]!, d: +dmy[1]! } : null;
  if (!pick) return null;
  if (pick.y >= 1300 && pick.y <= 1600) {
    const iso = hijriToGregorian(pick.y, pick.m, pick.d);
    return iso ? { iso, hijri: true } : null;
  }
  if (pick.y >= 1900 && pick.y <= 2200 && pick.m >= 1 && pick.m <= 12 && pick.d >= 1 && pick.d <= 31) {
    const iso = `${pick.y}-${String(pick.m).padStart(2, '0')}-${String(pick.d).padStart(2, '0')}`;
    return Number.isNaN(Date.parse(iso)) ? null : { iso, hijri: false };
  }
  return null;
}
