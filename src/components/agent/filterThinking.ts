/**
 * Filtre le contenu du thinking pour ne garder que les lignes lisibles.
 * Supprime tout le bruit technique : JSON, noms de champs API, boolean queries,
 * extraits du system prompt, méta-raisonnement sur les instructions.
 */

const TECHNICAL_FIELDS = /company_keywords|location_keywords|skills_filter|calculated_experience|tenure_min|tenure_max|profile_language|network_distance|school_keywords|industry_keywords|function_keywords|group_keywords|company_headcount|recruiting_activity|open_to_work|spotlights|location_within_area|past_company_keywords|skills_keywords|school_names|seniority|role_keywords|title_keywords|search_plan|agent_action|stop_conditions|scoring_criteria|must_have|nice_to_have|target_go_profiles|max_profiles_to_scan/i;

const SYSTEM_PROMPT_ECHOES = /EXCLUSION CLIENT|ÉLARGISSEMENT EXPÉRIENCE|RAYON LOCALISATION|TOP ÉCOLES|EXCLUSIONS NOT|INFÉRENCE EXPÉRIENCE|RÈGLES MÉTIER|RÈGLE CRITIQUE|SYNONYM RING|CONSTRUCTION DES FILTRES|PLAN FINAL|FORMAT DES OPTIONS|STOP CONDITIONS|SCORING CRITERIA|FILTRES DISPONIBLES|FILTRES TEXTUELS|FILTRES ENUM|FILTRES AVANCÉS|FILTRES À RÉSOLUTION|CALIBRATION.*question|RÉSUMÉ.*message 1/i;

const META_THINKING = /selon mes instructions|regardons les instructions|dans mes instructions|d'après le prompt|le system prompt|je dois.*vérifier|voyons.*instructions|d'après les règles|attention.*dans|en fait.*selon|hmm.*regardons|ok.*donc.*je|mais attention|en fait,|hmm,/i;

export function isThinkingLineUseful(line: string): boolean {
  const trimmed = line.trim();

  // Too short or empty
  if (!trimmed || trimmed.length < 12) return false;

  // Starts with JSON, code, arrows, pipes, quotes
  if (/^[\[{(→⇒>|`"']/.test(trimmed)) return false;
  if (/^```/.test(trimmed)) return false;

  // Contains JSON-like structures
  if (/\{.*:.*\}/.test(trimmed)) return false;
  if (/\[.*".*".*\]/.test(trimmed)) return false;

  // Numbered items quoting system prompt
  if (/^\d+\.\s*["*]/.test(trimmed)) return false;
  if (/^"\d+\./.test(trimmed)) return false;

  // API field names anywhere in the line
  if (TECHNICAL_FIELDS.test(trimmed)) return false;

  // Quoted API values
  if (/"keywords"|"priority"|"scope"|"MUST_HAVE"|"CAN_HAVE"|"DOESNT_HAVE"|"CURRENT"|"PAST"|"CURRENT_OR_PAST"/i.test(trimmed)) return false;

  // Boolean queries with OR/AND/NOT and quotes or parens
  if (/NOT\s*\(.*OR.*\)/i.test(trimmed)) return false;
  if (/\bOR\b.*\bOR\b/i.test(trimmed) && /["()]/i.test(trimmed)) return false;
  if (/\bAND\b.*\bOR\b/i.test(trimmed)) return false;

  // Markdown-bold field names: **field_name** or **FIELD**
  if (/\*{2}[A-Za-z_]+\*{2}/.test(trimmed)) return false;

  // System prompt echoes (rules being recited)
  if (SYSTEM_PROMPT_ECHOES.test(trimmed)) return false;

  // Meta-thinking about own instructions
  if (META_THINKING.test(trimmed)) return false;

  // Lines with 2+ technical indicators
  let techScore = 0;
  if (/\barray\b|\bstring\b|\bobject\b|\bboolean\b|\bnull\b/i.test(trimmed)) techScore++;
  if (/\bAPI\b|\bJSON\b|\bformat\b|\bparamètre/i.test(trimmed)) techScore++;
  if (/\bfilter\b|\bfiltre\b|\bchamp\b|\bvaleur\b/i.test(trimmed)) techScore++;
  if (/LinkedIn\s*Recruiter|Unipile|get_parameters/i.test(trimmed)) techScore++;
  if (/\bscope\b|\bpriority\b|\benum\b|\bprefix\b/i.test(trimmed)) techScore++;
  if (techScore >= 2) return false;

  return true;
}

export function filterThinkingLines(content: string, maxLines: number = 3): string[] {
  return content
    .split('\n')
    .filter(isThinkingLineUseful)
    .map(line => line.trim()
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^[-·•]\s*/, '')
      .replace(/^\d+\.\s*/, '')
    )
    .filter(l => l.length > 10)
    .slice(-maxLines);
}
