// طلبات Claude من داخل التطبيق (بتسجيل دخول المستخدم):
//   organize       اقتراح تنظيم التصنيفات (للمنشئ) — التطبيق يعرضه ثم يطبّقه apply_category_plan
//   insights       ملاحظات على أرقام الشهر (الأرقام يحسبها التطبيق بدقة، Claude يكتب فقط)
//   renewal_parse  «تأمين السيارة ينتهي ١٥ رمضان» → تجديد جاهز للحفظ
//   fx             سعر صرف اليوم لعملة (للإضافة اليدوية بعملة أجنبية)

import { askJson, claude } from '../_shared/claude.ts';
import { rateToSar } from '../_shared/fx.ts';
import { renewalDueDate } from '../_shared/pipeline.ts';
import { cors, json, riyadhToday, serviceClient, userFromRequest } from '../_shared/supabase.ts';
import { sha256 } from '../_shared/text.ts';
import type { ParsedRenewal } from '../_shared/types.ts';

const ICONS = ['cart', 'food', 'coffee', 'bike', 'receipt', 'bag', 'car', 'fuel', 'broom', 'steering', 'home', 'power',
  'water', 'wifi', 'phone', 'tv', 'health', 'pill', 'school', 'books', 'baby', 'gift', 'clothes', 'beauty', 'travel',
  'sport', 'pet', 'repair', 'charity', 'circle'];
const COLORS = ['#0E6B58', '#2563EB', '#7C3AED', '#DB2777', '#C2410C', '#B45309', '#0891B2', '#475569', '#16A34A', '#DC2626', '#4F46E5', '#64748B'];
const LIMITS: Record<string, number> = { organize: 10, insights: 30, renewal_parse: 60 };

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = serviceClient();
  const me = await userFromRequest(req, db);
  if (!me) return json({ error: 'سجّل الدخول' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'طلب غير صالح' }, 400);
  }
  const action = String(body.action ?? '');

  if (action === 'fx') {
    const currency = String(body.currency ?? '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return json({ error: 'عملة غير صحيحة' }, 400);
    const rate = await rateToSar(db, currency, riyadhToday());
    return rate ? json({ currency, rate, date: riyadhToday() }) : json({ error: 'تعذّر جلب سعر الصرف' }, 502);
  }

  if (!(action in LIMITS)) return json({ error: 'إجراء غير معروف' }, 400);
  if (!claude()) return json({ error: 'ربط Claude غير مفعّل بعد (أضف ANTHROPIC_API_KEY في أسرار Supabase)' }, 503);
  const { data: allowed } = await db.rpc('ai_take_quota', { p_household: me.householdId, p_action: action, p_limit: LIMITS[action] });
  if (allowed === false) return json({ error: 'وصلتم الحد اليومي لهذا الطلب، جرّبوا بكرة' }, 429);

  try {
    if (action === 'organize') return json(await organize(db, me));
    if (action === 'insights') return json(await insights(db, me, body));
    return json(await parseRenewal(String(body.text ?? '')));
  } catch (e) {
    console.error(action, e);
    return json({ error: 'Claude ما رد، حاول بعد شوي' }, 502);
  }
});

// ---------- تنظيم التصنيفات ----------

type Db = ReturnType<typeof serviceClient>;
type Me = { id: string; householdId: string; role: string };

async function organize(db: Db, me: Me) {
  if (me.role !== 'owner') throw new Error('owner only');
  const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const [{ data: cats }, { data: exps }] = await Promise.all([
    db.from('categories').select('id,name,icon,is_pinned,is_archived,sort_order').eq('household_id', me.householdId).order('sort_order'),
    db.from('expenses').select('id,category_id,amount,merchant,description').eq('household_id', me.householdId)
      .gte('expense_date', since).limit(5000),
  ]);
  const active = (cats ?? []).filter((c) => !c.is_archived);
  const other = active.find((c) => c.name === 'مصاريف أخرى');

  const summary = active.map((c) => {
    const mine = (exps ?? []).filter((e) => e.category_id === c.id);
    const merchants = new Map<string, number>();
    for (const e of mine) {
      const m = e.merchant ?? e.description;
      if (m) merchants.set(m, (merchants.get(m) ?? 0) + 1);
    }
    return {
      id: c.id, name: c.name, pinned: c.is_pinned, count: mine.length,
      total_sar: Math.round(mine.reduce((a, e) => a + e.amount, 0) / 100),
      top_merchants: [...merchants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m]) => m),
    };
  });
  const uncategorized = (exps ?? []).filter((e) => e.category_id === other?.id && (e.merchant || e.description))
    .slice(0, 200).map((e) => ({ expense_id: e.id, merchant: e.merchant ?? e.description, sar: e.amount / 100 }));

  const schema = {
    type: 'object', additionalProperties: false,
    required: ['summary', 'changes', 'creates', 'renames', 'merges', 'moves', 'order'],
    properties: {
      summary: { type: 'string' },
      changes: { type: 'array', items: { type: 'string' } },
      creates: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['key', 'name', 'icon', 'color'],
        properties: { key: { type: 'string' }, name: { type: 'string' }, icon: { type: 'string', enum: ICONS }, color: { type: 'string', enum: COLORS } },
      } },
      renames: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'name'],
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      } },
      merges: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['from', 'to'],
        properties: { from: { type: 'string' }, to: { type: 'string' } },
      } },
      moves: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['expense_id', 'to'],
        properties: { expense_id: { type: 'string' }, to: { type: 'string' } },
      } },
      order: { type: 'array', items: { type: 'string' } },
    },
  };

  const plan = await askJson<Record<string, unknown> & { creates: { key: string }[] }>({
    system: `You tidy up the expense categories of a Saudi family budgeting app. Reply in Arabic for every human-readable string.
Goals, in order:
1. Move expenses from "مصاريف أخرى" into the category that clearly fits their merchant (moves). Skip anything unclear.
2. When 3 or more such expenses share a clear theme with no fitting category (e.g. pharmacies → "الصحة والصيدليات", schools → "التعليم"), create it (creates; at most 3; short names; pick an icon and color from the allowed lists; give each a key like "n1") and move them there using the key as "to".
3. Merge near-duplicate categories (merges: from → to). Only non-pinned categories may be a "from".
4. Rename unclear non-pinned categories (renames). Never rename pinned ones.
5. order: all active category ids (and new keys) sorted by yearly spending, high to low, with "مصاريف أخرى" last.
Be conservative: an empty change is better than a wrong one. Only use ids that appear in the input.
summary: one short Arabic sentence. changes: one short Arabic line per change, for the family to review before applying.`,
    user: JSON.stringify({ categories: summary, uncategorized_expenses: uncategorized }),
    schema,
    effort: 'medium',
    maxTokens: 16000,
    timeoutMs: 90_000,
  });

  // نتأكد أن المعرّفات موجودة فعلاً
  const ids = new Set(active.map((c) => c.id));
  const keys = new Set(plan.creates.map((c) => c.key));
  const expIds = new Set(uncategorized.map((e) => e.expense_id));
  const ok = (v: string) => ids.has(v) || keys.has(v);
  const pinned = new Set(active.filter((c) => c.is_pinned).map((c) => c.id));
  return {
    ...plan,
    renames: (plan.renames as { id: string }[]).filter((r) => ids.has(r.id) && !pinned.has(r.id)),
    merges: (plan.merges as { from: string; to: string }[]).filter((m) => ids.has(m.from) && !pinned.has(m.from) && ok(m.to) && m.from !== m.to),
    moves: (plan.moves as { expense_id: string; to: string }[]).filter((m) => expIds.has(m.expense_id) && ok(m.to)),
    order: (plan.order as string[]).filter(ok),
  };
}

// ---------- ملاحظات الشهر ----------

async function insights(db: Db, me: Me, body: Record<string, unknown>) {
  const month = String(body.month ?? '');
  if (!/^\d{4}-\d{2}-01$/.test(month)) throw new Error('bad month');
  const facts = JSON.stringify(body.facts ?? {});
  if (facts.length > 20000) throw new Error('facts too large');
  const hash = await sha256(facts);

  const { data: cached } = await db.from('ai_insights').select('facts_hash, notes')
    .eq('household_id', me.householdId).eq('month', month).maybeSingle();
  if (cached && cached.facts_hash === hash && !body.refresh) return cached.notes;

  const notes = await askJson({
    system: `You are a friendly, practical money coach for a Saudi family. Write in clear Arabic (light Saudi tone is fine).
You receive facts that the app already computed exactly. Use only those numbers, as given; never compute new totals or percentages yourself.
Write a one-sentence headline and 3 to 6 notes. Each note: a short title, one or two sentences, and a tone:
"good" for wins, "warn" for things to watch, "tip" for a concrete, doable suggestion. Mention merchants and categories by name.
Avoid generic advice and avoid judging. Amounts are in Saudi riyals (ر.س).`,
    user: facts,
    schema: {
      type: 'object', additionalProperties: false, required: ['headline', 'notes'],
      properties: {
        headline: { type: 'string' },
        notes: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['title', 'body', 'tone'],
          properties: { title: { type: 'string' }, body: { type: 'string' }, tone: { type: 'string', enum: ['good', 'warn', 'tip'] } },
        } },
      },
    },
    effort: 'medium',
    maxTokens: 8000,
    timeoutMs: 60_000,
  });

  await db.from('ai_insights').upsert({ household_id: me.householdId, month, facts_hash: hash, notes, created_at: new Date().toISOString() });
  return notes;
}

// ---------- التجديد بكتابة عادية ----------

async function parseRenewal(text: string) {
  if (!text.trim() || text.length > 500) throw new Error('bad text');
  const today = riyadhToday();
  const r = await askJson<ParsedRenewal & { amount: number | null; notes: string | null }>({
    system: `Turn a short Arabic or English note about something that expires or renews into one JSON object for a Saudi family app.
kind: insurance, istimara (vehicle registration), license (driving licence), passport, iqama, national_id, subscription, rent, warranty, other.
title: short Arabic title (e.g. "تأمين السيارة", "جواز سفر سارة", "اشتراك نتفلكس").
Dates: today is ${today} (Gregorian). If the note gives a Hijri date (month names like رمضان/شوال, or "هـ", or a year like 1447), fill hijri_due with year/month/day
(assume the nearest future Hijri year if the year is missing) and set due_date null. If Gregorian or relative ("بعد شهرين", "نهاية السنة"), compute due_date as YYYY-MM-DD and set hijri_due null.
person: whose it is if named. amount: renewal cost in SAR if mentioned, else null. notes: any other useful detail in Arabic, else null.`,
    user: text,
    schema: {
      type: 'object', additionalProperties: false,
      required: ['kind', 'title', 'due_date', 'hijri_due', 'person', 'amount', 'notes'],
      properties: {
        kind: { type: 'string', enum: ['insurance', 'istimara', 'license', 'passport', 'iqama', 'national_id', 'subscription', 'rent', 'warranty', 'other'] },
        title: { type: 'string' },
        due_date: nullable({ type: 'string' }),
        hijri_due: nullable({
          type: 'object', additionalProperties: false, required: ['year', 'month', 'day'],
          properties: { year: { type: 'integer' }, month: { type: 'integer' }, day: { type: 'integer' } },
        }),
        person: nullable({ type: 'string' }),
        amount: nullable({ type: 'number' }),
        notes: nullable({ type: 'string' }),
      },
    },
    effort: 'low',
    maxTokens: 4096,
    timeoutMs: 30_000,
  });
  return { ...r, due_date: renewalDueDate(r), hijri: r.hijri_due };
}
