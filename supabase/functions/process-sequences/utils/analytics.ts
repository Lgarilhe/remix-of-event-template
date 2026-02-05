/**
 * Sequence Analytics Logging
 */

type AnalyticsField = 'invites_sent' | 'invites_accepted' | 'messages_sent' | 'replies_received' | 'profile_visits';

// deno-lint-ignore no-explicit-any
export async function logAnalytics(
  supabase: any,
  sequenceId: string,
  field: AnalyticsField
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const { data: existing } = await supabase
      .from('sequence_analytics')
      .select('*')
      .eq('sequence_id', sequenceId)
      .eq('date', today)
      .maybeSingle();
    
    if (existing) {
      const currentValue = existing[field] || 0;
      await supabase
        .from('sequence_analytics')
        .update({ [field]: currentValue + 1 })
        .eq('id', existing.id);
    } else {
      await supabase.from('sequence_analytics').insert({
        sequence_id: sequenceId,
        date: today,
        [field]: 1,
      });
    }
  } catch (err) {
    console.error('Failed to log analytics:', err);
  }
}
