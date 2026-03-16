import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Brain, ChevronDown, Search, BarChart3, Send, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentMessage } from '@/hooks/useAgentChat';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { cn } from '@/lib/utils';

interface AgentMessageBubbleProps {
  message: AgentMessage;
  isStreaming?: boolean;
}

export function extractOptions(content: string): string[] {
  const match = content.match(/\[OPTIONS\]\s*(\[[\s\S]*?\])\s*\[\/OPTIONS\]/);
  if (!match) return [];
  try { return JSON.parse(match[1]); } catch { return []; }
}

interface ParsedCandidate {
  name: string;
  title: string;
  score?: 'Go' | 'Maybe' | 'No';
}

function extractCandidates(content: string): { candidates: ParsedCandidate[]; contentWithout: string } {
  // Match patterns like: - **Name** — Title (Go/Maybe/No)  or  - **Name** - Title [Go]
  const candidateRegex = /^[-*]\s+\*{0,2}([A-ZÀ-ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zà-ÿ]+)+)\*{0,2}\s*[—–\-|:]\s*(.+?)(?:\s*[\[(](Go|Maybe|No|go|maybe|no)[\])])?$/gm;
  const candidates: ParsedCandidate[] = [];
  let contentWithout = content;

  const matches = [...content.matchAll(candidateRegex)];
  if (matches.length < 2) return { candidates: [], contentWithout: content };

  for (const m of matches) {
    const score = m[3] ? (m[3].charAt(0).toUpperCase() + m[3].slice(1).toLowerCase()) as 'Go' | 'Maybe' | 'No' : undefined;
    candidates.push({
      name: m[1].trim(),
      title: m[2].trim().replace(/[\[(](Go|Maybe|No|go|maybe|no)[\])]/, '').trim(),
      score,
    });
    contentWithout = contentWithout.replace(m[0], '');
  }

  return { candidates, contentWithout: contentWithout.trim() };
}

export const AgentMessageBubble: React.FC<AgentMessageBubbleProps> = ({ message, isStreaming }) => {
  const isUser = message.role === 'user';
  const isStatus = message.role === 'status';
  const thinking = message.metadata?.thinking as string | undefined;

  const cleanContent = message.content
    .replace(/\[SEARCH_PLAN\][\s\S]*?(\[\/SEARCH_PLAN\]|$)/g, '')
    .replace(/\[AGENT_ACTION\][\s\S]*?(\[\/AGENT_ACTION\]|$)/g, '')
    .replace(/\[OPTIONS\][\s\S]*?(\[\/OPTIONS\]|$)/g, '')
    // Strip AI-style markdown formatting
    .replace(/^#{1,6}\s+/gm, '')                          // headings
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')              // bold/italic
    .replace(/~~([^~]+)~~/g, '$1')                         // strikethrough
    .replace(/^\d+\.\s+/gm, '')                            // numbered lists
    .replace(/`([^`]+)`/g, '$1')                           // inline code
    .replace(/^>\s+/gm, '')                                // blockquotes
    .replace(/---+/g, '')                                  // horizontal rules
    .replace(/\n{3,}/g, '\n\n')                            // collapse extra newlines
    .trim();

  const searchPlan = message.metadata?.search_plan as Record<string, unknown> | undefined;

  // ── Status message ──
  if (isStatus) {
    const StatusIcon = /recherche/i.test(cleanContent) ? Search
      : /scoring/i.test(cleanContent) ? BarChart3
      : /envoi/i.test(cleanContent) ? Send
      : Activity;

    return (
      <div className="flex items-center gap-2.5 px-3 py-2 border border-foreground/8 bg-muted/20 text-xs animate-fade-in">
        <StatusIcon className="w-3.5 h-3.5 text-brutal-accent shrink-0" />
        <span className="text-muted-foreground font-medium">{cleanContent}</span>
      </div>
    );
  }

  // ── User message ──
  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed bg-foreground text-background">
          <div className="[&_p]:my-0">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  // ── Assistant message ──
  const { candidates, contentWithout: finalContent } = !isUser && !isStatus
    ? extractCandidates(cleanContent)
    : { candidates: [], contentWithout: cleanContent };

  // Detect calibration step pattern: "➡️ 3/5 — Expérience" or "✅ 2/5 — Compétences**" etc.
  const stepMatch = finalContent.match(/^[^\w]*(\d+)\/(\d+)\s*[—–\-]\s*(.+?)[\n\r]/);
  const stepCurrent = stepMatch ? parseInt(stepMatch[1]) : null;
  const stepTotal = stepMatch ? parseInt(stepMatch[2]) : null;
  const stepLabel = stepMatch ? stepMatch[3].trim().replace(/\*+/g, '') : null;
  const contentAfterStep = stepMatch
    ? finalContent.slice(finalContent.indexOf('\n', stepMatch.index || 0) + 1).trim()
    : finalContent;

  const displayContent = stepCurrent != null ? contentAfterStep : finalContent;

  return (
    <div className="animate-fade-in space-y-0">
      {/* Thinking card */}
      {thinking && <ThinkingCard thinking={thinking} />}

      {/* Calibration step tag */}
      {stepCurrent != null && stepTotal != null && stepLabel && (
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 bg-foreground text-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]">
            {stepCurrent}/{stepTotal}
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            {stepLabel}
          </span>
        </div>
      )}

      {displayContent && (
        <div className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
          {displayContent}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="space-y-1.5 mt-2">
          {candidates.map((c, i) => (
            <CandidateMiniCard key={i} candidate={c} />
          ))}
        </div>
      )}

      {searchPlan && <SearchPlanCard plan={searchPlan} />}

      {isStreaming && (
        <span className="inline-block w-0.5 h-4 bg-foreground animate-pulse mt-1" />
      )}
    </div>
  );
};

// ── Thinking Card (for saved messages with thinking metadata) ──
function ThinkingCard({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  const stripMd = (t: string) => t
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .trim();

  const lines = thinking.split('\n').filter(l => l.trim() && l.trim().length > 5);
  const displayLines = lines.slice(0, 12).map(l => {
    const cleaned = stripMd(l);
    return cleaned.length > 120 ? cleaned.slice(0, 117) + '…' : cleaned;
  }).filter(Boolean);

  if (displayLines.length === 0) return null;

  return (
    <div className="border border-foreground/10 bg-muted/20 overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="h-[18px] w-[18px] flex items-center justify-center border border-foreground/15">
          <Brain className="w-2.5 h-2.5 text-muted-foreground" />
        </div>
        <span className="text-xs text-muted-foreground font-medium flex-1">
          Réflexion terminée
        </span>
        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
          {displayLines.length} étapes
        </span>
        <ChevronDown className={cn(
          "w-3 h-3 transition-transform text-muted-foreground/40",
          expanded && "rotate-180"
        )} />
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-foreground/8 px-3 py-2.5 space-y-0.5 max-h-[240px] overflow-y-auto scrollbar-hide">
              {displayLines.map((line, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <span className="mt-[6px] h-1 w-1 bg-foreground/15 shrink-0" />
                  <p className="text-[11px] leading-relaxed font-mono text-muted-foreground/70">
                    {line}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Search Plan Card — Timeline style ──
function SearchPlanCard({ plan }: { plan: Record<string, unknown> }) {
  const filters = (plan as any).filters || {};
  const stopConditions = (plan as any).stop_conditions || {};

  const normalizeList = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') return item.trim();
          if (item == null) return '';
          return String(item).trim();
        })
        .filter(Boolean);
    }

    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  };

  const keywords = normalizeList(filters.keywords);
  const locationKeywords = normalizeList(filters.location_keywords);
  const titleKeywords = normalizeList(filters.title_keywords);
  const companyKeywords = normalizeList(filters.company_keywords);
  const skills = normalizeList(filters.skills);

  const criteria: Array<{ label: string; value: string }> = [];

  if (typeof (plan as any).summary === 'string' && (plan as any).summary.trim()) {
    criteria.push({ label: 'Résumé', value: (plan as any).summary.trim() });
  }
  if (keywords.length > 0) {
    criteria.push({ label: 'Mots-clés', value: keywords.join(', ') });
  }
  if (locationKeywords.length > 0) {
    criteria.push({ label: 'Localisation', value: locationKeywords.join(', ') });
  }
  if (filters.calculated_experience_min != null) {
    criteria.push({ label: 'Expérience', value: `${filters.calculated_experience_min}–${filters.calculated_experience_max} ans` });
  }
  if (titleKeywords.length > 0) {
    criteria.push({ label: 'Titre', value: titleKeywords.join(', ') });
  }
  if (companyKeywords.length > 0) {
    criteria.push({ label: 'Entreprises', value: companyKeywords.join(', ') });
  }
  if (skills.length > 0) {
    criteria.push({ label: 'Compétences', value: skills.join(', ') });
  }

  return (
    <div className="border-2 border-foreground/15 overflow-hidden">
      <div className="px-3.5 py-3 flex items-center gap-2.5 border-b border-foreground/10">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground">
          Plan de recherche
        </span>
      </div>

      {/* Criteria list */}
      {criteria.length > 0 && (
        <div className="px-3.5 py-3 space-y-2.5">
          {criteria.map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="h-1.5 w-1.5 bg-foreground/30 shrink-0 mt-[7px]" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</p>
                <p className="text-xs text-foreground/80 mt-0.5 leading-relaxed">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pills */}
      {(locationKeywords.length > 0 || filters.calculated_experience_min != null || stopConditions.target_go_profiles) && (
        <div className="border-t border-foreground/10 px-3.5 py-2.5 flex flex-wrap gap-1.5">
          {locationKeywords.length > 0 && (
            <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] border border-foreground/10 text-foreground/60">
              {locationKeywords.join(', ')}
            </span>
          )}
          {filters.calculated_experience_min != null && (
            <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] border border-foreground/10 text-foreground/60">
              {filters.calculated_experience_min}–{filters.calculated_experience_max} ans
            </span>
          )}
          {stopConditions.target_go_profiles && (
            <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] border border-foreground/10 text-foreground/60">
              {stopConditions.target_go_profiles} profils Go
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Candidate Mini Card ──
const scoreStyles: Record<string, string> = {
  Go: 'bg-green-500/20 text-green-700',
  Maybe: 'bg-amber-500/20 text-amber-700',
  No: 'bg-red-500/20 text-red-700',
};

function CandidateMiniCard({ candidate }: { candidate: ParsedCandidate }) {
  const initials = candidate.name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('');

  return (
    <div className="border border-foreground/10 p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors">
      <div className="w-8 h-8 bg-foreground text-background flex items-center justify-center text-xs font-bold shrink-0">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground truncate">{candidate.name}</p>
        <p className="text-xs text-muted-foreground truncate">{candidate.title}</p>
      </div>
      {candidate.score && (
        <span className={cn(
          "text-[10px] font-bold px-2 py-0.5 shrink-0 uppercase tracking-wider",
          scoreStyles[candidate.score] || ''
        )}>
          {candidate.score}
        </span>
      )}
    </div>
  );
}
