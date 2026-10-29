import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

/** عميل بصلاحية الخدمة (يتجاوز RLS) — للاستخدام داخل دوال الخادم فقط */
export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** المستخدم من ترويسة Authorization (لدوال تُستدعى من التطبيق) */
export async function userFromRequest(req: Request, db: SupabaseClient) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return null;
  const { data: member } = await db.from('household_members').select('household_id, role')
    .eq('user_id', data.user.id).maybeSingle();
  return member ? { id: data.user.id, householdId: member.household_id as string, role: member.role as string } : null;
}

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

/** اليوم بتوقيت الرياض YYYY-MM-DD */
export const riyadhToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
