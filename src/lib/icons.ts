import {
  Baby, Bike, BookOpen, Car, CircleDashed, Coffee, Dumbbell, Fuel, Gift, GraduationCap, HeartPulse, House,
  Plane, Receipt, Shirt, ShoppingBag, ShoppingCart, Smartphone, Sparkles, UserRound, UtensilsCrossed, Wifi, Wrench,
  type LucideIcon,
} from 'lucide-react';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  cart: ShoppingCart,
  coffee: Coffee,
  food: UtensilsCrossed,
  bike: Bike,
  receipt: Receipt,
  bag: ShoppingBag,
  car: Car,
  fuel: Fuel,
  home: House,
  steering: UserRound,
  wifi: Wifi,
  phone: Smartphone,
  health: HeartPulse,
  school: GraduationCap,
  baby: Baby,
  gift: Gift,
  clothes: Shirt,
  travel: Plane,
  sport: Dumbbell,
  books: BookOpen,
  repair: Wrench,
  beauty: Sparkles,
  circle: CircleDashed,
};

export const iconFor = (key: string): LucideIcon => CATEGORY_ICONS[key] ?? CircleDashed;

export const CATEGORY_COLORS = [
  '#0E6B58', '#2563EB', '#7C3AED', '#DB2777', '#C2410C', '#B45309',
  '#0891B2', '#475569', '#16A34A', '#DC2626', '#4F46E5', '#64748B',
];
