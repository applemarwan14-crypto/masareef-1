// أدوات نصية مشتركة لقراءة رسائل البنك (تعمل في Deno وفي اختبارات Vitest)

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** يحوّل الأرقام العربية للاتينية، ويوحّد الفاصلة العشرية، ويزيل فواصل الآلاف */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
}

/**
 * يخفي ما لا يلزم Claude قبل الإرسال: الرصيد، الآيبان، أرقام الحسابات الطويلة.
 * آخر 4 أرقام من البطاقة تبقى لأنها تحدد البطاقة.
 */
export function maskSensitive(input: string): string {
  let s = normalizeDigits(input);
  // الرصيد بأشكاله: «الرصيد: 1234.50»، «رصيد متاح SAR 99»، «Avail Bal: SAR 1,234.56»
  s = s.replace(
    /((?:ال)?رصيد(?:\s*(?:ال)?(?:متاح|المتبقي|الحالي))?|(?:ال)?متاح|avail(?:able)?\.?\s*(?:bal(?:ance)?)?|bal(?:ance)?)(\s*[:：]?\s*(?:SAR|ر\.?\s?س|ريال)?\s*)-?\d+(?:\.\d+)?(\s*(?:SAR|ر\.?\s?س|ريال))?/giu,
    '$1$2***$3',
  );
  s = s.replace(/\bSA\d{2}[\d\s]{18,26}\b/gi, 'SA**********');
  s = s.replace(/\d{8,}/g, (m) => `****${m.slice(-4)}`);
  return s;
}

/** يزيل المسافات الزائدة ويقص النص */
export const clean = (s: string | null | undefined, max = 80): string | null => {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : null;
};

/** بصمة الرسالة لمنع تكرار تسجيلها */
export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** رسائل لا تحتاج قراءة: رموز التحقق، المرفوضة، المستردة */
export function quickSkip(message: string): string | null {
  const low = normalizeDigits(message).toLowerCase();
  if (/(otp|رمز التحقق|رمز التفعيل|رمز الدخول|كلمة المرور لمرة|verification code|one[- ]time|لا تشارك الرمز|do not share)/.test(low)) {
    return 'رمز تحقق';
  }
  if (/(مرفوض|رفض|declined|غير ناجح|لم تتم|لم يتم تنفيذ|insufficient|رصيد غير كاف)/.test(low)) return 'عملية مرفوضة';
  if (/(استرداد|استرجاع|مسترد|refund|reversal|عكس عملية|إلغاء عملية)/.test(low)) return 'مبلغ مسترد';
  return null;
}
