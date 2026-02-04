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

// ============ HUMAN ACTIVITY SIMULATION ============

// Check if current time is within business hours (8h-19h) for the given timezone
function isWithinBusinessHours(timezone: string): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(formatter.format(now), 10);
    
    // Also check if it's a weekend
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    });
    const day = dayFormatter.format(now);
    const isWeekend = day === "Sat" || day === "Sun";
    
    // Business hours: 8h to 19h, Monday-Friday
    return !isWeekend && hour >= 8 && hour < 19;
  } catch (e) {
    console.error("Error checking business hours:", e);
    // Default to Paris timezone if invalid
    const now = new Date();
    const parisHour = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getHours();
    const parisDay = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getDay();
    return parisDay !== 0 && parisDay !== 6 && parisHour >= 8 && parisHour < 19;
  }
}

// Get a random delay between min and max minutes in milliseconds
function getRandomDelayMs(minMinutes: number, maxMinutes: number): number {
  const minMs = minMinutes * 60 * 1000;
  const maxMs = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * (maxMs - minMs) + minMs);
}

// Calculate next business hour slot if we're outside business hours
function getNextBusinessHourSlot(timezone: string): Date {
  const now = new Date();
  
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    });
    
    let targetDate = new Date(now);
    
    // Check day and hour, skip to next valid slot
    for (let i = 0; i < 7; i++) {
      const day = dayFormatter.format(targetDate);
      const hour = parseInt(formatter.format(targetDate), 10);
      
      const isWeekend = day === "Sat" || day === "Sun";
      
      if (isWeekend) {
        // Skip to next day at 8h
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(8, Math.floor(Math.random() * 30), 0, 0);
        continue;
      }
      
      if (hour >= 19) {
        // After hours - skip to next day at 8h
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(8, Math.floor(Math.random() * 30), 0, 0);
        continue;
      }
      
      if (hour < 8) {
        // Before hours - set to 8h with random offset
        targetDate.setHours(8, Math.floor(Math.random() * 30), 0, 0);
      }
      
      // We're in a valid slot
      break;
    }
    
    return targetDate;
  } catch (e) {
    console.error("Error calculating next business slot:", e);
    // Fallback: add 1 hour
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
}

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

            // ============ HUMAN ACTIVITY SIMULATION ============
            // Check if we're within business hours for the user's timezone
            const userTimezone = enrollment.user_timezone || 'Europe/Paris';
            if (!isWithinBusinessHours(userTimezone)) {
              // Reschedule for next business hour slot
              const nextSlot = getNextBusinessHourSlot(userTimezone);
              console.log(`[process-sequences] Outside business hours for ${userTimezone}, rescheduling to ${nextSlot.toISOString()}`);
              
              await supabase
                .from('sequence_step_executions')
                .update({ 
                  scheduled_at: nextSlot.toISOString(),
                })
                .eq('id', exec.id);
              results.skipped++;
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
        // Unipile returns: { recruiter: number, premium: number | null, sales_navigator: number | null }
        const recruiterCredits = balance.recruiter || balance.recruiter_balance || 0;
        const premiumCredits = balance.premium || balance.premium_balance || 0;
        const salesNavCredits = balance.sales_navigator || balance.sales_navigator_balance || 0;
        
        const totalCredits = recruiterCredits + premiumCredits + salesNavCredits;
        
        console.log(`[process-sequences] InMail balance check:`, {
          recruiter: recruiterCredits,
          premium: premiumCredits,
          salesNav: salesNavCredits,
          total: totalCredits,
        });
        
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
        
        // Query sent executions for connection_request steps directly
        const { data: sentInvites } = await supabase
          .from('sequence_step_executions')
          .select(`
            id,
            step:sequence_steps!inner(action_type)
          `)
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

    // 4. Determine message type based on action history, not just step order
    const actionType = step.action_type as string;
    const isInvitation = actionType === 'connection_request';
    
    // Check if a connection_request was sent before (invitation workflow)
    const hadInvitation = previousSteps?.some((ps: Record<string, unknown>) => 
      (ps.step as Record<string, unknown>)?.action_type === 'connection_request'
    );
    
    // Check if any actual message/inmail was already sent
    const hadPreviousMessage = previousSteps?.some((ps: Record<string, unknown>) => 
      ['message', 'inmail', 'smart_message'].includes((ps.step as Record<string, unknown>)?.action_type as string)
    );
    
    // Message type logic:
    // - If we had an invitation before but no message yet → "SUITE INVITATION" (not "RELANCE")
    // - If we had a previous message → "RELANCE"
    // - If no previous contact → "PREMIER MESSAGE"
    let messageType: string;
    if (isInvitation) {
      messageType = 'INVITATION (max 50 caractères pour la note)';
    } else if (hadPreviousMessage) {
      messageType = 'RELANCE';
    } else if (hadInvitation) {
      messageType = 'SUITE INVITATION';
    } else {
      messageType = 'PREMIER MESSAGE';
    }

    // 5. Get sender name from profile or LinkedIn account
    let senderName: string | undefined;
    
    // First, try to get from profiles table
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', enrollment.created_by)
      .single();
    
    if (userProfile?.display_name) {
      senderName = userProfile.display_name;
    } else {
      // Fallback: get the LinkedIn account name
      try {
        const accountResponse = await fetch(
          `${UNIPILE_DSN}/api/v1/accounts/${enrollment.account_id}`,
          { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
        );
        if (accountResponse.ok) {
          const accountData = await accountResponse.json();
          // Use just the first name from the account
          senderName = accountData.name?.split(' ')[0] || accountData.name;
        }
      } catch (e) {
        console.warn('Failed to fetch account name:', e);
      }
    }

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
      senderName,
    });

    // 6. Call Claude with enhanced system prompt
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
        system: `Tu es un recruteur tech senior. Tu écris des messages LinkedIn courts, directs, humains. JAMAIS de superlatifs, JAMAIS de tournures IA. Tu parles comme un vrai humain pressé mais sympa. Tu réponds TOUJOURS en JSON valide, sans markdown ni code blocks.`,
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
  senderName?: string;
}

function buildPersonalizationPrompt(params: PersonalizationParams): string {
  const { profile, job, messageType, previousMessages, template, tone, isInvitation, senderName } = params;

  const toneInstructions: Record<string, string> = {
    professional: "Vouvoiement obligatoire. Ton direct, sobre et respectueux. Langage professionnel standard, pas de jargon startup ni d'expressions familières. Évite 'ton taf', 'mise gros', 'ça colle', etc.",
    casual: "Tutoiement naturel mais reste professionnel. Comme un message à un pair du secteur. Évite le jargon trop startup ('ton taf', 'mise gros'). Reste accessible sans être familier.",
    enthusiastic: "Tutoiement, ton dynamique mais mesuré. Montre de l'intérêt sans surjouer. Garde un vocabulaire professionnel, évite les expressions trop cool."
  };

  // Build salary info for the prompt
  const salaryInfo: string[] = [];
  if (job?.salaryMin || job?.salaryMax) {
    salaryInfo.push(`Salaire: ${job.salaryMin || '?'}k€ - ${job.salaryMax || '?'}k€`);
  }
  if (job?.tjmMin || job?.tjmMax) {
    salaryInfo.push(`TJM: ${job.tjmMin || '?'}€ - ${job.tjmMax || '?'}€/jour`);
  }

  // Build criteria context
  const criteriaContext: string[] = [];
  if (job?.mustHave) criteriaContext.push(`Must-have: ${job.mustHave}`);
  if (job?.shouldHave) criteriaContext.push(`Should-have: ${job.shouldHave}`);
  if (job?.niceToHave) criteriaContext.push(`Nice-to-have: ${job.niceToHave}`);

  // Determine message objective based on message type
  const statusInstructions: Record<string, string> = {
    'PREMIER MESSAGE': `
OBJECTIF: QUALIFIER OU PROPOSER UN CALL
- SI le profil semble déjà matcher (skills visibles, XP cohérente) → propose directement un call
- SI des infos critiques manquent dans le profil (techno clé, niveau management, etc.) → pose UNE question pertinente
- NE POSE PAS de question sur l'anglais sauf si c'est explicitement un must-have critique
- PRÉFÈRE un CTA direct ("Dispo pour un call ?") plutôt qu'une question de qualification générique`,
    
    'SUITE INVITATION': `
OBJECTIF: PREMIER VRAI MESSAGE APRÈS ACCEPTATION D'INVITATION
- C'est ton PREMIER MESSAGE de fond après une simple invitation LinkedIn
- NE DIS JAMAIS "je reviens vers vous" ou "suite à notre échange" car il n'y a PAS EU d'échange
- Commence directement par présenter le poste de manière engageante
- Remercie brièvement pour l'acceptation (1 phrase max) puis enchaîne sur le pitch
- Tu peux mentionner "Merci d'avoir accepté" mais PAS "je reviens" ou "nous avions parlé"
- Structure: Remerciement court (optionnel) → Accroche perso → Pitch poste → CTA`,
    
    'RELANCE': `
OBJECTIF: RELANCER
Message court de relance, rappelle le contexte du message précédent + question ouverte ou CTA direct.
Fais référence à ton message précédent de manière naturelle.`,
    
    'INVITATION (max 50 caractères pour la note)': `
OBJECTIF: INVITATION LINKEDIN
Maximum 50 caractères ! Sois ultra concis et percutant.
Exemples: "Votre profil Python m'intéresse", "On recrute chez [Client]", "Poste [Titre] - échangeons ?"`,
  };

  // Build experiences string
  const experiencesStr = profile?.experiences 
    ? (profile.experiences as Array<{title?: string; company?: string; duration?: string}>)
        .slice(0, 3)
        .map(exp => `${exp.title || ''} chez ${exp.company || ''} (${exp.duration || ''})`)
        .join('; ')
    : 'Non spécifiées';

  const prompt = `Tu es un recruteur tech senior. Tu écris des messages LinkedIn ULTRA personnalisés et percutants.

PROFIL DU CANDIDAT:
- Prénom: ${(profile?.name as string)?.split(' ')[0] || 'Candidat'}
- Titre: ${profile?.headline || 'Non spécifié'}
- Poste actuel: ${profile?.current_role || profile?.headline || 'Non spécifié'} chez ${profile?.current_company || 'Non spécifié'}
- Localisation: ${profile?.location || 'Non spécifié'}
- Compétences: ${(profile?.skills as string[])?.slice(0, 10).join(', ') || 'Non spécifiées'}
- Expériences passées: ${experiencesStr}
${profile?.summary ? `
=== SECTION "À PROPOS" DU CANDIDAT (SOURCE CLÉ DE PERSONNALISATION ET DE STYLE) ===
"${(profile.summary as string).slice(0, 800)}"
=== FIN À PROPOS ===

IMPORTANT - ANALYSE LE STYLE D'ÉCRITURE DU CANDIDAT:
- Observe comment il écrit: phrases courtes ou longues ? Formel ou décontracté ?
- Utilise-t-il des émojis, de l'humour, des expressions familières ?
- Son ton est-il corporate, startup, créatif, technique ?
- ADAPTE TON MESSAGE À SON STYLE pour créer une résonance naturelle` : ''}

POSTE À POURVOIR:
- Titre: ${job?.title || 'Non spécifié'}
- Client: ${(job?.client as Record<string, unknown>)?.name || 'Client confidentiel'} (${(job?.client as Record<string, unknown>)?.sector || 'Tech'})
- Compétences requises: ${(job?.skills as string[])?.join(', ') || 'Non spécifiées'}
- Séniorité: ${job?.seniority || 'Non spécifié'} | XP: ${job?.xpMin || '?'}-${job?.xpMax || '?'} ans
- Localisation: ${job?.location || 'Non spécifié'}
- Télétravail: ${job?.remote || 'Non spécifié'}
- Type contrat: ${job?.contractType || 'Non spécifié'}
${salaryInfo.length > 0 ? `- Rémunération: ${salaryInfo.join(' | ')}` : ''}
${criteriaContext.length > 0 ? `- Critères clés: ${criteriaContext.join(' | ')}` : ''}
${job?.description ? `- Contexte mission: ${(job.description as string).slice(0, 300)}...` : ''}

TYPE DE MESSAGE: ${messageType}
${statusInstructions[messageType] || statusInstructions['PREMIER MESSAGE']}

HISTORIQUE DE LA SÉQUENCE:
${previousMessages}
${template ? `
TEMPLATE DE BASE (à personnaliser):
"${template}"` : ''}

=== RÈGLES ABSOLUES ===

1. PERSONNALISATION = LA PRIORITÉ #1
   La section "À propos" est une MINE D'OR. Cherche:
   - Une passion technique mentionnée ("j'aime les systèmes distribués", "le clean code c'est ma religion")
   - Un side project, une contribution open source
   - Une motivation personnelle ("j'ai quitté X pour rejoindre une startup")
   - Un style de travail ("je préfère les petites équipes", "ownership total")
   - Une techno qu'il dit aimer particulièrement
   
   SI tu trouves quelque chose dans le À propos, UTILISE-LE comme accroche.
   C'est ce qui fait la différence entre un message générique et un message qui convertit.

2. ADAPTATION DU STYLE AU CANDIDAT:
   - SI le candidat écrit de façon décontractée avec des émojis → sois plus casual
   - SI le candidat est très corporate/formel → reste pro mais pas froid
   - SI le candidat montre de l'humour → ose une touche légère
   - SI le candidat est très technique/précis → sois concis et factuel
   
   Le but: que le candidat ait l'impression de lire un message d'un pair, pas d'un robot.

3. EXEMPLES D'ACCROCHES PERSONNALISÉES (inspirés du À propos):
   - "Tu mentionnes ton amour du clean code dans ton profil - on cherche exactement ça chez [Client]"
   - "J'ai vu que tu avais contribué à [projet open source] - le CTO est très orienté communauté"
   - "Tu parles de ton passage de corporate à startup - c'est pile le mouvement inverse qu'on propose"
   - "Ton focus sur les archi event-driven colle parfaitement avec ce qu'on monte chez [Client]"

4. TON: ${toneInstructions[tone] || toneInstructions.professional}

5. NE POSE PAS DE QUESTION SI:
   - Le profil semble déjà matcher → propose un call directement
   - Tu n'as pas de vraie question de qualification → CTA direct
   - ÉVITE les questions sur l'anglais (sauf si vraiment critique et absent du profil)

6. INTERDITS:
   - "j'ai parcouru ton profil", "a retenu mon attention", "m'a tapé dans l'œil"
   - Superlatifs: exceptionnel, remarquable, impressionnant
   - Questions génériques: "ça t'intéresserait ?", "tu serais ouvert ?"
   - Forcer une question quand un CTA suffit
   - FORMAT CHIFFRES: JAMAIS de "20+", "10+", "5+" → écrire "plus de 20", "plus de 10", "plus de 5"
   - JARGON TROP COOL/STARTUP: "ton taf", "mise gros", "ça colle", "c'est chaud", "le kiff", "la bombe"
   - EXPRESSIONS FAMILIÈRES: évite les raccourcis trop oraux même en mode casual

7. FORMAT OBLIGATOIRE:
   ${isInvitation ? `⚠️ CONTRAINTE CRITIQUE: MAXIMUM 50 CARACTÈRES TOTAL (espaces inclus) ⚠️
   - LinkedIn coupe le message à 50 caractères, tout ce qui dépasse est PERDU
   - COMPTE tes caractères ! Exemples valides:
     • "Profil Data intéressant !" (24 car) ✓
     • "On recrute chez [Client]" (25 car) ✓  
     • "Poste Tech Lead - dispo ?" (26 car) ✓
   - PAS de salutation (Salut X, Bonjour) → gaspille des caractères
   - PAS de sauts de ligne
   - VA DROIT AU BUT en moins de 50 caractères` : `- 80-100 mots maximum
   - Phrases courtes et percutantes
   - SAUTS DE LIGNE entre chaque paragraphe/idée (2-3 paragraphes distincts)
   - Structure type: Accroche perso (1-2 phrases) → Pitch poste (2-3 phrases) → CTA (1 phrase)`}
   ${!isInvitation ? `- Signature: "${senderName || '[Prénom]'}"` : ''}

Réponds UNIQUEMENT en JSON valide:
{
  "subject": "Objet court (max 50 car)",
  "message": "${isInvitation ? 'Note COURTE de max 50 caractères sans salutation' : 'Le message complet avec des \\\\n\\\\n entre les paragraphes'}"
}`;

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
      // Add public_identifier for connection requests
      public_identifier: data.public_identifier || data.public_profile_identifier,
      profile_url: data.public_profile_url || data.profile_url,
    };
  } catch (err) {
    console.error('Failed to fetch LinkedIn profile:', err);
    return null;
  }
}

// Fetch job context from Notion with full details
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
      seniority: getValue(props['Séniorité']) || getValue(props['Seniority']),
      xpMin: getValue(props['XP Min']) || getValue(props['Expérience Min']),
      xpMax: getValue(props['XP Max']) || getValue(props['Expérience Max']),
      salaryMin: getValue(props['Salaire Min']) || getValue(props['Salary Min']),
      salaryMax: getValue(props['Salaire Max']) || getValue(props['Salary Max']),
      tjmMin: getValue(props['TJM Min']),
      tjmMax: getValue(props['TJM Max']),
      contractType: getValue(props['Type de contrat']) || getValue(props['Contract Type']),
      mustHave: getValue(props['Must have']) || getValue(props['Critères Must']),
      shouldHave: getValue(props['Should have']) || getValue(props['Critères Should']),
      niceToHave: getValue(props['Nice to have']) || getValue(props['Critères Nice']),
      client: {
        name: getValue(props['Client']) || getValue(props['Entreprise']),
        sector: getValue(props['Secteur']) || getValue(props['Sector']),
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
  // NOTE: Some “wait_*” steps are stored with condition_type='always' in DB.
  // If a step declares wait_for_event, we must treat it as a blocking condition.
  // This keeps legacy data working and routes these steps through the waiting_event mechanism.
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
      case 'wait_connection': {
        // This step is a pure “gate”: the actual waiting happens in checkStepCondition()
        // (status=waiting_event) + check_wait_events/check_timeouts.
        // Once the event is satisfied, we simply allow the sequence to continue.
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
        // Unipile requires multipart/form-data for /chats endpoint
        // Doc: https://developer.unipile.com/docs/send-messages
        const profile = await getProfileInfo(accountId, profileId);
        const isConnected = profile?.network_distance === 'FIRST_DEGREE';
        const needsInMail = !isConnected && (actionType === 'inmail' || actionType === 'smart_message');
        
        const formData = new FormData();
        formData.append('account_id', accountId);
        formData.append('attendees_ids', profileId); // Provider internal ID (LinkedIn URN)
        formData.append('text', messageText);
        
        // For InMails (2nd/3rd degree contacts), add LinkedIn-specific params
        if (needsInMail) {
          formData.append('linkedin[api]', 'recruiter');
          formData.append('linkedin[inmail]', 'true');
          if (subjectText) {
            formData.append('linkedin[subject]', subjectText);
          }
        }
        
        console.log(`[process-sequences] Sending ${needsInMail ? 'InMail' : 'message'} to ${profileId}`, {
          accountId,
          profileId,
          isConnected,
          needsInMail,
          hasSubject: !!subjectText,
          textLength: messageText.length,
        });
        
        const msgResponse = await fetch(`${UNIPILE_DSN}/api/v1/chats`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_API_KEY!,
            // Don't set Content-Type - browser/fetch will set it with boundary for FormData
          },
          body: formData,
        });
        
        if (!msgResponse.ok) {
          const errorText = await msgResponse.text();
          console.error(`[process-sequences] Message send failed:`, msgResponse.status, errorText);
          return { 
            success: false, 
            error: `Unipile error ${msgResponse.status}: ${errorText}` 
          };
        }
        
        const msgResult = await msgResponse.json();
        console.log(`[process-sequences] Message sent successfully:`, msgResult.id || msgResult.chat_id);
        
        await logAnalytics(supabase, enrollment.sequence_id as string, 'messages_sent');
        
        return { 
          success: true,
          message: messageText,
          subject: needsInMail ? subjectText : undefined,
        };
      }

      case 'connection_request': {
        // Unipile invite endpoint requires a provider_id starting with "ACo..."
        // Doc: https://developer.unipile.com/docs/invite-users
        // The profileId from search may be in a different format (AEM..., ADo..., etc.)
        // We need to fetch the profile first to get the correct provider_id
        
        // Truncate smartly to 50 chars - cut at last space to avoid mid-word cuts
        let inviteNote = '';
        if (messageText) {
          if (messageText.length <= 50) {
            inviteNote = messageText;
          } else {
            // Find last space before char 50
            const truncated = messageText.slice(0, 50);
            const lastSpace = truncated.lastIndexOf(' ');
            inviteNote = lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
          }
        }
        
        // Resolve provider_id (ACo...) for the invite endpoint
        let correctProviderId = profileId;
        const profileUrl = enrollment.profile_url as string | undefined;

        const extractProviderId = (profileData: any): string | undefined => {
          return (
            profileData?.provider_id ||
            profileData?.providerId ||
            profileData?.provider?.id ||
            profileData?.provider?.provider_id
          );
        };

        const fetchProfile = async (identifier: string, source: string, linkedinApi?: 'recruiter' | 'sales_navigator') => {
          try {
            const url = new URL(`${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(identifier)}`);
            url.searchParams.set('account_id', accountId);
            if (linkedinApi) url.searchParams.set('linkedin_api', linkedinApi);

            const profileResponse = await fetch(
              url.toString(),
              {
                headers: {
                  'X-API-KEY': UNIPILE_API_KEY!,
                  'accept': 'application/json',
                },
              }
            );

            if (!profileResponse.ok) {
              console.warn(`[process-sequences] Could not fetch profile (${source}) for ${identifier}:`, profileResponse.status);
              return null;
            }

            const profileData = await profileResponse.json();
            return profileData;
          } catch (err) {
            console.warn(`[process-sequences] Error fetching profile (${source}):`, err);
            return null;
          }
        };

        const setProviderIdFromProfile = (profileData: any, source: string) => {
          const providerId = extractProviderId(profileData);
          if (providerId) {
            correctProviderId = providerId;
            console.log(`[process-sequences] Resolved provider_id (${source}): ${correctProviderId}`);
            return true;
          }
          console.warn(`[process-sequences] No provider_id in profile response (${source})`, {
            hasPublicIdentifier: !!profileData?.public_identifier,
            provider: profileData?.provider,
          });
          return false;
        };

        // If profileId isn't already a classic provider_id, try resolving it.
        if (typeof profileId === 'string' && !profileId.startsWith('ACo') && !profileId.startsWith('ADo')) {
          // 1) Recruiter IDs (AE... / AEM...) need a 2-step conversion:
          //    - fetch recruiter profile to get public_identifier
          //    - fetch classic profile by public_identifier to get ACo... provider_id
          if (profileId.startsWith('AE') || profileId.startsWith('AEM')) {
            const recruiterProfile = await fetchProfile(profileId, 'recruiter_by_profile_id', 'recruiter');
            if (recruiterProfile) {
              // Sometimes Unipile may already include a classic provider_id; try it first.
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

          // 2) Fallback: resolve by public_identifier from a /in/{slug} URL (classic)
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
            accountId,
            originalProfileId: profileId,
            resolvedProviderId: correctProviderId,
            profileUrl,
          });
        }
        
        const inviteBody: Record<string, string> = {
          account_id: accountId,
          provider_id: correctProviderId,
        };
        
        if (inviteNote) {
          inviteBody.message = inviteNote;
        }
        
        console.log(`[process-sequences] Sending connection request`, {
          accountId,
          originalProfileId: profileId,
          resolvedProviderId: correctProviderId,
          noteLength: inviteNote.length,
        });
        
        const connectResponse = await fetch(`${UNIPILE_DSN}/api/v1/users/invite`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_API_KEY!,
            'Content-Type': 'application/json',
            'accept': 'application/json',
          },
          body: JSON.stringify(inviteBody),
        });
        
        if (!connectResponse.ok) {
          const errorText = await connectResponse.text();
          console.error(`[process-sequences] Invite failed:`, connectResponse.status, errorText);
          return { 
            success: false, 
            error: `Unipile invite error ${connectResponse.status}: ${errorText}` 
          };
        }
        
        console.log(`[process-sequences] Invitation sent successfully to ${correctProviderId}`);
        await logAnalytics(supabase, enrollment.sequence_id as string, 'invites_sent');
        
        await supabase
          .from('sequence_enrollments')
          .update({ connection_status: 'pending_invite' })
          .eq('id', enrollment.id);
        
        return { success: true, message: inviteNote };
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

    // If the next step is actually configured as a timeout-branch target for the current step,
    // skip it in the normal linear flow. The timeout path is scheduled explicitly via
    // scheduleNextStep(..., forceBranchStepId) in checkTimeoutBranches().
    if (nextStep) {
      const { data: currentStep } = await supabase
        .from('sequence_steps')
        .select('timeout_branch_step_id')
        .eq('sequence_id', enrollment.sequence_id)
        .eq('step_order', currentStepOrder)
        .maybeSingle();

      const timeoutBranchId = currentStep?.timeout_branch_step_id as string | null | undefined;
      if (timeoutBranchId && nextStep.id === timeoutBranchId) {
        const { data: data2 } = await supabase
          .from('sequence_steps')
          .select('*')
          .eq('sequence_id', enrollment.sequence_id)
          .eq('step_order', currentStepOrder + 2)
          .maybeSingle();
        nextStep = data2;
      }
    }
  }

  if (!nextStep) {
    await supabase
      .from('sequence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', enrollment.id);
    return;
  }

  // ============ SCHEDULE WITH HUMAN-LIKE RANDOMIZATION ============
  const userTimezone = enrollment.user_timezone || 'Europe/Paris';
  
  let scheduledAt = new Date();
  scheduledAt.setMinutes(scheduledAt.getMinutes() + (nextStep.delay_minutes || 0));
  scheduledAt.setDate(scheduledAt.getDate() + (nextStep.delay_days || 0));
  scheduledAt.setHours(scheduledAt.getHours() + (nextStep.delay_hours || 0));
  
  // Add random variation (+/- 0-5 minutes) to appear more human
  const randomVariation = Math.floor(Math.random() * 10) - 5; // -5 to +5 minutes
  scheduledAt.setMinutes(scheduledAt.getMinutes() + randomVariation);
  
  const preferredStart = nextStep.preferred_hour_start ?? 9;
  const preferredEnd = nextStep.preferred_hour_end ?? 18;
  
  // Adjust for business hours
  if (scheduledAt.getHours() < preferredStart) {
    // Add random offset within first 30 min of business hours
    scheduledAt.setHours(preferredStart, Math.floor(Math.random() * 30), 0);
  } else if (scheduledAt.getHours() >= preferredEnd) {
    scheduledAt.setDate(scheduledAt.getDate() + 1);
    scheduledAt.setHours(preferredStart, Math.floor(Math.random() * 30), 0);
  }

  // Skip weekends
  const day = scheduledAt.getDay();
  if (day === 0) scheduledAt.setDate(scheduledAt.getDate() + 1); // Sunday -> Monday
  if (day === 6) scheduledAt.setDate(scheduledAt.getDate() + 2); // Saturday -> Monday
  
  console.log(`[process-sequences] Scheduling next step ${nextStep.step_order} for ${scheduledAt.toISOString()} (timezone: ${userTimezone})`);

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
