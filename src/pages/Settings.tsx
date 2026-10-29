import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  ArrowCounterClockwise, ArrowsClockwise, Bell, CaretLeft, FileText, ChatCircleText, Copy, Crown, MagicWand, PushPin, SignOut, Plus, Tag, Target,
  UserMinus, UsersThree,
} from '@phosphor-icons/react';
import { Button, Card, CategoryIcon, ConfirmButton, Field, IconButton, Sheet, cx } from '../components/ui';
import { useHousehold, useIsOwner } from '../hooks/household';
import {
  useCategories, useDeleteCategory, useDisabledKinds, useInvalidate, useSaveCategory, useSaveDisabledKinds, useSnapshots,
  useUpdateHousehold,
} from '../hooks/queries';
import {
  applyCategoryPlan, mySmsToken, regenerateInviteCode, regenerateSmsToken, removeMember, sendTestNotification, suggestOrganize,
  transferOwnership, undoCategoryPlan,
} from '../lib/api';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '../lib/icons';
import { NOTIFICATION_KINDS } from '../lib/labels';
import { formatSAR, parseAmount, toInputValue } from '../lib/money';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push';
import { supabase } from '../lib/supabase';
import type { Category, OrganizePlan } from '../lib/types';

export default function Settings() {
  return (
    <div className="space-y-5 pt-4">
      <h1 className="text-xl font-bold">الإعدادات</h1>
      <BudgetSection />
      <NotificationsSection />
      <SmsSection />
      <FamilySection />
      <CategoriesSection />
      <Link to="/statements" className="flex items-center gap-3 rounded-card bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] active:opacity-80">
        <FileText className="size-5 text-brand" weight="duotone" />
        <span className="flex-1">
          <span className="block font-bold">كشوفات البنك</span>
          <span className="text-xs text-muted">الكشوفات المرفوعة، منفصلة عن مصاريفك</span>
        </span>
        <CaretLeft className="size-4 text-muted" weight="bold" />
      </Link>
      <Button variant="ghost" className="w-full text-danger" onClick={() => supabase.auth.signOut()}>
        <SignOut className="size-5" weight="bold" /> تسجيل الخروج
      </Button>
    </div>
  );
}

const OwnerNote = () => <p className="mt-2 text-xs text-muted">التعديل لمنشئ العائلة فقط.</p>;

function BudgetSection() {
  const { household } = useHousehold();
  const owner = useIsOwner();
  const update = useUpdateHousehold();
  const [text, setText] = useState(household.monthly_budget ? toInputValue(household.monthly_budget) : '');
  const [salaryDay, setSalaryDay] = useState(String(household.salary_day));

  function submit(e: FormEvent) {
    e.preventDefault();
    const day = Number(salaryDay);
    if (!(day >= 1 && day <= 31)) return toast.error('يوم الراتب بين 1 و 31');
    if (text.trim() === '') return update.mutate({ monthly_budget: null, salary_day: day });
    const v = parseAmount(text);
    if (!v) return toast.error('أدخل مبلغاً صحيحاً');
    update.mutate({ monthly_budget: v, salary_day: day });
  }

  return (
    <Card>
      <h2 className="inline-flex items-center gap-2 font-bold"><Target className="size-5 text-brand" weight="duotone" />الميزانية الشهرية</h2>
      <p className="mt-1 text-sm text-muted">
        {household.monthly_budget ? `الحالية: ${formatSAR(household.monthly_budget)}` : 'لم تُحدَّد بعد. اتركها فارغة لإلغائها.'}
        {' '}مصاريف الرحلات خارجها.
      </p>
      <form onSubmit={submit} className="mt-4 grid grid-cols-[1fr_6rem_auto] items-end gap-2">
        <Field label="المبلغ (ر.س)" inputMode="decimal" dir="ltr" placeholder="مثال: 12000" disabled={!owner}
          value={text} onChange={(e) => setText(e.target.value)} />
        <Field label="يوم الراتب" inputMode="numeric" dir="ltr" disabled={!owner}
          value={salaryDay} onChange={(e) => setSalaryDay(e.target.value.replace(/\D/g, ''))} />
        <Button type="submit" loading={update.isPending} disabled={!owner}>حفظ</Button>
      </form>
      {!owner && <OwnerNote />}
    </Card>
  );
}

// ---------- الإشعارات ----------
const PUSH_HINT: Record<PushState, string> = {
  'needs-install': 'على الآيفون: افتح الموقع في Safari ← زر المشاركة ← «إضافة إلى الشاشة الرئيسية»، ثم افتح التطبيق من الشاشة الرئيسية وفعّل الإشعارات من هنا.',
  unsupported: 'هذا المتصفح لا يدعم الإشعارات.',
  'not-configured': 'إشعارات الجوال لم تُجهَّز بعد (مفتاح VAPID ناقص في إعدادات النشر).',
  denied: 'الإشعارات مرفوضة. فعّلها من إعدادات الجوال ← الإشعارات ← مصاريف البيت.',
  off: 'فعّلها لتوصلك الإشعارات حتى والتطبيق مقفول.',
  on: 'مفعّلة على هذا الجهاز.',
};

function NotificationsSection() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: disabled = [] } = useDisabledKinds();
  const saveKinds = useSaveDisabledKinds();

  useEffect(() => { pushState().then(setState); }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (state === 'on') { await disablePush(); setState('off'); }
      else {
        const s = await enablePush();
        setState(s);
        if (s === 'on') toast.success('تم تفعيل الإشعارات');
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <h2 className="inline-flex items-center gap-2 font-bold"><Bell className="size-5 text-brand" weight="duotone" />الإشعارات</h2>
      <div className="rounded-2xl bg-surface-2 p-4">
        <p className="text-sm leading-relaxed">{state ? PUSH_HINT[state] : '…'}</p>
        {(state === 'off' || state === 'on') && (
          <div className="mt-3 flex gap-2">
            <Button className="h-10 px-4 text-sm" variant={state === 'on' ? 'secondary' : 'primary'} loading={busy} onClick={toggle}>
              {state === 'on' ? 'إيقاف على هذا الجهاز' : 'تفعيل إشعارات الجوال'}
            </Button>
            {state === 'on' && (
              <Button className="h-10 px-4 text-sm" variant="ghost"
                onClick={() => sendTestNotification().then(() => toast.success('أرسلنا إشعار تجربة')).catch((e: Error) => toast.error(e.message))}>
                تجربة
              </Button>
            )}
          </div>
        )}
      </div>
      <ul className="divide-y divide-line/60">
        {NOTIFICATION_KINDS.map(({ kind, label, hint }) => {
          const on = !disabled.includes(kind);
          return (
            <li key={kind}>
              <label className="flex items-center justify-between gap-3 py-2.5">
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="text-xs text-muted">{hint}</span>
                </span>
                <input type="checkbox" checked={on} className="size-5 shrink-0 accent-[var(--color-brand)]"
                  onChange={() => saveKinds.mutate(on ? [...disabled, kind] : disabled.filter((k) => k !== kind))} />
              </label>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------- رسائل البنك (اختصار الآيفون) ----------
function SmsSection() {
  const [token, setToken] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const url = `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/sms`;

  useEffect(() => { mySmsToken().then(setToken).catch(() => {}); }, []);

  const copy = (v: string, what: string) => navigator.clipboard.writeText(v).then(() => toast.success(`تم نسخ ${what}`)).catch(() => {});

  return (
    <Card className="space-y-3">
      <h2 className="inline-flex items-center gap-2 font-bold"><ChatCircleText className="size-5 text-brand" weight="duotone" />رسائل البنك</h2>
      <p className="text-sm leading-relaxed text-muted">
        اختصار في الآيفون يرسل رسالة البنك (أو أبشر) للتطبيق، وClaude يقرأها ويسجّلها: المبلغ، المتجر، البطاقة، الدولة والعملة.
        الإشعار يوصلك من التطبيق نفسه، فاحذف خطوة «إظهار الإشعار» من الاختصار.
      </p>
      <button type="button" onClick={() => setShow(!show)} className="text-sm font-semibold text-brand">
        {show ? 'إخفاء طريقة التجهيز' : 'طريقة تجهيز الاختصار'}
      </button>
      {show && (
        <div className="space-y-3 rounded-2xl bg-surface-2 p-4 text-sm leading-relaxed">
          <ol className="list-decimal space-y-1.5 ps-5">
            <li>تطبيق الاختصارات ← الأتمتة ← جديدة ← <b>الرسالة</b> ← المرسل: اسم البنك (وكرّرها لكل بنك ولأبشر) ← تشغيل فوري.</li>
            <li>أضف إجراء <b>الحصول على محتويات URL</b> بالرابط تحت، الطريقة <b>POST</b>، والمتن <b>JSON</b>.</li>
            <li>حقل <code>token</code> = رمزك تحت، وحقل <code>message</code> = <b>الرسالة</b> (المتغيّر من الأتمتة).</li>
          </ol>
          <div className="flex items-center gap-2">
            <code dir="ltr" className="flex-1 truncate rounded-xl bg-surface px-3 py-2 text-xs">{url}</code>
            <IconButton label="نسخ الرابط" onClick={() => copy(url, 'الرابط')}><Copy className="size-5" /></IconButton>
          </div>
          {token && (
            <div className="flex items-center gap-2">
              <code dir="ltr" className="flex-1 truncate rounded-xl bg-surface px-3 py-2 text-xs">{token.slice(0, 6)}••••••••{token.slice(-4)}</code>
              <IconButton label="نسخ الرمز" onClick={() => copy(token, 'الرمز')}><Copy className="size-5" /></IconButton>
              <ConfirmButton className="h-10 px-3 text-xs" confirmText="تأكيد"
                onConfirm={() => regenerateSmsToken().then((t) => { setToken(t); toast.success('رمز جديد، حدّثه في الاختصار'); })}>
                <ArrowsClockwise className="size-4" />
              </ConfirmButton>
            </div>
          )}
          <p className="text-xs text-muted">الرمز خاص بك. لا ترسله لأحد؛ أي شخص معه الرمز يقدر يسجّل عمليات باسمك.</p>
        </div>
      )}
    </Card>
  );
}

// ---------- العائلة ----------
function FamilySection() {
  const { household, me, members } = useHousehold();
  const owner = useIsOwner();
  const update = useUpdateHousehold();
  const invalidate = useInvalidate();
  const [name, setName] = useState(me.display_name);
  const [familyName, setFamilyName] = useState(household.name);
  const [rotating, setRotating] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(household.invite_code).catch(() => {});
    toast.success('تم نسخ رمز الدعوة');
  }

  async function rotate() {
    setRotating(true);
    try {
      await regenerateInviteCode();
      await invalidate('household');
      toast.success('تم إنشاء رمز جديد، الرمز القديم لم يعد يعمل');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRotating(false);
    }
  }

  const act = (fn: () => Promise<unknown>, done: string) =>
    fn().then(() => { toast.success(done); invalidate('household'); }).catch((e: Error) => toast.error(e.message));

  return (
    <Card className="space-y-4">
      <h2 className="inline-flex items-center gap-2 font-bold"><UsersThree className="size-5 text-brand" weight="duotone" />العائلة</h2>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !familyName.trim()) return toast.error('الأسماء لا يمكن أن تكون فارغة');
        update.mutate(owner ? { display_name: name.trim(), name: familyName.trim() } : { display_name: name.trim() });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="اسمك" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
          <Field label="اسم العائلة" value={familyName} maxLength={60} disabled={!owner} onChange={(e) => setFamilyName(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary" loading={update.isPending}>حفظ الأسماء</Button>
      </form>

      <div>
        <p className="mb-2 text-sm font-medium text-muted">الأعضاء</p>
        <ul className="space-y-1">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-2">
              <span className="flex-1 font-medium">{m.display_name}{m.user_id === me.user_id && ' (أنت)'}</span>
              <span className={cx('text-xs', m.role === 'owner' ? 'font-semibold text-brand' : 'text-muted')}>
                {m.role === 'owner' ? 'المنشئ · يدير' : 'عضو'}
              </span>
              {owner && m.user_id !== me.user_id && (<>
                <ConfirmButton className="h-8 bg-transparent px-2 text-xs text-muted" confirmText="نقل الإدارة؟"
                  onConfirm={() => act(() => transferOwnership(m.user_id), `صار ${m.display_name} المنشئ`)}>
                  <Crown className="size-4" />
                </ConfirmButton>
                <ConfirmButton className="h-8 px-2 text-xs" confirmText="إزالة؟"
                  onConfirm={() => act(() => removeMember(m.user_id), 'تمت الإزالة')}>
                  <UserMinus className="size-4" />
                </ConfirmButton>
              </>)}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">المنشئ يدير التصنيفات والميزانية والبطاقات والأعضاء. الباقي يضيفون مصاريفهم ويعدّلونها.</p>
      </div>

      <div className="rounded-2xl border border-dashed border-line p-4">
        <p className="text-sm text-muted">شارك هذا الرمز مع أفراد العائلة ليسجّلوا وينضموا إلى نفس الحساب العائلي:</p>
        <div className="mt-3 flex items-center gap-2">
          <code dir="ltr" className="flex-1 rounded-xl bg-surface-2 py-2.5 text-center text-xl font-bold tracking-[.3em]">
            {household.invite_code}
          </code>
          <IconButton label="نسخ الرمز" onClick={copyCode}><Copy className="size-5" weight="bold" /></IconButton>
          {owner && (
            <IconButton label="إنشاء رمز جديد" onClick={rotate} disabled={rotating}>
              <ArrowsClockwise className={cx('size-5', rotating && 'animate-spin')} weight="bold" />
            </IconButton>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------- التصنيفات ----------
function CategoriesSection() {
  const owner = useIsOwner();
  const { data: categories = [] } = useCategories();
  const [editing, setEditing] = useState<{ open: boolean; item?: Category }>({ open: false });

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between px-2 pt-2">
        <h2 className="inline-flex items-center gap-2 font-bold"><Tag className="size-5 text-brand" weight="duotone" />التصنيفات</h2>
        {owner && (
          <Button variant="ghost" className="h-9 px-3 text-sm" onClick={() => setEditing({ open: true })}>
            <Plus className="size-4" weight="bold" /> تصنيف جديد
          </Button>
        )}
      </div>
      {owner && <OrganizeTools />}
      <ul className="mt-2">
        {categories.map((c) => (
          <li key={c.id}>
            <button type="button" disabled={!owner} onClick={() => setEditing({ open: true, item: c })}
              className={cx('flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-start hover:bg-surface-2 disabled:hover:bg-transparent', c.is_archived && 'opacity-50')}>
              <CategoryIcon category={c} size="sm" />
              <span className="flex-1 font-medium">{c.name}</span>
              {c.is_pinned && <PushPin className="size-4 text-muted" weight="fill" aria-label="أساسي مثبّت" />}
              {c.is_archived && <span className="text-xs text-muted">مؤرشف</span>}
            </button>
          </li>
        ))}
      </ul>
      {!owner && <div className="px-2 pb-2"><OwnerNote /></div>}
      <Sheet open={editing.open} onOpenChange={(o) => setEditing((s) => ({ ...s, open: o }))}
        title={editing.item ? 'تعديل التصنيف' : 'تصنيف جديد'}>
        <CategoryForm key={editing.item?.id ?? 'new'} item={editing.item} nextOrder={categories.length + 1}
          onDone={() => setEditing({ open: false })} />
      </Sheet>
    </Card>
  );
}

/** «نظّم التصنيفات» بـ Claude: معاينة ← تطبيق ← تراجع كامل */
function OrganizeTools() {
  const { data: categories = [] } = useCategories();
  const { data: snapshots = [] } = useSnapshots();
  const invalidate = useInvalidate();
  const [plan, setPlan] = useState<OrganizePlan | null>(null);
  const [busy, setBusy] = useState<'suggest' | 'apply' | 'undo' | null>(null);
  const last = snapshots.find((s) => !s.undone_at);
  const name = (id: string) => categories.find((c) => c.id === id)?.name ?? plan?.creates.find((c) => c.key === id)?.name ?? '—';
  const empty = plan && !plan.creates.length && !plan.renames.length && !plan.merges.length && !plan.moves.length;

  async function run<T>(kind: 'suggest' | 'apply' | 'undo', fn: () => Promise<T>) {
    setBusy(kind);
    try { return await fn(); } catch (e) { toast.error((e as Error).message); return null; } finally { setBusy(null); }
  }

  return (
    <div className="mx-2 mt-3 rounded-2xl bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-10 px-4 text-sm" loading={busy === 'suggest'}
          onClick={() => run('suggest', suggestOrganize).then((p) => p && setPlan(p))}>
          <MagicWand className="size-5" weight="duotone" /> نظّم التصنيفات
        </Button>
        {last && (
          <Button variant="ghost" className="h-10 px-3 text-sm" loading={busy === 'undo'}
            onClick={() => run('undo', async () => {
              await undoCategoryPlan(last.id);
              await invalidate('categories', 'snapshots', 'expenses', 'monthly', 'recurring');
              toast.success('رجّعنا كل شيء كما كان');
            })}>
            <ArrowCounterClockwise className="size-4" /> تراجع عن آخر تنظيم
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">Claude يقترح: نقل «مصاريف أخرى» لتصنيفاتها، دمج المتشابه، وترتيب حسب الصرف. التصنيفات المثبّتة 📌 ما تنحذف ولا تندمج.</p>

      <Sheet open={Boolean(plan)} onOpenChange={(o) => !o && setPlan(null)} title="اقتراح التنظيم">
        {plan && (
          <div className="space-y-4 pb-4">
            <p className="font-medium">{plan.summary}</p>
            {empty ? <p className="text-sm text-muted">تصنيفاتكم مرتبة، ما في شي يحتاج تغيير 👌</p> : (
              <ul className="space-y-1.5 text-sm">
                {plan.changes.map((c, i) => <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">{c}</li>)}
                {plan.merges.map((m) => <li key={`m${m.from}`} className="text-muted">دمج «{name(m.from)}» في «{name(m.to)}»</li>)}
                {plan.moves.length > 0 && <li className="text-muted">نقل {plan.moves.length} عملية من «مصاريف أخرى»</li>}
              </ul>
            )}
            <div className="flex gap-2">
              <Button className="flex-1" disabled={Boolean(empty)} loading={busy === 'apply'}
                onClick={() => run('apply', async () => {
                  await applyCategoryPlan(plan);
                  await invalidate('categories', 'snapshots', 'expenses', 'monthly', 'recurring');
                  setPlan(null);
                  toast.success('تم التنظيم. تقدر تتراجع بضغطة.');
                })}>
                طبّق
              </Button>
              <Button variant="secondary" onClick={() => setPlan(null)}>إلغاء</Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function CategoryForm({ item, nextOrder, onDone }: { item?: Category; nextOrder: number; onDone: () => void }) {
  const save = useSaveCategory();
  const remove = useDeleteCategory();
  const [name, setName] = useState(item?.name ?? '');
  const [icon, setIcon] = useState(item?.icon ?? 'circle');
  const [color, setColor] = useState(item?.color ?? CATEGORY_COLORS[0]!);
  const [archived, setArchived] = useState(item?.is_archived ?? false);
  const preview = { ...(item ?? ({} as Category)), icon, color };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error('اكتب اسم التصنيف');
    save.mutate(
      { id: item?.id, input: { name: name.trim(), icon, color, is_archived: archived, ...(item ? {} : { sort_order: nextOrder }) } },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <div className="flex items-end gap-3">
        <CategoryIcon category={preview} size="lg" />
        <Field label="الاسم" className="flex-1" value={name} maxLength={40} autoFocus={!item} onChange={(e) => setName(e.target.value)} />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-muted">الأيقونة</legend>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
          {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
            <button key={key} type="button" aria-label={key} aria-pressed={icon === key} onClick={() => setIcon(key)}
              className={cx('flex aspect-square items-center justify-center rounded-xl transition active:scale-90', icon === key ? 'text-white' : 'bg-surface-2 text-muted')}
              style={icon === key ? { background: color } : undefined}>
              <Icon className="size-5" weight="duotone" />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-muted">اللون</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_COLORS.map((c) => (
            <button key={c} type="button" aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)}
              className={cx('size-9 rounded-full ring-offset-2 ring-offset-surface', color === c && 'ring-2 ring-ink')}
              style={{ background: c }} />
          ))}
        </div>
      </fieldset>
      {item?.is_pinned ? (
        <p className="flex items-center gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
          <PushPin className="size-4" weight="fill" /> تصنيف أساسي مثبّت: تقدر تغيّر اسمه وشكله، لكن ما ينحذف ولا يتأرشف.
        </p>
      ) : item && (
        <label className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
          <span>
            <span className="block font-medium">أرشفة</span>
            <span className="text-xs text-muted">يختفي من شاشة الإضافة، وتبقى عملياته السابقة</span>
          </span>
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending} className="flex-1">{item ? 'حفظ التعديل' : 'إضافة'}</Button>
        {item && !item.is_pinned && (
          <ConfirmButton loading={remove.isPending} confirmText="تأكيد الحذف"
            onConfirm={() => remove.mutate(item.id, { onSuccess: onDone })}>حذف</ConfirmButton>
        )}
      </div>
    </form>
  );
}
