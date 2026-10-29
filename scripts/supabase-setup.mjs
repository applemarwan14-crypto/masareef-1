// تجهيز مشروع Supabase تلقائياً من GitHub Actions (انظر .github/workflows/supabase.yml):
//  1. ينفّذ ملفات supabase/migrations التي لم تُنفَّذ بعد، كل ملف في معاملة واحدة، ويسجّلها.
//  2. يحفظ رابط المشروع في Vault (تحتاجه قاعدة البيانات لإيقاظ دالة الإشعارات).
//  3. ينشئ مفاتيح الإشعارات VAPID مرة واحدة ويحفظها في أسرار الدوال.
// يحتاج: SUPABASE_ACCESS_TOKEN و SUPABASE_URL. لا يطبع أي سرّ.

import { generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL ?? '';
const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1];
const dry = process.argv.includes('--dry-run');
if (!dry && (!token || !ref)) throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_URL are required');

async function api(path, init = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => api('/database/query', { method: 'POST', body: JSON.stringify({ query }) });
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();

if (dry) {
  console.log('migrations:', files.join(', '));
  console.log('vapid key sample length:', vapidKeys().publicKey.length);
  process.exit(0);
}

// ---------- 1) الملفات ----------
await sql(`
  create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
  alter table public._migrations enable row level security;
  revoke all on public._migrations from anon, authenticated;`);
let applied = new Set((await sql('select name from public._migrations')).map((r) => r.name));

if (applied.size === 0) {
  // مشروع قائم: الملفات 0001–0004 نُفّذت يدوياً من قبل
  const [state] = await sql(`select to_regclass('public.households') is not null as base,
                                    to_regclass('public.sms_tokens') is not null as sms`);
  const done = files.filter((f) => (state.base && f < '0002') || (state.sms && f < '0005'));
  if (done.length) {
    await sql(`insert into public._migrations (name) values ${done.map((f) => `(${lit(f)})`).join(',')} on conflict do nothing`);
    console.log(`already applied before: ${done.join(', ')}`);
    applied = new Set(done);
  }
}

for (const f of files) {
  if (applied.has(f)) continue;
  console.log(`applying ${f} …`);
  const body = readFileSync(join(dir, f), 'utf8');
  await sql(`begin;\n${body}\n;insert into public._migrations (name) values (${lit(f)});\ncommit;`);
  console.log(`✓ ${f}`);
}

// ---------- 2) رابط المشروع في Vault ----------
await sql(`select vault.create_secret(${lit(`https://${ref}.supabase.co`)}, 'project_url')
           where not exists (select 1 from vault.secrets where name = 'project_url')`);
console.log('✓ vault project_url');

// ---------- 3) مفاتيح الإشعارات ----------
function vapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
  return { publicKey: raw.toString('base64url'), privateKey: priv.d };
}

const names = new Set((await api('/secrets')).map((s) => s.name));
const toSet = [];
if (!names.has('VAPID_PUBLIC_KEY') || !names.has('VAPID_PRIVATE_KEY')) {
  const k = vapidKeys();
  toSet.push({ name: 'VAPID_PUBLIC_KEY', value: k.publicKey }, { name: 'VAPID_PRIVATE_KEY', value: k.privateKey });
}
if (!names.has('VAPID_SUBJECT')) {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '/').split('/');
  toSet.push({ name: 'VAPID_SUBJECT', value: `https://${owner}.github.io/${repo}/` });
}
if (toSet.length) {
  await api('/secrets', { method: 'POST', body: JSON.stringify(toSet) });
  console.log(`✓ secrets set: ${toSet.map((s) => s.name).join(', ')}`);
} else {
  console.log('✓ secrets already set');
}
