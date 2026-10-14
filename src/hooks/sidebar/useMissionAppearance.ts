import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { useAuthReady } from '@/hooks/useAuthReady';
import { parseMissionAppearance, type MissionAppearance } from '@/lib/missionAppearance';

const CHANGE_EVENT = 'konekt:mission-appearance';
function subscribe(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener(CHANGE_EVENT, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(CHANGE_EVENT, notify);
  };
}

export function useMissionAppearance(missionId: string) {
  const { user } = useAuthReady();
  const key = user ? `konekt:mission-appearance:${user.id}:${missionId}` : null;
  const raw = useSyncExternalStore(subscribe, () => {
    try { return key ? localStorage.getItem(key) : null; } catch { return null; }
  }, () => null);
  const setAppearance = (appearance: MissionAppearance | null) => {
    if (!key) return;
    try {
      if (appearance) localStorage.setItem(key, JSON.stringify(appearance));
      else localStorage.removeItem(key);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      toast.error('Impossible de mémoriser ce repère dans votre navigateur.');
    }
  };
  return { appearance: parseMissionAppearance(raw), setAppearance, canEdit: !!key };
}
