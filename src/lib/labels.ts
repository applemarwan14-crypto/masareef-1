import type { CardType, NotificationKind, PaymentMethod, RenewalKind } from './types';

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['ar'], { type: 'region' });
  } catch {
    return null;
  }
})();

/** اسم الدولة بالعربي من رمزها (TR → تركيا) */
export const countryName = (code: string | null | undefined): string =>
  code ? (regionNames?.of(code.toUpperCase()) ?? code) : '';

/** علم الدولة من رمزها */
export const flag = (code: string | null | undefined): string =>
  code && /^[A-Za-z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : '';

export const CARD_TYPES: Record<CardType, string> = {
  credit: 'ائتمانية', debit: 'خصم', mada: 'مدى', prepaid: 'مسبقة الدفع', other: 'أخرى',
};

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  mada: 'مدى', apple_pay: 'Apple Pay', pos: 'نقاط البيع', online: 'إنترنت', atm: 'صراف', sadad: 'سداد',
  transfer: 'حوالة', other: 'أخرى',
};

export const RENEWAL_KINDS: Record<RenewalKind, string> = {
  insurance: 'تأمين', istimara: 'استمارة', license: 'رخصة قيادة', passport: 'جواز سفر', iqama: 'إقامة',
  national_id: 'هوية وطنية', subscription: 'اشتراك', rent: 'إيجار', warranty: 'ضمان', other: 'أخرى',
};

/** أنواع الإشعارات كما تظهر في الإعدادات (كلها مفعّلة افتراضياً) */
export const NOTIFICATION_KINDS: { kind: NotificationKind; label: string; hint: string }[] = [
  { kind: 'sms_added', label: 'مصروف من رسالة البنك', hint: '«تم إضافة مبلغ 83.78 ر.س من نون إلى مصاريف»' },
  { kind: 'family_expense', label: 'مصاريف العائلة', hint: 'لما يضيف أحد من العائلة مصروفاً' },
  { kind: 'budget', label: 'الميزانية', hint: 'عند 80% و100% من ميزانية الشهر' },
  { kind: 'recurring_due', label: 'موعد المصاريف الثابتة', hint: 'يوم استحقاق كل مصروف ثابت لم يُدفع' },
  { kind: 'month_summary', label: 'ملخص الشهر', hint: 'أول يوم من كل شهر' },
  { kind: 'sms_failed', label: 'رسالة ما انسجلت', hint: 'إذا وصلت رسالة شراء وما قدرنا نقرأها' },
  { kind: 'trip', label: 'الرحلات', hint: 'بداية الرحلة ونهايتها وميزانيتها' },
  { kind: 'renewal', label: 'التجديدات والضمانات', hint: 'قبل الموعد بأيام، والمستندات قبل شهر' },
  { kind: 'duplicate', label: 'الخصم المكرر', hint: 'نفس المبلغ من نفس المتجر مرتين خلال دقائق' },
  { kind: 'daily', label: 'التذكير اليومي', hint: 'كل يوم الساعة 9 الصبح' },
];

/** العملات الشائعة للإضافة اليدوية */
export const CURRENCIES = ['SAR', 'USD', 'EUR', 'GBP', 'AED', 'BHD', 'KWD', 'QAR', 'OMR', 'EGP', 'JOD', 'TRY', 'GEL', 'AZN',
  'MAD', 'MYR', 'IDR', 'THB', 'CHF', 'JPY', 'INR', 'MVR'] as const;
