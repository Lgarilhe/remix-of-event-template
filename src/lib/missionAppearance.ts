/** Personal mission markers. Values are validated before reading local preferences. */
export const MISSION_ICONS = ['briefcase', 'code', 'database', 'cloud', 'sparkles', 'target', 'rocket', 'users'] as const;
export type MissionIcon = typeof MISSION_ICONS[number];
export const MISSION_COLORS = ['teal', 'blue', 'violet', 'rose', 'amber', 'green'] as const;
export type MissionColor = typeof MISSION_COLORS[number];
export interface MissionAppearance {
  icon: MissionIcon | 'dot';
  color: MissionColor;
}

export function defaultMissionAppearance(id: string): MissionAppearance {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return { icon: 'briefcase', color: MISSION_COLORS[hash % MISSION_COLORS.length] };
}

export function parseMissionAppearance(raw: string | null): MissionAppearance | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value && (value.icon === 'dot' || MISSION_ICONS.includes(value.icon)) && MISSION_COLORS.includes(value.color)) {
      return { icon: value.icon, color: value.color };
    }
  } catch { /* Invalid or older preferences use the default marker. */ }
  return null;
}
