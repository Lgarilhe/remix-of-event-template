/** Reject ambiguous result identities. A missing result remains eligible for retry. */
export function matchScoringResultsById<P extends { id: string }, R extends { profile_id?: unknown }>(
  profiles: P[], results: R[],
): Array<{ profile: P; result: R }> {
  const profileCounts = new Map<string, number>();
  const resultCounts = new Map<string, number>();
  profiles.forEach(profile => profileCounts.set(profile.id, (profileCounts.get(profile.id) || 0) + 1));
  results.forEach(result => {
    if (typeof result?.profile_id === 'string') resultCounts.set(result.profile_id, (resultCounts.get(result.profile_id) || 0) + 1);
  });
  const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
  return results.flatMap(result => {
    const id = result?.profile_id;
    if (typeof id !== 'string' || !id || profileCounts.get(id) !== 1 || resultCounts.get(id) !== 1) return [];
    return [{ profile: profilesById.get(id)!, result }];
  });
}
