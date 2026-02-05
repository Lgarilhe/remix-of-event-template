/**
 * LinkedIn/Unipile API Interactions
 */

const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY');
const UNIPILE_DSN_RAW = (Deno.env.get('UNIPILE_DSN') || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const UNIPILE_DSN = `https://${UNIPILE_DSN_RAW}`;

export { UNIPILE_DSN, UNIPILE_API_KEY };

// Get profile info from Unipile
export async function getProfileInfo(accountId: string, profileId: string): Promise<{
  network_distance?: string;
} | null> {
  try {
    const response = await fetch(
      `${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`,
      { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Get full LinkedIn profile via Unipile
export async function getFullLinkedInProfile(
  accountId: string, 
  profileId: string
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(
      `${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`,
      { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    
    // Debug: Log raw Unipile response to check what data we actually receive
    console.log(`[getFullLinkedInProfile] Raw Unipile response for ${profileId}:`, JSON.stringify({
      hasName: !!data.name || !!data.first_name,
      headline: data.headline,
      hasSummary: !!data.summary,
      summaryLength: data.summary?.length || 0,
      hasAbout: !!data.about,
      aboutLength: data.about?.length || 0,
      positionsCount: data.positions?.length || 0,
      positionsWithDescription: data.positions?.filter((p: Record<string, unknown>) => p.description || p.summary).length || 0,
      skillsCount: data.skills?.length || 0,
      educationCount: data.education?.length || data.schools?.length || 0,
      rawPositionsSample: data.positions?.slice(0, 2).map((p: Record<string, unknown>) => ({
        title: p.title,
        company: p.company_name || p.company,
        hasDescription: !!p.description,
        descriptionLength: (p.description as string)?.length || 0,
        hasSummary: !!p.summary,
      })),
    }, null, 2));
    
    // Calculate years of experience from positions
    const positions = data.positions || [];
    let yearsOfExperience = 0;
    if (positions.length > 0) {
      const startDates = positions
        .map((p: Record<string, unknown>) => p.start_date || p.starts_at)
        .filter(Boolean);
      if (startDates.length > 0) {
        const earliest = startDates.reduce((min: string, d: string) => d < min ? d : min);
        const startYear = parseInt(earliest.split('-')[0], 10);
        if (startYear) {
          yearsOfExperience = new Date().getFullYear() - startYear;
        }
      }
    }

    // Extract education with more details
    const education = (data.education || data.schools || []).map((e: Record<string, unknown>) => {
      const degree = e.degree || e.field_of_study || '';
      const school = e.school_name || e.school || '';
      const endYear = e.end_date ? (e.end_date as string).split('-')[0] : (e.ends_at ? String(e.ends_at) : '');
      return `${degree} - ${school}${endYear ? ` (${endYear})` : ''}`.trim();
    }).filter(Boolean).slice(0, 3);

    // Extract experiences with descriptions
    const experiences = positions.map((p: Record<string, unknown>) => ({
      title: p.title,
      company: p.company_name || p.company,
      duration: p.duration_str || p.duration,
      description: p.description || p.summary || '',
      location: p.location,
      startDate: p.start_date || p.starts_at,
      endDate: p.end_date || p.ends_at,
    }));

    return {
      name: data.first_name ? `${data.first_name} ${data.last_name || ''}`.trim() : data.name,
      headline: data.headline,
      current_company: data.current_company?.name || data.company_name,
      current_role: positions[0]?.title || data.headline,
      location: data.location,
      summary: data.summary || data.about,
      skills: data.skills?.map((s: Record<string, unknown>) => s.name || s) || [],
      experiences,
      education,
      yearsOfExperience,
      network_distance: data.network_distance,
      public_identifier: data.public_identifier || data.public_profile_identifier,
      profile_url: data.public_profile_url || data.profile_url,
    };
  } catch (err) {
    console.error('Failed to fetch LinkedIn profile:', err);
    return null;
  }
}

// Check if prospect has replied AFTER a specific date (usually enrollment creation)
export async function checkForReplyAfterDate(accountId: string, profileId: string, afterDate: string): Promise<boolean> {
  try {
    const enrollmentTime = new Date(afterDate).getTime();
    
    const chatsResponse = await fetch(
      `${UNIPILE_DSN}/api/v1/chat_attendees/${profileId}/chats?account_id=${accountId}`,
      { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
    );
    
    if (!chatsResponse.ok) return false;
    
    const chatsData = await chatsResponse.json();
    const chats = chatsData.items || [];
    
    if (chats.length === 0) return false;

    for (const chat of chats) {
      const messagesResponse = await fetch(
        `${UNIPILE_DSN}/api/v1/chats/${chat.id}/messages?limit=20`,
        { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
      );
      
      if (!messagesResponse.ok) continue;
      
      const messagesData = await messagesResponse.json();
      const messages = messagesData.items || [];
      
      const newProspectMessages = messages.filter((m: { 
        is_sender_self?: boolean; 
        sender_attendee_id?: string;
        timestamp?: string;
        date?: string;
        created_at?: string;
      }) => {
        if (m.is_sender_self || m.sender_attendee_id === 'self') return false;
        const msgTime = m.timestamp || m.date || m.created_at;
        if (!msgTime) return false;
        const messageTime = new Date(msgTime).getTime();
        return messageTime > enrollmentTime;
      });
      
      if (newProspectMessages.length > 0) {
        console.log(`[linkedin] Found ${newProspectMessages.length} new messages from prospect ${profileId} after ${afterDate}`);
        return true;
      }
    }
    
    return false;
  } catch (err) {
    console.error(`[linkedin] Error checking replies for ${profileId}:`, err);
    return false;
  }
}

// Legacy wrapper - only checks for ANY reply (used for wait_for_event conditions)
export async function checkHasProspectReplied(accountId: string, profileId: string): Promise<boolean> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return await checkForReplyAfterDate(accountId, profileId, yesterday);
}
