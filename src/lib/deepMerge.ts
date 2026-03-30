/** Deep-merge two plain objects. Arrays are replaced, not merged. */
export function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object') return target;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target?.[key];
    if (sv != null && typeof sv === 'object' && !Array.isArray(sv) && tv != null && typeof tv === 'object' && !Array.isArray(tv)) {
      result[key] = deepMerge(tv, sv);
    } else {
      result[key] = sv;
    }
  }
  return result;
}
