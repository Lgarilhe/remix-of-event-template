/**
 * Quota Verification Utilities
 */

import { UNIPILE_DSN, UNIPILE_API_KEY } from './linkedin.ts';

const WEEKLY_INVITE_LIMIT = 100;

export { WEEKLY_INVITE_LIMIT };

// deno-lint-ignore no-explicit-any
export async function checkQuotaForAction(
  supabase: any,
  actionType: string,
  accountId: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    switch (actionType) {
      case 'inmail':
      case 'smart_message': {
        const balanceResponse = await fetch(
          `${UNIPILE_DSN}/api/v1/linkedin/inmail_balance?account_id=${accountId}`,
          { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
        );
        
        if (!balanceResponse.ok) {
          console.warn('Could not check InMail balance, proceeding anyway');
          return { allowed: true };
        }
        
        const balance = await balanceResponse.json();
        const recruiterCredits = balance.recruiter || balance.recruiter_balance || 0;
        const premiumCredits = balance.premium || balance.premium_balance || 0;
        const salesNavCredits = balance.sales_navigator || balance.sales_navigator_balance || 0;
        
        const totalCredits = recruiterCredits + premiumCredits + salesNavCredits;
        
        console.log(`[process-sequences] InMail balance:`, { recruiter: recruiterCredits, premium: premiumCredits, salesNav: salesNavCredits, total: totalCredits });
        
        if (totalCredits <= 0) {
          return { 
            allowed: false, 
            reason: `Quota InMail épuisé (Recruiter: ${recruiterCredits}, Premium: ${premiumCredits}, Sales Nav: ${salesNavCredits})` 
          };
        }
        
        return { allowed: true };
      }

      case 'connection_request': {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        
        const { data: sentInvites } = await supabase
          .from('sequence_step_executions')
          .select(`id, step:sequence_steps!inner(action_type)`)
          .eq('status', 'sent')
          .eq('step.action_type', 'connection_request')
          .gte('executed_at', weekAgo.toISOString());
        
        const totalInvites = sentInvites?.length || 0;
        
        if (totalInvites >= WEEKLY_INVITE_LIMIT) {
          return { 
            allowed: false, 
            reason: `Limite hebdomadaire d'invitations atteinte (${totalInvites}/${WEEKLY_INVITE_LIMIT})` 
          };
        }
        
        return { allowed: true };
      }

      default:
        return { allowed: true };
    }
  } catch (err) {
    console.error('Quota check error:', err);
    return { allowed: true };
  }
}
