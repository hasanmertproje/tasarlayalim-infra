import { useSyncExternalStore } from 'react';

export const TASO_PRIMARY_SCREENS = [
  'Command Center',
  'Projects',
  'Studio',
  'Tasks',
  'Approvals',
  'Deployments',
  'AI Agents',
  'Knowledge',
  'Integrations',
  'Monitoring',
  'Settings',
] as const;

export const TASO_SCREENS = [
  ...TASO_PRIMARY_SCREENS,
  'Workspace',
  'Workspace Studio',
  'Notifications',
  'Infrastructure',
] as const;

export type TasoPrimaryScreen = (typeof TASO_PRIMARY_SCREENS)[number];
export type TasoScreen = (typeof TASO_SCREENS)[number];

export const TASO_SCREEN_LABELS: Record<TasoScreen, string> = {
  'Command Center': 'Kontrol Merkezi',
  Projects: 'Projeler', Studio: 'Tasarım Stüdyosu', Tasks: 'Görevler', Approvals: 'Onaylar',
  Deployments: 'Dağıtımlar', 'AI Agents': 'Yapay Zekâ Ajanları',
  Knowledge: 'Bilgi Merkezi', Integrations: 'Entegrasyonlar',
  Monitoring: 'İzleme', Settings: 'Ayarlar',
  Workspace: 'Çalışma Alanım',
  'Workspace Studio': 'Proje Stüdyosu',
  Notifications: 'Bildirimler', Infrastructure: 'Altyapı',
};

type Listener = () => void;

let activeScreen: TasoScreen = 'Command Center';
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('taso:navigation-changed', { detail: { screen: activeScreen } }));
  }
}

export function isTasoScreen(value: unknown): value is TasoScreen {
  return typeof value === 'string' && (TASO_SCREENS as readonly string[]).includes(value);
}

export function getTasoScreen() {
  return activeScreen;
}

export function navigateTaso(screen: TasoScreen) {
  if (screen === activeScreen) return;
  activeScreen = screen;
  emit();
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' });
}

export function subscribeTasoNavigation(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTasoNavigation(): readonly [TasoScreen, (screen: TasoScreen) => void] {
  const screen = useSyncExternalStore(subscribeTasoNavigation, getTasoScreen, getTasoScreen);
  return [screen, navigateTaso] as const;
}
