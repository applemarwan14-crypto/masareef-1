// دالة الخادم التي يستدعيها اختصار الآيفون عند وصول رسالة من البنك أو أبشر.
// POST https://<project>.supabase.co/functions/v1/sms   body: {"token": "...", "message": "..."}
// تقرأ الرسالة بـ Claude (وإن لم يرد فبالقارئ المحلي) ثم تسجّلها، والإشعار يصل من التطبيق نفسه.

import { claude, parseSmsWithClaude } from '../_shared/claude.ts';
import { rateToSar } from '../_shared/fx.ts';
import { buildExpense, decide, renewalDueDate } from '../_shared/pipeline.ts';
import { parseLocal } from '../_shared/sms-local.ts';
import { cors, riyadhToday, serviceClient } from '../_shared/supabase.ts';
import { maskSensitive, quickSkip, sha256 } from '../_shared/text.ts';
import type { ParsedSms } from '../_shared/types.ts';

const reply = (text: string, status = 200) =>
  new Response(text, { status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });

/** يقبل JSON (حتى لو دخلت مسافات في أسماء الحقول من كيبورد الآيفون) أو نصاً عادياً مع ?token= */
async function readBody(req: Request): Promise<{ token: string | null; message: string | null }> {
  const url = new URL(req.url);
  const raw = await req.text();
  let token = url.searchParams.get('token') ?? req.headers.get('x-sms-token');
  let message: string | null = null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const key = k.trim().toLowerCase();
      if (key === 'token' && typeof v === 'string') token = v;
      if ((key === 'message' || key === 'text' || key === 'body') && typeof v === 'string') message = v;
    }
  } catch {
    message = raw;
  }
  return { token: token?.trim() || null, message: message?.trim() || null };
}

function looksValid(p: ParsedSms | null): p is ParsedSms {
  return Boolean(p && typeof p.kind === 'string' && 'amount' in p);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply('POST only', 405);

  const { token, message } = await readBody(req);
  if (!token || !message) return reply('أرسل token و message', 400);
  if (message.length > 2000) return reply('تجاهل: الرسالة طويلة');

  const db = serviceClient();
  const { data: owner } = await db.from('sms_tokens').select('user_id, household_id').eq('token', token).maybeSingle();
  if (!owner) return reply('رمز غير صحيح', 401);
  const user = owner.user_id as string;
  const household = owner.household_id as string;

  const hash = await sha256(`${user}|${message}`);
  const { data: seen } = await db.from('sms_messages').select('id').eq('hash', hash).maybeSingle();
  if (seen) return reply('مسجّلة مسبقاً');

  const today = riyadhToday();
  const masked = maskSensitive(message);
  const log = (status: string, reason: string | null, parser: string | null, parsed: unknown) =>
    db.rpc('log_sms', {
      p_user: user, p_household: household, p_hash: hash, p_body: masked,
      p_status: status, p_reason: reason, p_parser: parser, p_parsed: parsed,
    });

  // رموز التحقق والمرفوضة والمستردة لا تُرسل لـ Claude أصلاً
  const skip = quickSkip(message);
  if (skip) {
    await log('ignored', skip, null, null);
    return reply(`تجاهل: ${skip}`);
  }

  const { data: cats } = await db.from('categories').select('name')
    .eq('household_id', household).eq('is_archived', false).order('sort_order');
  const names = (cats ?? []).map((c) => c.name as string);

  let parsed: ParsedSms;
  let parser: 'claude' | 'local' = 'claude';
  try {
    if (!claude()) throw new Error('no api key');
    const result = await parseSmsWithClaude(masked, names, today);
    if (!looksValid(result)) throw new Error('invalid shape');
    parsed = result;
  } catch (e) {
    console.warn('Claude parse failed, using local parser:', (e as Error).message);
    parsed = parseLocal(masked, names, today);
    parser = 'local';
  }

  const failed = async (reason: string) => {
    await log('failed', reason, parser, parsed);
    await db.rpc('notify', {
      p_household: household, p_users: [user], p_kind: 'sms_failed', p_title: 'رسالة ما انسجلت',
      p_body: `${reason}: «${masked.replace(/\s+/g, ' ').slice(0, 90)}…» افتح سجل الرسائل وأضفها يدوياً.`,
      p_data: { url: '#/sms' }, p_dedupe: `smsfail-${hash.slice(0, 20)}`,
    });
    return reply(`ما انسجلت: ${reason}`);
  };

  const decision = decide(parsed);
  if (decision.action === 'ignore') {
    await log('ignored', decision.reason, parser, parsed);
    return reply(`تجاهل: ${decision.reason}`);
  }
  if (decision.action === 'failed') return await failed(decision.reason);

  if (decision.action === 'renewal') {
    const { data, error } = await db.rpc('sms_add_renewal', {
      p_user: user, p_household: household, p_hash: hash, p_body: masked, p_parser: parser, p_parsed: parsed,
      p_renewal: decision.renewal, p_expense: null,
    });
    if (error) return await failed('تعذّر حفظ التجديد');
    return reply(data?.status === 'added' ? `تم حفظ ${decision.renewal.title}: ${decision.renewal.due_date}` : 'التجديد محفوظ مسبقاً');
  }

  // ---------- عملية مصروف ----------
  let cardId: string | null = null;
  if (parsed.card_last4) {
    const { data } = await db.rpc('upsert_card_from_sms', {
      p_user: user, p_household: household, p_bank: parsed.bank, p_last4: parsed.card_last4,
      p_type: parsed.card_type, p_network: parsed.card_network,
    });
    cardId = (data as string | null) ?? null;
  }
  const currency = (parsed.currency ?? 'SAR').toUpperCase();
  const rate = currency !== 'SAR' && !parsed.sar_amount ? await rateToSar(db, currency, today) : null;
  const built = buildExpense(parsed, { rate, cardId });
  if (!built.ok) return await failed(built.reason);

  const { data: res, error } = await db.rpc('ingest_sms_expense', {
    p_user: user, p_household: household, p_hash: hash, p_body: masked, p_parser: parser,
    p_parsed: parsed, p_expense: built.expense,
  });
  if (error) {
    console.error('ingest failed', error);
    return await failed('خطأ في الحفظ');
  }
  if (res.status === 'duplicate') return reply('مسجّلة مسبقاً');

  // ضمان الجهاز، والتجديد المدفوع (مثل تأمين السيارة)
  if (parsed.is_device && res.amount >= 30000) {
    await db.rpc('add_warranty', { p_expense: res.expense_id });
  }
  const due = renewalDueDate(parsed.renewal);
  if (parsed.renewal && due) {
    await db.rpc('sms_add_renewal', {
      p_user: user, p_household: household, p_hash: hash, p_body: masked, p_parser: parser, p_parsed: parsed,
      p_renewal: { ...parsed.renewal, due_date: due, amount: res.amount }, p_expense: res.expense_id,
    });
  }

  const riyals = (res.amount / 100).toFixed(2).replace(/\.00$/, '');
  return reply(`تم تسجيل ${riyals} ر.س${res.merchant ? ` من ${res.merchant}` : ''} في ${res.category}`);
});
