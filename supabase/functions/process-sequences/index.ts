import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY');
const UNIPILE_DSN_RAW = (Deno.env.get('UNIPILE_DSN') || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const UNIPILE_DSN = `https://${UNIPILE_DSN_RAW}`;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY');

console.log('[process-sequences] Config:', {
  hasDSN: !!UNIPILE_DSN_RAW,
  dsn: UNIPILE_DSN,
  hasApiKey: !!UNIPILE_API_KEY,
  hasAnthropicKey: !!ANTHROPIC_API_KEY,
  hasNotionKey: !!NOTION_API_KEY,
});

// Quota limits per account type
const WEEKLY_INVITE_LIMIT = 100;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action } = await req.json();

    switch (action) {
      case 'process': {
        const now = new Date().toISOString();
        
        const { data: executions, error: fetchError } = await supabase
          .from('sequence_step_executions')
          .select(`
            *,
            enrollment:sequence_enrollments(
              *,
              sequence:outreach_sequences(*)
            ),
            step:sequence_steps(*)
          `)
          .eq('status', 'scheduled')
          .lte('scheduled_at', now)
          .limit(10);

        if (fetchError) throw fetchError;

        const results = { processed: 0, skipped: 0, failed: 0, quota_blocked: 0 };

        for (const exec of executions || []) {
          try {
            const enrollment = exec.enrollment;
            const step = exec.step;
            
            if (!enrollment || enrollment.status !== 'active') {
              await supabase
                .from('sequence_step_executions')
                .update({ status: 'skipped', skip_reason: 'Enrollment inactive' })
                .eq('id', exec.id);
              results.skipped++;
              continue;
            }

            // ============ QUOTA VERIFICATION ============
            const quotaCheck = await checkQuotaForAction(
              supabase,
              step.action_type,
              enrollment.account_id
            );
            
            if (!quotaCheck.allowed) {
              await supabase
                .from('sequence_step_executions')
                .update({ 
                  status: 'quota_blocked', 
                  skip_reason: quotaCheck.reason,
                  // Reschedule for tomorrow
                  scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                })
                .eq('id', exec.id);
              results.quota_blocked++;
              continue;
            }

            // Check conditions
            const conditionResult = await checkStepCondition(
              supabase,
              step.condition_type,
              enrollment.account_id,
              enrollment.profile_id,
              step.wait_for_event
            );

            if (conditionResult === 'wait') {
              await supabase
                .from('sequence_step_executions')
                .update({ status: 'waiting_event' })
                .eq('id', exec.id);
              results.skipped++;
              continue;
            }

            if (!conditionResult) {
              await supabase
                .from('sequence_step_executions')
                .update({ 
                  status: 'skipped', 
                  skip_reason: `Condition not met: ${step.condition_type}`,
                  executed_at: now,
                })
                .eq('id', exec.id);
              results.skipped++;
              await scheduleNextStep(supabase, enrollment, step.step_order);
              continue;
            }

            // Mark as sending
            await supabase
              .from('sequence_step_executions')
              .update({ status: 'sending' })
              .eq('id', exec.id);

            // ============ AI PERSONALIZATION ============
            let finalMessage = (exec.final_message || step.message_template || '') as string;
            let finalSubject = (step.subject_template || '') as string;
            
            if (step.use_ai_personalization && needsMessage(step.action_type)) {
              const personalizedContent = await generatePersonalizedMessage(
                supabase,
                enrollment,
                step,
                exec
              );
              
              if (personalizedContent) {
                finalMessage = personalizedContent.message;
                finalSubject = personalizedContent.subject || finalSubject;
              }
            }

            // Execute the action
            const executeResult = await executeStepAction(
              step.action_type,
              enrollment,
              step,
              { ...exec, final_message: finalMessage, final_subject: finalSubject },
              supabase
            );

            if (executeResult.success) {
              await supabase
                .from('sequence_step_executions')
                .update({ 
                  status: 'sent', 
                  executed_at: now,
                  final_subject: executeResult.subject || finalSubject,
                  final_message: executeResult.message || finalMessage,
                })
                .eq('id', exec.id);
              
              await supabase
                .from('sequence_enrollments')
                .update({ current_step_order: step.step_order + 1 })
                .eq('id', enrollment.id);

              await scheduleNextStep(supabase, enrollment, step.step_order);
              results.processed++;
            } else {
              await supabase
                .from('sequence_step_executions')
                .update({ 
                  status: 'failed', 
                  error_message: executeResult.error,
                  executed_at: now,
                })
                .eq('id', exec.id);
              results.failed++;
            }
          } catch (err) {
            console.error('Step execution error:', err);
            await supabase
              .from('sequence_step_executions')
              .update({ 
                status: 'failed', 
                error_message: err instanceof Error ? err.message : 'Unknown error',
              })
              .eq('id', exec.id);
            results.failed++;
          }
        }

        return new Response(JSON.stringify({ success: true, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'check_replies': {
        const { data: activeEnrollments } = await supabase
          .from('sequence_enrollments')
          .select('*')
          .eq('status', 'active');

        let repliesDetected = 0;

        for (const enrollment of activeEnrollments || []) {
          const hasReply = await checkForReply(enrollment.account_id, enrollment.profile_id);
          
          if (hasReply) {
            await supabase
              .from('sequence_enrollments')
              .update({ 
                status: 'replied', 
                replied_at: new Date().toISOString(),
              })
              .eq('id', enrollment.id);
            
            await supabase
              .from('sequence_step_executions')
              .update({ status: 'cancelled', skip_reason: 'Reply detected' })
              .eq('enrollment_id', enrollment.id)
              .eq('status', 'scheduled');
            
            repliesDetected++;
          }
        }

        return new Response(JSON.stringify({ success: true, repliesDetected }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'check_timeouts': {
        const timeoutResults = await checkTimeoutBranches(supabase);
        return new Response(JSON.stringify({ success: true, ...timeoutResults }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'check_wait_events': {
        const { data: waitingExecutions } = await supabase
          .from('sequence_step_executions')
          .select(`
            *,
            enrollment:sequence_enrollments(*),
            step:sequence_steps(*)
          `)
          .eq('status', 'waiting_event');

        let eventsTriggered = 0;

        for (const exec of waitingExecutions || []) {
          const step = exec.step;
          const enrollment = exec.enrollment;
          
          if (!step || !enrollment) continue;

          let eventOccurred = false;

          switch (step.wait_for_event) {
            case 'connection_accepted': {
              const profile = await getProfileInfo(enrollment.account_id, enrollment.profile_id);
              eventOccurred = profile?.network_distance === 'FIRST_DEGREE';
              break;
            }
            case 'reply_received': {
              eventOccurred = await checkHasProspectReplied(enrollment.account_id, enrollment.profile_id);
              break;
            }
          }

          if (eventOccurred) {
            await supabase
              .from('sequence_step_executions')
              .update({ status: 'scheduled', scheduled_at: new Date().toISOString() })
              .eq('id', exec.id);
            
            if (step.wait_for_event === 'connection_accepted') {
              await supabase
                .from('sequence_enrollments')
                .update({ connection_status: 'connected' })
                .eq('id', enrollment.id);
            }
            
            eventsTriggered++;
          }
        }

        return new Response(JSON.stringify({ success: true, eventsTriggered }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('Sequence processor error:', error);
    return new Response(JSON.stringify({
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ============ QUOTA VERIFICATION ============

function needsMessage(actionType: string): boolean {
  return ['message', 'inmail', 'smart_message', 'connection_request'].includes(actionType);
}

// deno-lint-ignore no-explicit-any
async function checkQuotaForAction(
  supabase: any,
  actionType: string,
  accountId: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    switch (actionType) {
      case 'inmail':
      case 'smart_message': {
        // Check InMail balance via Unipile
        const balanceResponse = await fetch(
          `${UNIPILE_DSN}/api/v1/linkedin/inmail_balance?account_id=${accountId}`,
          { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
        );
        
        if (!balanceResponse.ok) {
          console.warn('Could not check InMail balance, proceeding anyway');
          return { allowed: true };
        }
        
        const balance = await balanceResponse.json();
        const recruiterCredits = balance.recruiter_balance || 0;
        const premiumCredits = balance.premium_balance || 0;
        const salesNavCredits = balance.sales_navigator_balance || 0;
        
        const totalCredits = recruiterCredits + premiumCredits + salesNavCredits;
        
        if (totalCredits <= 0) {
          return { 
            allowed: false, 
            reason: `Quota InMail épuisé (Recruiter: ${recruiterCredits}, Premium: ${premiumCredits}, Sales Nav: ${salesNavCredits})` 
          };
        }
        
        return { allowed: true };
      }

      case 'connection_request': {
        // Count invitations sent this week for this account
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        
        const { count } = await supabase
          .from('sequence_step_executions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'sent')
          .gte('executed_at', weekAgo.toISOString())
          .in('step_id', 
            supabase
              .from('sequence_steps')
              .select('id')
              .eq('action_type', 'connection_request')
          );
        
        // Also count from analytics
        const { data: analyticsData } = await supabase
          .from('sequence_analytics')
          .select('invites_sent')
          .gte('date', weekAgo.toISOString().split('T')[0]);
        
        const analyticsInvites = analyticsData?.reduce(
          (sum: number, row: { invites_sent: number }) => sum + (row.invites_sent || 0), 
          0
        ) || 0;
        
        const totalInvites = (count || 0) + analyticsInvites;
        
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
    // Allow execution if quota check fails
    return { allowed: true };
  }
}

// ============ AI PERSONALIZATION ============

// deno-lint-ignore no-explicit-any
async function generatePersonalizedMessage(
  supabase: any,
  enrollment: Record<string, unknown>,
  step: Record<string, unknown>,
  execution: Record<string, unknown>
): Promise<{ message: string; subject?: string } | null> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not configured, skipping AI personalization');
    return null;
  }

  try {
    // 1. Get full LinkedIn profile
    const profileData = await getFullLinkedInProfile(
      enrollment.account_id as string,
      enrollment.profile_id as string
    );

    // 2. Get job context from Notion if available
    let jobContext: Record<string, unknown> | null = null;
    if (enrollment.job_id && NOTION_API_KEY) {
      jobContext = await fetchNotionJobContext(enrollment.job_id as string);
    }

    // 3. Get sequence history (previous steps executed)
    const { data: previousSteps } = await supabase
      .from('sequence_step_executions')
      .select('*, step:sequence_steps(*)')
      .eq('enrollment_id', enrollment.id)
      .eq('status', 'sent')
      .order('step_order', { ascending: true });

    // 4. Determine message type
    const stepOrder = step.step_order as number;
    const actionType = step.action_type as string;
    const isFollowUp = stepOrder > 0 && (previousSteps?.length || 0) > 0;
    const isInvitation = actionType === 'connection_request';

    // 5. Build the prompt
    const messageType = isInvitation 
      ? 'INVITATION (max 50 caractères pour la note)' 
      : isFollowUp 
        ? 'RELANCE' 
        : 'PREMIER MESSAGE';

    const previousMessagesContext = previousSteps?.map((ps: Record<string, unknown>) => 
      `Étape ${ps.step_order}: ${(ps.step as Record<string, unknown>)?.action_type} - "${ps.final_message || 'N/A'}"`
    ).join('\n') || 'Aucun message précédent';

    const prompt = buildPersonalizationPrompt({
      profile: profileData,
      job: jobContext,
      messageType,
      previousMessages: previousMessagesContext,
      template: step.message_template as string,
      tone: step.ai_tone as string || 'professional',
      isInvitation,
    });

    // 6. Call Claude
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system: `Tu es un recruteur tech senior. Tu écris des messages LinkedIn personnalisés.
RÈGLES:
- Messages courts (80-100 mots max, sauf invitations: 50 car max)
- Ton humain, pas de superlatifs
- JAMAIS de "20+", toujours "plus de 20"
- Sauts de ligne entre paragraphes
- Réponds UNIQUEMENT en JSON: {"subject": "...", "message": "..."}`,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error('AI personalization failed:', response.status);
      return null;
    }

    const data = await response.json();
    let content = data.content?.[0]?.text || "";
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const result = JSON.parse(content);
      return {
        message: result.message || '',
        subject: result.subject,
      };
    } catch {
      console.error('Failed to parse AI response:', content);
      return null;
    }
  } catch (err) {
    console.error('AI personalization error:', err);
    return null;
  }
}

interface PersonalizationParams {
  profile: Record<string, unknown> | null;
  job: Record<string, unknown> | null;
  messageType: string;
  previousMessages: string;
  template: string;
  tone: string;
  isInvitation: boolean;
}

function buildPersonalizationPrompt(params: PersonalizationParams): string {
  const { profile, job, messageType, previousMessages, template, tone, isInvitation } = params;

  const toneInstructions: Record<string, string> = {
    professional: "Vouvoiement, ton direct et respectueux.",
    casual: "Tutoiement naturel, décontracté mais pro.",
    enthusiastic: "Tutoiement, ton dynamique mais pas surjoué."
  };

  let prompt = `TYPE DE MESSAGE: ${messageType}\n\n`;

  // Profile context
  if (profile) {
    prompt += `PROFIL DU CANDIDAT:
- Nom: ${profile.name || 'Inconnu'}
- Titre: ${profile.headline || 'Non spécifié'}
- Entreprise actuelle: ${profile.current_company || 'Non spécifié'}
- Localisation: ${profile.location || 'Non spécifié'}
${profile.summary ? `- À propos: "${(profile.summary as string).slice(0, 500)}"` : ''}
${profile.skills ? `- Compétences: ${(profile.skills as string[]).slice(0, 10).join(', ')}` : ''}
${profile.experiences ? `- Expériences récentes: ${JSON.stringify((profile.experiences as unknown[]).slice(0, 3))}` : ''}\n\n`;
  }

  // Job context
  if (job) {
    prompt += `POSTE À POURVOIR:
- Titre: ${job.title || 'Non spécifié'}
- Client: ${(job.client as Record<string, unknown>)?.name || 'Confidentiel'}
- Description: ${job.description ? (job.description as string).slice(0, 300) : 'Non spécifié'}
- Compétences: ${(job.skills as string[])?.join(', ') || 'Non spécifié'}
- Localisation: ${job.location || 'Non spécifié'}
- Remote: ${job.remote || 'Non spécifié'}
${job.mustHave ? `- Must-have: ${job.mustHave}` : ''}
${job.shouldHave ? `- Should-have: ${job.shouldHave}` : ''}\n\n`;
  }

  // Sequence history
  prompt += `HISTORIQUE DE LA SÉQUENCE:
${previousMessages}\n\n`;

  // Template if provided
  if (template) {
    prompt += `TEMPLATE DE BASE (à personnaliser):
"${template}"\n\n`;
  }

  // Instructions
  prompt += `TON: ${toneInstructions[tone] || toneInstructions.professional}\n\n`;

  if (isInvitation) {
    prompt += `IMPORTANT: C'est une NOTE D'INVITATION LinkedIn. Maximum 50 caractères !
Sois ultra concis. Exemple: "Votre profil Python m'intéresse - échangeons ?"`;
  } else {
    prompt += `Génère un message personnalisé en tenant compte:
1. Du profil du candidat (utilise son À propos si disponible)
2. Du poste proposé et ses critères
3. De l'historique de la séquence (si c'est une relance, fais référence au message précédent)
4. Du ton demandé`;
  }

  return prompt;
}

// Get full LinkedIn profile via Unipile
async function getFullLinkedInProfile(
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
    
    return {
      name: data.first_name ? `${data.first_name} ${data.last_name || ''}`.trim() : data.name,
      headline: data.headline,
      current_company: data.current_company?.name || data.company_name,
      location: data.location,
      summary: data.summary || data.about,
      skills: data.skills?.map((s: Record<string, unknown>) => s.name || s) || [],
      experiences: data.positions?.map((p: Record<string, unknown>) => ({
        title: p.title,
        company: p.company_name,
        duration: p.duration_str,
      })) || [],
      network_distance: data.network_distance,
    };
  } catch (err) {
    console.error('Failed to fetch LinkedIn profile:', err);
    return null;
  }
}

// Fetch job context from Notion
async function fetchNotionJobContext(jobId: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!response.ok) return null;

    const page = await response.json();
    const props = page.properties || {};

    // Helper to extract property values
    const getValue = (prop: Record<string, unknown>): unknown => {
      if (!prop) return null;
      switch (prop.type) {
        case 'title':
          return (prop.title as Array<{ plain_text: string }>)?.[0]?.plain_text || '';
        case 'rich_text':
          return (prop.rich_text as Array<{ plain_text: string }>)?.map(t => t.plain_text).join('') || '';
        case 'select':
          return (prop.select as { name: string })?.name || null;
        case 'multi_select':
          return (prop.multi_select as Array<{ name: string }>)?.map(s => s.name) || [];
        case 'number':
          return prop.number;
        default:
          return null;
      }
    };

    // Find title property
    let title = '';
    for (const [, prop] of Object.entries(props)) {
      if ((prop as Record<string, unknown>).type === 'title') {
        title = getValue(prop as Record<string, unknown>) as string;
        break;
      }
    }

    return {
      title,
      description: getValue(props['Description']),
      skills: getValue(props['Compétences']) || getValue(props['Skills']),
      location: getValue(props['Localisation']) || getValue(props['Location']),
      remote: getValue(props['Remote']) || getValue(props['Télétravail']),
      mustHave: getValue(props['Must have']) || getValue(props['Critères Must']),
      shouldHave: getValue(props['Should have']) || getValue(props['Critères Should']),
      client: {
        name: getValue(props['Client']) || getValue(props['Entreprise']),
      },
    };
  } catch (err) {
    console.error('Failed to fetch Notion job:', err);
    return null;
  }
}

// ============ EXISTING HELPERS ============

async function checkStepCondition(
  _supabase: unknown,
  conditionType: string,
  accountId: string,
  profileId: string,
  waitForEvent?: string
): Promise<boolean | 'wait'> {
  switch (conditionType) {
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

async function getProfileInfo(accountId: string, profileId: string): Promise<{
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

async function checkHasProspectReplied(accountId: string, profileId: string): Promise<boolean> {
  try {
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
      
      const prospectMessages = messages.filter((m: { is_sender_self?: boolean; sender_attendee_id?: string }) => 
        !m.is_sender_self && m.sender_attendee_id !== 'self'
      );
      
      if (prospectMessages.length > 0) {
        return true;
      }
    }
    
    return false;
  } catch {
    return false;
  }
}

// deno-lint-ignore no-explicit-any
async function executeStepAction(
  actionType: string,
  enrollment: Record<string, unknown>,
  step: Record<string, unknown>,
  execution: Record<string, unknown>,
  supabase: any
): Promise<{ success: boolean; error?: string; subject?: string; message?: string }> {
  try {
    const accountId = enrollment.account_id as string;
    const profileId = enrollment.profile_id as string;
    const messageText = (execution.final_message || step.message_template || '') as string;
    const subjectText = (execution.final_subject || step.subject_template || '') as string;

    switch (actionType) {
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
        
        const messageBody: Record<string, unknown> = {
          account_id: accountId,
          attendees: [{ provider_id: profileId }],
          text: messageText,
        };
        
        if (!isConnected && subjectText) {
          messageBody.subject = subjectText;
        }
        
        const msgResponse = await fetch(`${UNIPILE_DSN}/api/v1/chats`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_API_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messageBody),
        });
        
        if (msgResponse.ok) {
          await logAnalytics(supabase, enrollment.sequence_id as string, 'messages_sent');
        }
        
        return { 
          success: msgResponse.ok,
          message: messageText,
          subject: !isConnected ? subjectText : undefined,
        };
      }

      case 'connection_request': {
        const connectBody: Record<string, unknown> = {
          account_id: accountId,
          provider_id: profileId,
        };
        
        if (messageText) {
          // Limit invitation note to 50 characters
          connectBody.message = messageText.slice(0, 50);
        }
        
        const connectResponse = await fetch(`${UNIPILE_DSN}/api/v1/users/invite`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_API_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(connectBody),
        });
        
        if (connectResponse.ok) {
          await logAnalytics(supabase, enrollment.sequence_id as string, 'invites_sent');
          
          await supabase
            .from('sequence_enrollments')
            .update({ connection_status: 'pending_invite' })
            .eq('id', enrollment.id);
        }
        
        return { success: connectResponse.ok, message: messageText?.slice(0, 50) };
      }

      default:
        return { success: false, error: `Unknown action type: ${actionType}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' };
  }
}

// deno-lint-ignore no-explicit-any
async function logAnalytics(
  supabase: any,
  sequenceId: string,
  field: 'invites_sent' | 'invites_accepted' | 'messages_sent' | 'replies_received' | 'profile_visits'
) {
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

// deno-lint-ignore no-explicit-any
async function scheduleNextStep(supabase: any, enrollment: any, currentStepOrder: number, forceBranchStepId?: string) {
  let nextStep;
  
  if (forceBranchStepId) {
    const { data } = await supabase
      .from('sequence_steps')
      .select('*')
      .eq('id', forceBranchStepId)
      .maybeSingle();
    nextStep = data;
  } else {
    const { data } = await supabase
      .from('sequence_steps')
      .select('*')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('step_order', currentStepOrder + 1)
      .maybeSingle();
    nextStep = data;
  }

  if (!nextStep) {
    await supabase
      .from('sequence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', enrollment.id);
    return;
  }

  const scheduledAt = new Date();
  scheduledAt.setMinutes(scheduledAt.getMinutes() + (nextStep.delay_minutes || 0));
  scheduledAt.setDate(scheduledAt.getDate() + (nextStep.delay_days || 0));
  scheduledAt.setHours(scheduledAt.getHours() + (nextStep.delay_hours || 0));
  
  const preferredStart = nextStep.preferred_hour_start ?? 9;
  const preferredEnd = nextStep.preferred_hour_end ?? 18;
  
  if (scheduledAt.getHours() < preferredStart) {
    scheduledAt.setHours(preferredStart, Math.floor(Math.random() * 30), 0);
  } else if (scheduledAt.getHours() >= preferredEnd) {
    scheduledAt.setDate(scheduledAt.getDate() + 1);
    scheduledAt.setHours(preferredStart, Math.floor(Math.random() * 30), 0);
  }

  const day = scheduledAt.getDay();
  if (day === 0) scheduledAt.setDate(scheduledAt.getDate() + 1);
  if (day === 6) scheduledAt.setDate(scheduledAt.getDate() + 2);

  await supabase
    .from('sequence_step_executions')
    .insert({
      enrollment_id: enrollment.id,
      step_id: nextStep.id,
      step_order: nextStep.step_order,
      scheduled_at: scheduledAt.toISOString(),
      status: 'scheduled',
    });
}

// deno-lint-ignore no-explicit-any
async function checkTimeoutBranches(supabase: any) {
  const { data: waitingExecutions } = await supabase
    .from('sequence_step_executions')
    .select(`
      *,
      enrollment:sequence_enrollments(*),
      step:sequence_steps(*)
    `)
    .eq('status', 'waiting_event')
    .not('step.timeout_days', 'is', null);

  if (!waitingExecutions?.length) return { checked: 0, branched: 0 };

  let branched = 0;

  for (const exec of waitingExecutions) {
    const step = exec.step;
    const enrollment = exec.enrollment;
    
    if (!step?.timeout_days || !enrollment) continue;

    const waitingSince = new Date(exec.created_at);
    const now = new Date();
    const daysPassed = Math.floor((now.getTime() - waitingSince.getTime()) / (1000 * 60 * 60 * 24));

    if (daysPassed >= step.timeout_days) {
      if (step.timeout_branch_step_id) {
        await supabase
          .from('sequence_step_executions')
          .update({ 
            status: 'skipped', 
            skip_reason: `Timeout after ${step.timeout_days} days - branching to alternative`,
            executed_at: now.toISOString(),
          })
          .eq('id', exec.id);

        await scheduleNextStep(supabase, enrollment, step.step_order, step.timeout_branch_step_id);
        branched++;
      } else {
        await supabase
          .from('sequence_step_executions')
          .update({ 
            status: 'skipped', 
            skip_reason: `Timeout after ${step.timeout_days} days - no branch configured`,
            executed_at: now.toISOString(),
          })
          .eq('id', exec.id);

        await scheduleNextStep(supabase, enrollment, step.step_order);
      }
    }
  }

  return { checked: waitingExecutions.length, branched };
}

async function checkForReply(accountId: string, profileId: string): Promise<boolean> {
  return await checkHasProspectReplied(accountId, profileId);
}
