/**
 * Step Condition Checking Utilities
 */

import { getProfileInfo, checkHasProspectReplied } from './linkedin.ts';

export async function checkStepCondition(
  _supabase: unknown,
  conditionType: string,
  accountId: string,
  profileId: string,
  waitForEvent?: string
): Promise<boolean | 'wait'> {
  const effectiveConditionType = waitForEvent ? 'wait_for_event' : (conditionType || 'always');

  switch (effectiveConditionType) {
    case 'always':
      return true;

    case 'if_connected': {
      const profile = await getProfileInfo(accountId, profileId);
      return profile?.network_distance === 'FIRST_DEGREE';
    }

    case 'if_not_connected': {
      const profile = await getProfileInfo(accountId, profileId);
      return profile?.network_distance !== 'FIRST_DEGREE';
    }

    case 'if_no_response': {
      const hasReply = await checkHasProspectReplied(accountId, profileId);
      return !hasReply;
    }

    case 'wait_until_connected': {
      const profile = await getProfileInfo(accountId, profileId);
      if (profile?.network_distance === 'FIRST_DEGREE') {
        return true;
      }
      return 'wait';
    }

    case 'wait_for_event': {
      if (!waitForEvent) return true;
      
      switch (waitForEvent) {
        case 'connection_accepted': {
          const profile = await getProfileInfo(accountId, profileId);
          return profile?.network_distance === 'FIRST_DEGREE' ? true : 'wait';
        }
        case 'reply_received': {
          const hasReply = await checkHasProspectReplied(accountId, profileId);
          return hasReply ? true : 'wait';
        }
        default:
          return true;
      }
    }

    default:
      return true;
  }
}
