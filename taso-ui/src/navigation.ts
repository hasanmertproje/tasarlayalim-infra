import { useSyncExternalStore } from 'react';

export const TASO_SCREENS = [
  'Command Center',
  'Projects',
  'Tasks',
  'Approvals',
  'Deployments',
  'AI Agents',
  'Knowledge',
  'Integrations',
  'Monitoring',
  'Settings',
  'Notifications',
  'Infrastructure',
] as const;

export const TASO_PRIMARY_SCREENS = TASO_SCREENS.slice(0, 10) as readonly TasoScreen[];

export type TasoScreen = (typeof TASO_SCREENS)[number];

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
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

export function subscribeTasoNavigation(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTasoNavigation(): readonly [TasoScreen, (screen: TasoScreen) => void] {
  const screen = useSyncExternalStore(subscribeTasoNavigation, getTasoScreen, getTasoScreen);
  return [screen, navigateTaso] as const;
}
