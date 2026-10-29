import { describe, expect, it } from 'vitest';
import { findDate, hijriToGregorian, toHijri } from './hijri.ts';
import { parseLocal, prettyMerchant } from './sms-local.ts';
import { maskSensitive, normalizeDigits, quickSkip } from './text.ts';

const CATS = ['البقالة والسوبرماركت', 'المطاعم والمقاهي', 'تطبيقات التوصيل', 'الفواتير والاشتراكات',
  'التسوق والمشتريات', 'مصاريف السيارة', 'مصاريف أخرى'];
const TODAY = '2025-10-29';

describe('normalizeDigits / mask', () => {
  it('converts Arabic digits and thousands separators', () => {
    expect(normalizeDigits('١٬٢٣٤٫٥٠')).toBe('1234.50');
    expect(normalizeDigits('SAR 1,234.56')).toBe('SAR 1234.56');
  });

  it('hides balances, IBANs and long account numbers', () => {
    const m = maskSensitive('مبلغ: 45 ريال\nالرصيد: ١٬٢٣٤٫٥٦ ريال\nAvail Bal: SAR 9,999.00\nحساب 1234567890123');
    expect(m).toContain('مبلغ: 45 ريال');
    expect(m).not.toMatch(/1234\.56|9999/);
    expect(m).toContain('****0123');
    expect(maskSensitive('الرصيد المتاح SAR 500')).toBe('الرصيد المتاح SAR ***');
  });

  it('skips OTP, declined and refunds', () => {
    expect(quickSkip('رمز التحقق 4821 لعملية شراء من AMAZON مبلغ 99 SAR. لا تشارك الرمز')).toBe('رمز تحقق');
    expect(quickSkip('عملية مرفوضة: رصيد غير كاف')).toBe('عملية مرفوضة');
    expect(quickSkip('تم استرداد مبلغ 50 ريال من نون')).toBe('مبلغ مسترد');
    expect(quickSkip('شراء عبر نقاط البيع\nمبلغ: 50 ريال')).toBeNull();
  });
});

describe('parseLocal', () => {
  it('Al Rajhi POS with Apple Pay', () => {
    const p = parseLocal('شراء عبر نقاط البيع\nبطاقة: 4321;مدى-أبل باي\nمن: DANUBE CO\nمبلغ: SAR 125.50\nفي: 25-10-29 14:22', CATS, TODAY);
    expect(p).toMatchObject({
      kind: 'purchase', amount: 125.5, currency: 'SAR', merchant: 'الدانوب', card_last4: '4321',
      payment_method: 'apple_pay', country: 'SA', category: 'البقالة والسوبرماركت', date: '2025-10-29',
    });
  });

  it('international online purchase with SAR equivalent', () => {
    const p = parseLocal('شراء إنترنت دولي\nبطاقة:**4321 ائتمانية\nمن:AMAZON.COM\nمبلغ:USD 25.00\nبسعر:SAR 93.75\nدولة:USA\n29/10/25 10:12', CATS, TODAY);
    expect(p).toMatchObject({
      kind: 'purchase', amount: 25, currency: 'USD', sar_amount: 93.75, merchant: 'أمازون',
      card_last4: '4321', card_type: 'credit', payment_method: 'online', country: 'US', date: '2025-10-29',
    });
  });

  it('foreign POS in Turkey (COUNTRY is not a currency)', () => {
    const p = parseLocal('شراء دولي\nبطاقة ائتمانية: **4321\nمن: STARBUCKS ISTANBUL\nمبلغ: 120.00 TRY\nدولة: TUR', CATS, TODAY);
    expect(p).toMatchObject({ amount: 120, currency: 'TRY', country: 'TR', merchant: 'ستاربكس', category: 'المطاعم والمقاهي' });
  });

  it('ignores balance amounts', () => {
    const p = parseLocal(maskSensitive('شراء\nبطاقة مدى *1234\nلدى: HUNGERSTATION\nمبلغ: 45.00 ريال\nالرصيد: 1,234.56 ريال'), CATS, TODAY);
    expect(p).toMatchObject({ amount: 45, merchant: 'هنقرستيشن', category: 'تطبيقات التوصيل', card_type: 'mada' });
  });

  it('English POS', () => {
    const p = parseLocal('PoS Purchase\nAmount: SAR 83.78\nCard: **5566\nAt: NOON.COM\nDate: 2025-10-29', CATS, TODAY);
    expect(p).toMatchObject({ kind: 'purchase', amount: 83.78, merchant: 'نون', card_last4: '5566', date: '2025-10-29' });
  });

  it('SADAD bill, ATM and deposit', () => {
    expect(parseLocal('سداد فاتورة\nالمفوتر: شركة الكهرباء\nمبلغ: 350 ريال', CATS, TODAY))
      .toMatchObject({ kind: 'bill', amount: 350, payment_method: 'sadad', category: 'الفواتير والاشتراكات' });
    expect(parseLocal('سحب صراف\nمبلغ: 500 ريال\nبطاقة: 1234', CATS, TODAY))
      .toMatchObject({ kind: 'withdrawal', amount: 500, merchant: 'سحب نقدي', payment_method: 'atm' });
    expect(parseLocal('إيداع راتب\nمبلغ: 15,000 ريال', CATS, TODAY).kind).toBe('deposit');
  });

  it('Absher renewal with Hijri date', () => {
    const p = parseLocal('عزيزي المواطن، نود إشعارك بأن رخصة القيادة الخاصة بكم ستنتهي بتاريخ 1447/09/01هـ. للتجديد عبر أبشر.', CATS, TODAY);
    expect(p.kind).toBe('renewal');
    expect(p.renewal).toMatchObject({ kind: 'license', title: 'رخصة القيادة' });
    expect(p.renewal!.due_date).toMatch(/^2026-02-1[78]$/);
  });

  it('skips «من» lines without a name (account number) — Al Rajhi online', () => {
    const p = parseLocal('شراء انترنت\nبـ238 SAR\nمن 0106*\nمن THE CHEFZ\nمدى-ابل *0253\nفي 29/10/26 21:25', CATS, '2026-10-29');
    expect(p).toMatchObject({ kind: 'purchase', amount: 238, merchant: 'ذا شفز', card_last4: '0253', category: 'تطبيقات التوصيل', date: '2026-10-29', payment_method: 'online' });
  });

  it('cleans unknown merchants', () => {
    expect(prettyMerchant('ALMARAI SHOP*8812 RIYADH')).toBe('Almarai Shop');
    expect(prettyMerchant('مطعم الرومانسية')).toBe('مطعم الرومانسية');
  });
});

describe('hijri', () => {
  it('round-trips Umm al-Qura dates', () => {
    const iso = hijriToGregorian(1447, 1, 1)!;
    expect(toHijri(new Date(`${iso}T00:00:00Z`))).toEqual({ year: 1447, month: 1, day: 1 });
    for (const [y, m, d] of [[1446, 9, 1], [1448, 12, 29], [1450, 6, 15]] as const) {
      const g = hijriToGregorian(y, m, d)!;
      expect(toHijri(new Date(`${g}T00:00:00Z`))).toEqual({ year: y, month: m, day: d });
    }
  });

  it('finds dates in text', () => {
    expect(findDate('تنتهي في ١٤٤٧/٠١/٠١')?.hijri).toBe(true);
    expect(findDate('valid until 2027-03-15')).toEqual({ iso: '2027-03-15', hijri: false });
    expect(findDate('15/03/2027')).toEqual({ iso: '2027-03-15', hijri: false });
  });
});
