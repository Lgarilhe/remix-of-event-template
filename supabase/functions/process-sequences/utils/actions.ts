/**
 * Step Action Execution - LinkedIn API interactions
 */

import { UNIPILE_DSN, UNIPILE_API_KEY, getProfileInfo } from './linkedin.ts';
import { logAnalytics } from './analytics.ts';
import { scheduleNextStep } from './step-scheduler.ts';

export type ExecuteResult = { 
  success: boolean; 
  error?: string; 
  subject?: string; 
  message?: string;
};

// deno-lint-ignore no-explicit-any
export async function executeStepAction(
  actionType: string,
  enrollment: Record<string, unknown>,
  step: Record<string, unknown>,
  execution: Record<string, unknown>,
  supabase: any
): Promise<ExecuteResult> {
  try {
    const accountId = enrollment.account_id as string;
    const profileId = enrollment.profile_id as string;
    const messageText = (execution.final_message || step.message_template || '') as string;
    const subjectText = (execution.final_subject || step.subject_template || '') as string;

    switch (actionType) {
      case 'wait_connection': {
        return { success: true };
      }

      case 'check_connection': {
        const profile = await getProfileInfo(accountId, profileId);
        const isConnected = profile?.network_distance === 'FIRST_DEGREE';
        
        const nextStepId = isConnected 
          ? (step.if_true_goto_step as string | undefined) 
          : (step.if_false_goto_step as string | undefined);
        
        await supabase
          .from('sequence_enrollments')
          .update({ connection_status: isConnected ? 'connected' : 'not_connected' })
          .eq('id', enrollment.id);
        
        if (nextStepId) {
          await scheduleNextStep(supabase, enrollment, step.step_order as number, nextStepId);
        } else {
          await scheduleNextStep(supabase, enrollment, step.step_order as number);
        }
        
        return { success: true };
      }

      case 'profile_visit': {
        const visitResponse = await fetch(
          `${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`,
          { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
        );
        
        if (visitResponse.ok) {
          await logAnalytics(supabase, enrollment.sequence_id as string, 'profile_visits');
        }
        
        return { success: visitResponse.ok };
      }

      case 'smart_message':
      case 'inmail':
      case 'message': {
        const profile = await getProfileInfo(accountId, profileId);
        const isConnected = profile?.network_distance === 'FIRST_DEGREE';
        const needsInMail = !isConnected && (actionType === 'inmail' || actionType === 'smart_message');
        
        const formData = new FormData();
        formData.append('account_id', accountId);
        formData.append('attendees_ids', profileId);
        formData.append('text', messageText);
        
        if (needsInMail) {
          formData.append('linkedin[api]', 'recruiter');
          formData.append('linkedin[inmail]', 'true');
          if (subjectText) {
            formData.append('linkedin[subject]', subjectText);
          }
        }
        
        console.log(`[process-sequences] Sending ${needsInMail ? 'InMail' : 'message'} to ${profileId}`, {
          isConnected,
          needsInMail,
          hasSubject: !!subjectText,
          textLength: messageText.length,
        });
        
        const msgResponse = await fetch(`${UNIPILE_DSN}/api/v1/chats`, {
          method: 'POST',
          headers: { 'X-API-KEY': UNIPILE_API_KEY! },
          body: formData,
        });
        
        if (!msgResponse.ok) {
          const errorText = await msgResponse.text();
          console.error(`[process-sequences] Message send failed:`, msgResponse.status, errorText);
          return { success: false, error: `Unipile error ${msgResponse.status}: ${errorText}` };
        }
        
        const msgResult = await msgResponse.json();
        console.log(`[process-sequences] Message sent successfully:`, msgResult.id || msgResult.chat_id);
        
        await logAnalytics(supabase, enrollment.sequence_id as string, 'messages_sent');
        
        return { success: true, message: messageText, subject: needsInMail ? subjectText : undefined };
      }

      case 'connection_request': {
        return await executeConnectionRequest(accountId, profileId, enrollment, supabase);
      }

      default:
        return { success: false, error: `Unknown action type: ${actionType}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' };
  }
}

// deno-lint-ignore no-explicit-any
async function executeConnectionRequest(
  accountId: string,
  profileId: string,
  enrollment: Record<string, unknown>,
  supabase: any
): Promise<ExecuteResult> {
  let correctProviderId = profileId;
  const profileUrl = enrollment.profile_url as string | undefined;

  // deno-lint-ignore no-explicit-any
  const extractProviderId = (profileData: any): string | undefined => {
    return profileData?.provider_id || profileData?.providerId || profileData?.provider?.id || profileData?.provider?.provider_id;
  };

  const fetchProfile = async (identifier: string, source: string, linkedinApi?: 'recruiter' | 'sales_navigator') => {
    try {
      const url = new URL(`${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(identifier)}`);
      url.searchParams.set('account_id', accountId);
      if (linkedinApi) url.searchParams.set('linkedin_api', linkedinApi);

      const profileResponse = await fetch(url.toString(), {
        headers: { 'X-API-KEY': UNIPILE_API_KEY!, 'accept': 'application/json' },
      });

      if (!profileResponse.ok) {
        console.warn(`[process-sequences] Could not fetch profile (${source}) for ${identifier}:`, profileResponse.status);
        return null;
      }

      return await profileResponse.json();
    } catch (err) {
      console.warn(`[process-sequences] Error fetching profile (${source}):`, err);
      return null;
    }
  };

  // deno-lint-ignore no-explicit-any
  const setProviderIdFromProfile = (profileData: any, source: string) => {
    const providerId = extractProviderId(profileData);
    if (providerId) {
      correctProviderId = providerId;
      console.log(`[process-sequences] Resolved provider_id (${source}): ${correctProviderId}`);
      return true;
    }
    console.warn(`[process-sequences] No provider_id in profile response (${source})`);
    return false;
  };

  // Resolve provider_id for invite endpoint
  if (typeof profileId === 'string' && !profileId.startsWith('ACo') && !profileId.startsWith('ADo')) {
    if (profileId.startsWith('AE') || profileId.startsWith('AEM')) {
      const recruiterProfile = await fetchProfile(profileId, 'recruiter_by_profile_id', 'recruiter');
      if (recruiterProfile) {
        setProviderIdFromProfile(recruiterProfile, 'recruiter_by_profile_id');

        const publicIdentifier = recruiterProfile.public_identifier as string | undefined;
        if (publicIdentifier && !correctProviderId.startsWith('ACo') && !correctProviderId.startsWith('ADo')) {
          console.log(`[process-sequences] Converting recruiter id -> classic provider_id using public_identifier: ${publicIdentifier}`);
          const classicProfile = await fetchProfile(publicIdentifier, 'classic_by_public_identifier');
          if (classicProfile) {
            setProviderIdFromProfile(classicProfile, 'classic_by_public_identifier');
          }
        }
      }
    }

    if (!correctProviderId.startsWith('ACo') && !correctProviderId.startsWith('ADo') && profileUrl) {
      const match = profileUrl.match(/linkedin\.com\/in\/([^/?]+)/);
      if (match) {
        const publicIdentifier = match[1];
        console.log(`[process-sequences] Fetching classic provider_id for public_identifier: ${publicIdentifier}`);
        const classicProfile = await fetchProfile(publicIdentifier, 'classic_by_public_identifier_fallback');
        if (classicProfile) {
          setProviderIdFromProfile(classicProfile, 'classic_by_public_identifier_fallback');
        }
      }
    }
  }

  if (typeof correctProviderId === 'string' && !correctProviderId.startsWith('ACo')) {
    console.warn(`[process-sequences] provider_id not resolved to ACo...; invite likely to fail`, {
      originalProfileId: profileId,
      resolvedProviderId: correctProviderId,
    });
  }
  
  const inviteBody: Record<string, string> = {
    account_id: accountId,
    provider_id: correctProviderId,
  };
  
  console.log(`[process-sequences] Sending connection request (no message)`, {
    originalProfileId: profileId,
    resolvedProviderId: correctProviderId,
  });
  
  const connectResponse = await fetch(`${UNIPILE_DSN}/api/v1/users/invite`, {
    method: 'POST',
    headers: { 'X-API-KEY': UNIPILE_API_KEY!, 'Content-Type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(inviteBody),
  });
  
  if (!connectResponse.ok) {
    const errorText = await connectResponse.text();
    console.error(`[process-sequences] Invite failed:`, connectResponse.status, errorText);
    return { success: false, error: `Unipile invite error ${connectResponse.status}: ${errorText}` };
  }
  
  console.log(`[process-sequences] Invitation sent successfully to ${correctProviderId}`);
  await logAnalytics(supabase, enrollment.sequence_id as string, 'invites_sent');
  
  await supabase
    .from('sequence_enrollments')
    .update({ connection_status: 'pending_invite' })
    .eq('id', enrollment.id);
  
  return { success: true };
}
