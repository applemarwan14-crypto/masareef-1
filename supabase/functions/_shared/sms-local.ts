// القارئ المحلي لرسائل البنك: يُستخدم إذا لم يرد Claude، حتى لا تضيع أي عملية.
// أقل ذكاءً من Claude لكنه يفهم صيغ البنوك السعودية الشائعة.

import { findDate } from './hijri.ts';
import { clean, normalizeDigits, quickSkip } from './text.ts';
import type { CardNetwork, CardType, ParsedRenewal, ParsedSms, PaymentMethod, RenewalKind, SmsKind } from './types.ts';

// ---------- العملات ----------
const CURRENCY_WORDS: [RegExp, string][] = [
  [/^(sar|ر\.?\s?س|رس|ريال(?: سعودي)?|rs)$/i, 'SAR'],
  [/^(usd|\$|دولار(?: أمريكي)?)$/i, 'USD'],
  [/^(eur|€|يورو)$/i, 'EUR'],
  [/^(gbp|£|جنيه استرليني|استرليني)$/i, 'GBP'],
  [/^(aed|درهم(?: إماراتي)?)$/i, 'AED'],
  [/^(try|tl|ليرة(?: تركية)?)$/i, 'TRY'],
  [/^(egp|جنيه(?: مصري)?)$/i, 'EGP'],
];
const ISO_CODES = 'SAR|USD|EUR|GBP|AED|KWD|BHD|QAR|OMR|EGP|JOD|TRY|CHF|JPY|CNY|INR|PKR|MYR|IDR|THB|SGD|AUD|CAD|GEL|AZN|MAD|LBP|CZK|SEK|NOK|DKK|PLN|HUF|LKR|PHP|KRW|ZAR|MVR|BAM|RUB';
// حدود الكلمة: «TRY» داخل «COUNTRY» و«رس» داخل «رسالة» ليست عملات
const CUR_TOKEN = `(?:\\b(?:${ISO_CODES})\\b|(?<![\\u0600-\\u06FF])(?:ر\\.?\\s?س|ريال(?: سعودي)?|دولار|يورو|درهم|ليرة|جنيه)(?![\\u0600-\\u06FF])|\\$|€|£)`;
const NUM = '(\\d+(?:\\.\\d{1,3})?)';

function currencyOf(token: string): string {
  const t = token.trim();
  for (const [re, code] of CURRENCY_WORDS) if (re.test(t)) return code;
  return t.toUpperCase();
}

interface Money { amount: number; currency: string; index: number; context: string }

function findMoney(s: string): Money[] {
  const out: Money[] = [];
  const before = new RegExp(`${CUR_TOKEN}\\s*[:：]?\\s*${NUM}`, 'giu');
  const after = new RegExp(`${NUM}\\s*${CUR_TOKEN}`, 'giu');
  for (const re of [before, after]) {
    for (const m of s.matchAll(re)) {
      const full = m[0];
      const num = Number(m[1]);
      const tokenText = full.replace(m[1]!, '').replace(/[:：\s]/g, '');
      if (!(num > 0)) continue;
      out.push({
        amount: num, currency: currencyOf(tokenText), index: m.index ?? 0,
        context: s.slice(Math.max(0, (m.index ?? 0) - 25), m.index ?? 0).toLowerCase(),
      });
    }
  }
  // «مبلغ: 45» بدون عملة → ريال
  if (!out.length) {
    const m = /(?:مبلغ|بمبلغ|بقيمة|amount|amt)\s*[:：]?\s*(\d+(?:\.\d{1,2})?)/i.exec(s);
    if (m) out.push({ amount: Number(m[1]), currency: 'SAR', index: m.index, context: '' });
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------- الدول ----------
const COUNTRY: Record<string, string> = {
  SAU: 'SA', KSA: 'SA', السعودية: 'SA', 'المملكة العربية السعودية': 'SA',
  ARE: 'AE', UAE: 'AE', الإمارات: 'AE', الامارات: 'AE', BHR: 'BH', البحرين: 'BH', KWT: 'KW', الكويت: 'KW',
  QAT: 'QA', قطر: 'QA', OMN: 'OM', عمان: 'OM', EGY: 'EG', مصر: 'EG', JOR: 'JO', الأردن: 'JO', الاردن: 'JO',
  TUR: 'TR', تركيا: 'TR', GBR: 'GB', UK: 'GB', بريطانيا: 'GB', USA: 'US', أمريكا: 'US', امريكا: 'US',
  FRA: 'FR', فرنسا: 'FR', DEU: 'DE', ألمانيا: 'DE', المانيا: 'DE', ITA: 'IT', إيطاليا: 'IT', ايطاليا: 'IT',
  ESP: 'ES', إسبانيا: 'ES', اسبانيا: 'ES', CHE: 'CH', سويسرا: 'CH', AUT: 'AT', النمسا: 'AT', NLD: 'NL', هولندا: 'NL',
  GEO: 'GE', جورجيا: 'GE', AZE: 'AZ', أذربيجان: 'AZ', MYS: 'MY', ماليزيا: 'MY', IDN: 'ID', إندونيسيا: 'ID',
  THA: 'TH', تايلاند: 'TH', MDV: 'MV', المالديف: 'MV', JPN: 'JP', اليابان: 'JP', MAR: 'MA', المغرب: 'MA',
  LBN: 'LB', لبنان: 'LB', BIH: 'BA', البوسنة: 'BA', SGP: 'SG', سنغافورة: 'SG', IND: 'IN', الهند: 'IN',
};
const CURRENCY_COUNTRY: Record<string, string> = {
  AED: 'AE', BHD: 'BH', KWD: 'KW', QAR: 'QA', OMR: 'OM', EGP: 'EG', JOD: 'JO', TRY: 'TR', GBP: 'GB',
  CHF: 'CH', JPY: 'JP', MYR: 'MY', IDR: 'ID', THB: 'TH', GEL: 'GE', AZN: 'AZ', MAD: 'MA', MVR: 'MV',
};

function findCountry(s: string): string | null {
  const m = /(?:دولة|الدولة|البلد|country)\s*[:：]?\s*([A-Za-z؀-ۿ ]{2,30}?)\s*(?:\n|$|,|،)/iu.exec(s);
  if (!m) return null;
  const v = m[1]!.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY[v.toUpperCase()] ?? COUNTRY[v] ?? null;
}

// ---------- المتجر ----------
const BRANDS: [RegExp, string][] = [
  [/noon/i, 'نون'], [/amazon|amzn/i, 'أمازون'], [/hunger\s?station/i, 'هنقرستيشن'], [/jahez/i, 'جاهز'],
  [/mrsool/i, 'مرسول'], [/to\s?you/i, 'ToYou'], [/keeta/i, 'كيتا'], [/the\s?chefz/i, 'ذا شفز'], [/ninja/i, 'نينجا'],
  [/danube/i, 'الدانوب'], [/panda/i, 'بنده'], [/othaim/i, 'العثيم'], [/carrefour/i, 'كارفور'], [/tamimi/i, 'التميمي'],
  [/lulu/i, 'لولو'], [/nesto/i, 'نستو'], [/starbucks/i, 'ستاربكس'], [/al\s?baik/i, 'البيك'], [/mcdonald/i, 'ماكدونالدز'],
  [/kudu/i, 'كودو'], [/herfy/i, 'هرفي'], [/barns/i, 'بارنز'], [/dunkin/i, 'دانكن'], [/netflix/i, 'نتفلكس'],
  [/shahid/i, 'شاهد'], [/spotify/i, 'سبوتيفاي'], [/apple\.com|itunes|icloud/i, 'Apple'], [/\bstc\b/i, 'STC'],
  [/mobily/i, 'موبايلي'], [/\bzain\b/i, 'زين'], [/careem/i, 'كريم'], [/\buber\b/i, 'أوبر'], [/extra/i, 'اكسترا'],
  [/jarir/i, 'جرير'], [/ikea/i, 'ايكيا'], [/aldrees/i, 'الدريس'], [/sasco/i, 'ساسكو'], [/petromin/i, 'بترومين'],
  [/nahdi/i, 'النهدي'], [/al\s?dawaa/i, 'صيدلية الدواء'], [/shein/i, 'شي إن'], [/namshi/i, 'نمشي'],
  [/centre\s?point|centrepoint/i, 'سنتربوينت'], [/saudi\s?electric|\bsec\b/i, 'شركة الكهرباء'],
];
const CITY = /\b(riyadh|jeddah|jiddah|dammam|khobar|makkah|mecca|madinah|medina|taif|abha|tabuk|buraydah|ksa|sa|sau)\b/gi;

export function prettyMerchant(raw: string | null): string | null {
  if (!raw) return null;
  for (const [re, name] of BRANDS) if (re.test(raw)) return name;
  const s = raw
    .replace(/\*+\s*\d*/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\.(com|sa|net)\b/gi, ' ')
    .replace(/\b(co|ltd|llc|est|company|trading|inc)\b\.?/gi, ' ')
    .replace(CITY, ' ')
    .replace(/[|_#]+/g, ' ');
  const v = clean(s, 60);
  if (!v) return null;
  // أحرف لاتينية كبيرة كلها → أول حرف كبير
  return /[a-z]/.test(v) || !/[A-Z]/.test(v) ? v : v.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function findMerchant(s: string): string | null {
  // قد تتكرر «من» (من حساب 0106* ثم من المتجر): نأخذ أول قيمة فيها حروف
  const patterns = [
    /(?:^|\n|\s)(?:من|لدى|عند|التاجر|المتجر|اسم التاجر|المفوتر|at|merchant|from)\s*[:：]?\s*([^\n]{2,60})/giu,
    /شراء\s+من\s+([^\n]{2,40}?)\s+(?:بمبلغ|مبلغ|بقيمة)/gu,
  ];
  for (const re of patterns) {
    for (const m of s.matchAll(re)) {
      const v = m[1]!.split(/\s+(?:بمبلغ|مبلغ|بقيمة|في|on|amount)\b/iu)[0]!.trim();
      if (/[\p{L}]{2,}/u.test(v.replace(/\b(?:sar|ريال)\b/giu, ''))) return v;
    }
  }
  return null;
}

// ---------- البطاقة والبنك ----------
function findCard(s: string): { last4: string | null; type: CardType | null; network: CardNetwork | null } {
  const low = s.toLowerCase();
  const m = /(?:\*{1,}|x{2,}|\.{2,}|#)\s*(\d{4})\b/i.exec(s) ?? /(?:بطاقة|البطاقة|card|مدى|ائتمانية)[^\d\n]{0,25}(\d{4})\b/iu.exec(s);
  const type: CardType | null = /(ائتمان|credit)/.test(low) ? 'credit' : /(مدى|mada)/.test(low) ? 'mada'
    : /(مسبقة|prepaid)/.test(low) ? 'prepaid' : /(خصم|debit)/.test(low) ? 'debit' : null;
  const network: CardNetwork | null = /(visa|فيزا)/.test(low) ? 'visa' : /(master|ماستر)/.test(low) ? 'mastercard'
    : /(amex|american express|أمريكان)/.test(low) ? 'amex' : /(مدى|mada)/.test(low) ? 'mada' : null;
  return { last4: m?.[1] ?? null, type, network };
}

const BANKS: [RegExp, string][] = [
  [/(الراجحي|rajhi)/i, 'الراجحي'], [/(الأهلي|الاهلي|snb|ncb|alahli)/i, 'الأهلي'], [/(بنك الرياض|riyad\s?bank)/i, 'بنك الرياض'],
  [/(الإنماء|الانماء|alinma)/i, 'الإنماء'], [/(البلاد|albilad)/i, 'البلاد'], [/(ساب|\bsab\b|sabb)/i, 'ساب'],
  [/(الفرنسي|bsf|fransi)/i, 'الفرنسي'], [/(العربي الوطني|\banb\b)/i, 'العربي الوطني'], [/(الجزيرة|aljazira|bank aljazira)/i, 'الجزيرة'],
  [/(stc\s?bank|stc\s?pay|اس تي سي)/i, 'STC Bank'], [/(d360|دال ثلاثمائة)/i, 'D360'], [/(urpay|يور باي)/i, 'urpay'],
  [/(الاستثمار|saib)/i, 'الاستثمار'], [/(tiqmo|تيقمو)/i, 'tiqmo'],
];
const findBank = (s: string) => BANKS.find(([re]) => re.test(s))?.[1] ?? null;

// ---------- التصنيف ----------
const CATEGORY_RULES: [RegExp, string][] = [
  [/(هنقر|hunger|جاهز|jahez|مرسول|mrsool|تويو|toyou|نينجا|ninja|كيتا|keeta|chefz|شفز)/i, 'تطبيقات التوصيل'],
  [/(دانوب|danube|بنده|panda|عثيم|othaim|كارفور|carrefour|تميمي|tamimi|لولو|lulu|نستو|nesto|ماركت|market|تموينات|سوبر|بقالة)/i, 'البقالة والسوبرماركت'],
  [/(كوفي|كافيه|قهوة|cafe|coffee|starbucks|ستاربكس|مطعم|restaurant|البيك|albaik|mcdonald|ماكدونالدز|kudu|كودو|herfy|هرفي|barns|بارنز|dunkin|دانكن|pizza|بيتزا|burger|برجر|شاورما|shawarma)/i, 'المطاعم والمقاهي'],
  [/(\bstc\b|mobily|موبايلي|\bzain\b|زين|كهرباء|electric|المياه|netflix|نتفلكس|shahid|شاهد|spotify|apple\.com|icloud|سداد|فاتورة|osn)/i, 'الفواتير والاشتراكات'],
  [/(بنزين|وقود|fuel|sasco|ساسكو|aldrees|الدريس|petromin|بترومين|محطة|مغسلة|car wash)/i, 'مصاريف السيارة'],
  [/(amazon|امازون|أمازون|noon|نون|shein|شي ان|ikea|ايكيا|extra|اكسترا|jarir|جرير|centrepoint|سنتربوينت|namshi|نمشي)/i, 'التسوق والمشتريات'],
];
export function guessCategory(text: string, names: readonly string[]): string | null {
  for (const [re, name] of CATEGORY_RULES) if (re.test(text) && names.includes(name)) return name;
  return names.includes('مصاريف أخرى') ? 'مصاريف أخرى' : null;
}

const DEVICE = /(apple store|extra|اكسترا|jarir|جرير|samsung|سامسونج|virgin megastore|eros|ساكو|\bsaco\b|\blg\b|sony|dyson|xiaomi|huawei|مكيف|ثلاجة|غسالة|لابتوب|laptop|iphone|ايفون)/i;

// ---------- التجديدات (أبشر وغيره) ----------
const DOCS: [RegExp, RenewalKind, string][] = [
  [/(رخصة (?:ال)?قيادة|رخصة السير|driving licen)/i, 'license', 'رخصة القيادة'],
  [/(استمارة|رخصة سير|vehicle registration)/i, 'istimara', 'استمارة السيارة'],
  [/(جواز|passport)/i, 'passport', 'جواز السفر'],
  [/(إقامة|اقامة|هوية مقيم|iqama|residen)/i, 'iqama', 'الإقامة'],
  [/(هوية وطنية|الهوية الوطنية|بطاقة الأحوال|national id)/i, 'national_id', 'الهوية الوطنية'],
  [/(تأمين|تامين|insurance|وثيقة)/i, 'insurance', 'التأمين'],
];

function findRenewal(s: string): ParsedRenewal | null {
  const doc = DOCS.find(([re]) => re.test(s));
  if (!doc || !/(تنتهي|انتهاء|ستنتهي|منتهي|صلاحية|تجديد|expir|valid until)/i.test(s)) return null;
  const date = findDate(s);
  return { kind: doc[1], title: doc[2], due_date: date?.iso ?? null, hijri_due: null, person: null };
}

// ---------- التاريخ ----------
function findTxDate(s: string, today: string): string | null {
  const full = findDate(s);
  if (full && !full.hijri) return full.iso;
  // 25-10-29 (سنة-شهر-يوم) أو 29/10/25 (يوم/شهر/سنة)
  const short = /\b(\d{2})[/\-.](\d{2})[/\-.](\d{2})\b/.exec(s);
  if (!short) return null;
  const yy = today.slice(2, 4);
  const [a, b, c] = [short[1]!, short[2]!, short[3]!];
  const iso = a === yy ? `20${a}-${b}-${c}` : c === yy ? `20${c}-${b}-${a}` : null;
  return iso && !Number.isNaN(Date.parse(iso)) ? iso : null;
}

// ---------- القراءة ----------
function kindOf(low: string, hasMoney: boolean): SmsKind {
  if (/(إيداع|ايداع|راتب|حوالة واردة|تحويل وارد|deposit|credited|incoming|استلام حوالة)/.test(low)) return 'deposit';
  if (/(حوالة صادرة|تحويل صادر|حوالة محلية|حوالة دولية|تحويل إلى|transfer to|outgoing transfer)/.test(low)) return 'transfer_out';
  if (/(سداد|sadad|دفع فاتورة)/.test(low)) return 'bill';
  if (/(سحب|atm|صراف|cash withdrawal)/.test(low)) return 'withdrawal';
  if (/(شراء|purchase|\bpos\b|نقاط البيع|apple pay|أبل باي|ابل باي|payment|مدفوعات|خصم)/.test(low) || hasMoney) return 'purchase';
  return 'info';
}

export function parseLocal(message: string, categoryNames: readonly string[], today: string): ParsedSms {
  const s = normalizeDigits(message);
  const low = s.toLowerCase();
  const base: ParsedSms = {
    kind: 'info', amount: null, currency: null, sar_amount: null, merchant: null, date: null,
    card_last4: null, card_type: null, card_network: null, bank: findBank(s), payment_method: null,
    country: null, category: null, is_device: false, renewal: null,
  };

  const skip = quickSkip(s);
  if (skip) return { ...base, kind: skip === 'رمز تحقق' ? 'otp' : skip === 'عملية مرفوضة' ? 'declined' : 'refund' };

  const money = findMoney(s).filter((m) => !/(رصيد|متاح|balance|bal)/.test(m.context));
  const renewal = findRenewal(s);
  if (renewal && !/(شراء|purchase|سداد|مبلغ)/.test(low)) return { ...base, kind: 'renewal', renewal };

  const kind = kindOf(low, money.length > 0);
  const foreign = money.find((m) => m.currency !== 'SAR');
  const sar = money.find((m) => m.currency === 'SAR');
  const card = findCard(s);
  const rawMerchant = findMerchant(s);
  const merchant = kind === 'withdrawal' ? 'سحب نقدي' : prettyMerchant(rawMerchant);
  const payment: PaymentMethod | null =
    /(apple pay|أبل باي|ابل باي)/.test(low) ? 'apple_pay'
    : /(انترنت|إنترنت|online|e-?commerce|internet)/.test(low) ? 'online'
    : kind === 'withdrawal' ? 'atm' : kind === 'bill' ? 'sadad' : kind === 'transfer_out' ? 'transfer'
    : /(مدى|mada)/.test(low) ? 'mada' : /(\bpos\b|نقاط البيع)/.test(low) ? 'pos' : kind === 'purchase' ? 'pos' : null;
  const country = findCountry(s) ?? (foreign ? CURRENCY_COUNTRY[foreign.currency] ?? null : sar ? 'SA' : null);
  const hay = `${rawMerchant ?? ''} ${merchant ?? ''} ${low}`;

  return {
    ...base,
    kind,
    amount: foreign?.amount ?? sar?.amount ?? null,
    currency: foreign?.currency ?? (sar ? 'SAR' : null),
    sar_amount: foreign && sar ? sar.amount : null,
    merchant,
    date: findTxDate(s, today),
    card_last4: card.last4,
    card_type: card.type,
    card_network: card.network,
    payment_method: payment,
    country,
    category: kind === 'withdrawal' ? (categoryNames.includes('مصاريف أخرى') ? 'مصاريف أخرى' : null) : guessCategory(hay, categoryNames),
    is_device: DEVICE.test(hay),
    renewal,
  };
}
