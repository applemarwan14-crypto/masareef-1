// شكل قراءة رسالة البنك — نفسه من Claude ومن القارئ المحلي

export type SmsKind =
  | 'purchase' | 'bill' | 'withdrawal' | 'transfer_out' | 'transfer_in' | 'deposit'
  | 'refund' | 'declined' | 'otp' | 'renewal' | 'info';

export type PaymentMethod = 'mada' | 'apple_pay' | 'pos' | 'online' | 'atm' | 'sadad' | 'transfer' | 'other';
export type CardType = 'credit' | 'debit' | 'mada' | 'prepaid';
export type CardNetwork = 'visa' | 'mastercard' | 'mada' | 'amex';
export type RenewalKind =
  | 'insurance' | 'istimara' | 'license' | 'passport' | 'iqama' | 'national_id'
  | 'subscription' | 'rent' | 'warranty' | 'other';

export interface ParsedRenewal {
  kind: RenewalKind;
  title: string;
  due_date: string | null; // ميلادي YYYY-MM-DD
  hijri_due: { year: number; month: number; day: number } | null;
  person: string | null;
}

export interface ParsedSms {
  kind: SmsKind;
  amount: number | null;      // بالعملة الأصلية (ريال، دولار…)
  currency: string | null;    // ISO مثل SAR، USD
  sar_amount: number | null;  // المبلغ بالريال إن ذكرته الرسالة صراحة لعملية أجنبية
  merchant: string | null;    // اسم المتجر منظّفاً
  date: string | null;        // YYYY-MM-DD
  card_last4: string | null;
  card_type: CardType | null;
  card_network: CardNetwork | null;
  bank: string | null;
  payment_method: PaymentMethod | null;
  country: string | null;     // ISO-2 لدولة المتجر
  category: string | null;    // أحد أسماء التصنيفات المرسلة
  is_device: boolean;         // جهاز إلكتروني أو كهربائي (للضمان)
  renewal: ParsedRenewal | null;
}

export const EXPENSE_KINDS: SmsKind[] = ['purchase', 'bill', 'withdrawal'];
