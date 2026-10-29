// الاتصال بـ Claude من دوال الخادم. المفتاح ANTHROPIC_API_KEY في أسرار Supabase فقط.

import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0';
import type { ParsedSms } from './types.ts';

export const MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-opus-5-5';

let client: Anthropic | null = null;
export function claude(): Anthropic | null {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  client ??= new Anthropic({ apiKey, maxRetries: 1 });
  return client;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const str = { type: 'string' };

/**
 * طلب واحد يعيد JSON مطابقاً للمخطط (structured outputs).
 * fallbacks: "default" — إذا رفض النموذج لسبب أمني يُعاد الطلب تلقائياً على نموذج بديل.
 */
export async function askJson<T>(opts: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort: 'low' | 'medium' | 'high';
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<T> {
  const c = claude();
  if (!c) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await c.beta.messages.create(
    {
      model: MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: opts.system,
      output_config: { effort: opts.effort, format: { type: 'json_schema', schema: opts.schema } },
      messages: [{ role: 'user', content: opts.user }],
    },
    { timeout: opts.timeoutMs ?? 30_000 },
  );
  if (res.stop_reason === 'refusal') throw new Error('Claude declined the request');
  if (res.stop_reason === 'max_tokens') throw new Error('Claude response was cut off');
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return JSON.parse(text) as T;
}

// ---------- قراءة رسالة البنك ----------

const SMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'amount', 'currency', 'sar_amount', 'merchant', 'date', 'card_last4', 'card_type', 'card_network',
    'bank', 'payment_method', 'country', 'category', 'is_device', 'renewal'],
  properties: {
    kind: { type: 'string', enum: ['purchase', 'bill', 'withdrawal', 'transfer_out', 'transfer_in', 'deposit', 'refund', 'declined', 'otp', 'renewal', 'info'] },
    amount: nullable({ type: 'number' }),
    currency: nullable(str),
    sar_amount: nullable({ type: 'number' }),
    merchant: nullable(str),
    date: nullable(str),
    card_last4: nullable(str),
    card_type: nullable({ type: 'string', enum: ['credit', 'debit', 'mada', 'prepaid'] }),
    card_network: nullable({ type: 'string', enum: ['visa', 'mastercard', 'mada', 'amex'] }),
    bank: nullable(str),
    payment_method: nullable({ type: 'string', enum: ['mada', 'apple_pay', 'pos', 'online', 'atm', 'sadad', 'transfer', 'other'] }),
    country: nullable(str),
    category: nullable(str),
    is_device: { type: 'boolean' },
    renewal: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'title', 'due_date', 'hijri_due', 'person'],
      properties: {
        kind: { type: 'string', enum: ['insurance', 'istimara', 'license', 'passport', 'iqama', 'national_id', 'subscription', 'rent', 'warranty', 'other'] },
        title: str,
        due_date: nullable(str),
        hijri_due: nullable({
          type: 'object', additionalProperties: false, required: ['year', 'month', 'day'],
          properties: { year: { type: 'integer' }, month: { type: 'integer' }, day: { type: 'integer' } },
        }),
        person: nullable(str),
      },
    }),
  },
};

const SMS_SYSTEM = `You read bank and government SMS messages for a Saudi family expense app and return one JSON object.
The message may be Arabic or English, from any Saudi bank (Al Rajhi, SNB, Riyad Bank, Alinma, Albilad, SAB, BSF, ANB, Aljazira, STC Bank, D360, urpay…) or from Absher / insurers.
Balances and account numbers were replaced with *** before you see the message; never treat *** as an amount.

kind:
- purchase: card/Apple Pay/POS/online payment to a merchant. bill: SADAD or a bill payment. withdrawal: ATM cash.
- transfer_out / transfer_in: transfers between accounts or people. deposit: salary or money received.
- refund: refunds or reversals. declined: failed, declined or insufficient-balance attempts. otp: verification codes.
- renewal: a document, insurance, subscription or rent that expires or must be renewed, with no money spent.
- info: anything else (ads, alerts).

Fields:
- amount: the charged amount in the transaction currency (number, no thousands separators). currency: ISO 4217 code (ريال/ر.س = SAR).
- sar_amount: only when the transaction is in a foreign currency and the message also states the amount in SAR; otherwise null.
- merchant: the merchant's well-known brand name, short and clean, with no branch numbers, city names, "*1234", ".COM", "CO", "LTD".
  Write famous Saudi/Gulf brands the way Saudis write them in Arabic (NOON.COM → نون, HUNGERSTATION → هنقرستيشن, DANUBE → الدانوب, AL BAIK → البيك, JAHEZ → جاهز, AMAZON → أمازون, STARBUCKS → ستاربكس).
  Keep international brands without a common Arabic name in Latin letters (e.g. "Booking.com" → Booking). For ATM use "سحب نقدي". For SADAD use the biller name.
- date: the transaction date as YYYY-MM-DD (Gregorian). Short dates like 25-10-29 are YY-MM-DD when the first part is the current two-digit year. Today is {TODAY}. null if absent.
- card_last4: last 4 digits of the card if shown. card_type: credit (ائتمانية), debit, mada (مدى), prepaid. card_network: visa, mastercard, mada, amex.
- bank: the bank's short Arabic name (الراجحي، الأهلي، بنك الرياض، الإنماء، البلاد، ساب، الفرنسي، العربي الوطني، الجزيرة، STC Bank، D360…), null if unknown.
- payment_method: apple_pay, mada, pos (in-person card), online (internet/e-commerce/in-app/subscription), atm, sadad, transfer, other.
- country: ISO 3166-1 alpha-2 of where the merchant is (SAU → SA, TUR → TR). Saudi merchants and SAR purchases without other hints are SA. Foreign online services (Netflix, Apple, Amazon.com) take their country but payment_method "online".
- category: pick exactly one name from this list that best fits the merchant, or null: {CATEGORIES}
- is_device: true only for buying an electronic device or home appliance (phones, laptops, TVs, air conditioners, fridges, washing machines…), e.g. at Apple Store, Extra, Jarir, Samsung.
- renewal: fill when the message is about something that expires or renews (Absher documents: رخصة القيادة license, استمارة istimara, جواز passport, إقامة iqama, هوية national_id; insurance policy; annual subscription; rent). Also fill it alongside a purchase when the purchase itself renews one of these (e.g. paying for car insurance or an istimara renewal), with the NEW expiry date if given.
  title: short Arabic title (e.g. "رخصة القيادة", "تأمين السيارة"). person: whose document if named, else null.
  If the date is Hijri (هـ, or a year like 1447), put it in hijri_due and leave due_date null. If Gregorian, put it in due_date (YYYY-MM-DD) and hijri_due null.

Use null for anything the message does not say. Never invent amounts.`;

export async function parseSmsWithClaude(masked: string, categories: readonly string[], today: string): Promise<ParsedSms> {
  return await askJson<ParsedSms>({
    system: SMS_SYSTEM.replace('{TODAY}', today).replace('{CATEGORIES}', categories.join('، ')),
    user: masked,
    schema: SMS_SCHEMA,
    effort: 'low',
    maxTokens: 4096,
    timeoutMs: 20_000,
  });
}
