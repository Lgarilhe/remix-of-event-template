import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Brain, ChevronDown, Search, BarChart3, Send, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentMessage } from '@/hooks/useAgentChat';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { filterThinkingLines } from './filterThinking';

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

  // Strip system tags — for streaming, cut everything from an unclosed tag onward
  let rawContent = message.content;
  for (const tag of ['SEARCH_PLAN', 'AGENT_ACTION', 'OPTIONS']) {
    // Remove complete tags
    rawContent = rawContent.replace(new RegExp(`\\[${tag}\\][\\s\\S]*?\\[\\/${tag}\\]`, 'g'), '');
    // If an opening tag remains (streaming, not yet closed), hide everything from it
    const openIdx = rawContent.indexOf(`[${tag}]`);
    if (openIdx !== -1) rawContent = rawContent.slice(0, openIdx);
  }

  const cleanContent = rawContent.replace(/\n{3,}/g, '\n\n').trim();

  const searchPlan = message.metadata?.search_plan as Record<string, unknown> | undefined;

  // ── Status message ──
  if (isStatus) {
    const StatusIcon = /recherche/i.test(cleanContent) ? Search
      : /scoring/i.test(cleanContent) ? BarChart3
      : /envoi/i.test(cleanContent) ? Send
      : Activity;

    return (
      <div className="flex items-center gap-2.5 px-3 py-2 border border-border/8 bg-muted/20 text-xs animate-fade-in">
        <StatusIcon className="w-3.5 h-3.5 text-primary shrink-0" />
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
  const { candidates, contentWithout: afterCandidates } = extractCandidates(cleanContent);

  // Extract summary card if present
  const { summary, remaining: afterSummary } = extractSummary(afterCandidates);

  // Detect calibration step
  const stepMatch = afterSummary.match(/^[^\w]*(\d+)\/(\d+)\s*[—–\-]\s*(.+?)[\n\r]/);
  const stepCurrent = stepMatch ? parseInt(stepMatch[1]) : null;
  const stepTotal = stepMatch ? parseInt(stepMatch[2]) : null;
  const stepLabel = stepMatch ? stepMatch[3].trim().replace(/\*+/g, '') : null;
  const contentAfterStep = stepMatch
    ? afterSummary.slice(afterSummary.indexOf('\n', stepMatch.index || 0) + 1).trim()
    : afterSummary;

  const displayContent = stepCurrent != null ? contentAfterStep : afterSummary;

  return (
    <div className="animate-fade-in space-y-0">
      {thinking && <ThinkingCard thinking={thinking} />}

      {summary && <SummaryCard items={summary.items} tags={summary.tags} />}

      {stepCurrent != null && stepTotal != null && stepLabel && (
        <StepCard
          current={stepCurrent}
          total={stepTotal}
          title={stepLabel}
          question={displayContent.split('\n\n')[0] || ''}
        />
      )}

      {/* Remaining content after step question — or full content if no step */}
      {(() => {
        const remaining = stepCurrent != null
          ? displayContent.split('\n\n').slice(1).join('\n\n').trim()
          : displayContent;
        if (!remaining) return null;
        return (
          <div className="text-sm leading-relaxed">
            <div className="prose prose-sm max-w-none [&_p]:my-1.5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:mt-2 [&_h3]:mb-1 [&_hr]:my-3 [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_li]:marker:text-foreground/50 text-sm text-foreground/80 [&_strong]:text-foreground">
              <ReactMarkdown>{remaining}</ReactMarkdown>
            </div>
          </div>
        );
      })()}

      {candidates.length > 0 && (
        <div className="space-y-1.5 mt-2">
          {candidates.map((c, i) => (
            <CandidateMiniCard key={i} candidate={c} />
          ))}
        </div>
      )}

      {searchPlan && <SearchPlanCard plan={searchPlan} conversationId={message.conversation_id} />}

      {isStreaming && (
        <span className="inline-block w-0.5 h-4 bg-foreground animate-pulse mt-1" />
      )}
    </div>
  );
};

// ── Thinking Card (for saved messages with thinking metadata) ──
function ThinkingCard({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  const displayLines = filterThinkingLines(thinking, 12)
    .map(l => l.length > 120 ? l.slice(0, 117) + '…' : l);

  if (displayLines.length === 0) return null;

  return (
    <div className="border border-border bg-muted/20 overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="h-[18px] w-[18px] flex items-center justify-center border border-border">
          <Brain className="w-2.5 h-2.5 text-muted-foreground" />
        </div>
        <span className="text-xs text-muted-foreground font-medium flex-1">
          Réflexion terminée
        </span>
        <span className="text-xs text-muted-foreground/50 tabular-nums">
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
            <div className="border-t border-border/8 px-3 py-2.5 space-y-0.5 max-h-[240px] overflow-y-auto scrollbar-hide">
              {displayLines.map((line, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <span className="mt-[6px] h-1 w-1 bg-foreground/15 shrink-0" />
                  <p className="text-xs leading-relaxed font-mono text-muted-foreground/70">
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

// ── Step Card ──
function StepCard({ current, total, title, question }: {
  current: number; total: number; title: string; question: string;
}) {
  return (
    <div className="border border-border p-4 mb-2">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-7 h-7 flex items-center justify-center text-xs font-semibold text-primary-foreground shrink-0 skalr-gradient-bg">
          {current}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Étape {current} sur {total}
          </p>
          <p className="text-sm font-semibold text-foreground">{title}</p>
        </div>
      </div>
      {question && (
        <div className="text-sm text-foreground/70 leading-relaxed prose prose-sm max-w-none [&_p]:my-0 [&_strong]:text-foreground/80">
          <ReactMarkdown>{question.replace(/^\*{0,2}➡️?\s*\d+\/\d+\s*[—–\-]\s*.+?\*{0,2}\s*/i, '').trim()}</ReactMarkdown>
        </div>
      )}
      <div className="flex gap-1 mt-3">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-[3px] flex-1",
              i < current - 1
                ? "bg-foreground/25"
                : i === current - 1
                  ? "skalr-gradient-bg"
                  : "bg-foreground/8"
            )}
          />
        ))}
      </div>
    </div>
  );
}

// ── Tech keywords for summary tag extraction ──
const TECH_KEYWORDS = [
  'Python', 'Kubernetes', 'K8s', 'Terraform', 'Docker', 'AWS', 'GCP', 'Azure',
  'CI/CD', 'MLflow', 'Airflow', 'React', 'TypeScript', 'Node.js', 'Go', 'Rust',
  'Java', 'Spring', '.NET', 'PostgreSQL', 'MongoDB', 'Redis', 'Kafka',
  'Jenkins', 'GitLab', 'Linux', 'Ansible', 'Datadog', 'Grafana', 'Prometheus',
  'MLOps', 'LLM', 'DevOps', 'DevSecOps', 'SRE', 'Helm', 'ArgoCD',
  'Elasticsearch', 'Spark', 'Hadoop', 'Flink', 'dbt', 'Snowflake', 'BigQuery',
  'Vue', 'Angular', 'Next.js', 'NestJS', 'Django', 'FastAPI', 'Flask',
  'C++', 'Scala', 'Kotlin', 'Swift', 'PHP', 'Laravel', 'Ruby', 'Rails',
];

// ── Summary Card ──
function SummaryCard({ items, tags }: { items: string[]; tags: string[] }) {
  return (
    <div
      className="pl-4 py-3 bg-muted/10 mb-3"
      style={{ borderLeft: '3px solid hsl(var(--skalr-purple))' }}
    >
      <p
        className="text-xs font-bold uppercase tracking-[0.12em] mb-2.5"
        style={{ color: 'hsl(var(--skalr-purple))' }}
      >
        Résumé du poste
      </p>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2.5 text-sm text-foreground/70 leading-relaxed">
            <span
              className="w-[5px] h-[5px] mt-[7px] shrink-0 opacity-40"
              style={{ background: 'hsl(var(--skalr-purple))' }}
            />
            <span>{item}</span>
          </div>
        ))}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {tags.map((tag, i) => {
            const isXp = /\d+\+?\s*ans/i.test(tag);
            return (
              <span
                key={i}
                className={cn(
                  "text-xs font-medium px-2 py-0.5",
                  isXp
                    ? "bg-[hsl(var(--skalr-purple)/.12)] text-[hsl(var(--skalr-purple))]"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {tag}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Extract summary from assistant content ──
function extractSummary(content: string): { summary: { items: string[]; tags: string[] } | null; remaining: string } {
  const match = content.match(
    /(?:\*{0,2})Résumé du poste(?:\*{0,2})\s*[\n:]\s*([\s\S]*?)(?=(?:\n[^\s·•\-])|(?:\n\s*(?:➡️|\d+\/\d+))|\s*$)/i
  );
  if (!match) return { summary: null, remaining: content };

  const summaryText = match[1].trim();
  const items = summaryText
    .split(/\n/)
    .map(line => line.replace(/^[·•\-*]\s*/, '').trim())
    .filter(s => s.length > 5);

  if (items.length === 0) return { summary: null, remaining: content };

  const fullText = items.join(' ');
  const foundTags: string[] = [];
  for (const kw of TECH_KEYWORDS) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(fullText)) {
      foundTags.push(kw);
    }
  }
  const xpMatch = fullText.match(/(\d+\+?\s*ans)/i);
  if (xpMatch) foundTags.push(xpMatch[1]);

  const remaining = content.replace(match[0], '').trim();
  return { summary: { items, tags: foundTags }, remaining };
}

// ── Search Plan Card — with auto LinkedIn count estimation ──
function SearchPlanCard({ plan, conversationId }: { plan: Record<string, unknown>; conversationId: string }) {
  const filters = (plan as any).filters || {};
  const stopConditions = (plan as any).stop_conditions || {};

  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState(false);

  // Auto-fetch count on mount
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    const fetchCount = async () => {
      setCountLoading(true);
      setCountError(false);
      try {
        const { data, error } = await supabase.functions.invoke('estimate-search-count', {
          body: { conversation_id: conversationId },
        });
        if (!cancelled) {
          if (error || !data?.success) {
            setCountError(true);
          } else {
            setEstimatedCount(data.total);
          }
        }
      } catch {
        if (!cancelled) setCountError(true);
      } finally {
        if (!cancelled) setCountLoading(false);
      }
    };

    fetchCount();
    return () => { cancelled = true; };
  }, [conversationId]);

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
    <div className="border-2 border-border overflow-hidden">
      <div className="px-3.5 py-3 flex items-center justify-between border-b border-border">
        <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground">
          Plan de recherche
        </span>
        {/* LinkedIn count badge */}
        <div className="flex items-center gap-1.5">
          {countLoading ? (
            <span className="text-xs text-muted-foreground/50 animate-pulse">
              Estimation…
            </span>
          ) : countError ? (
            <span className="text-xs text-muted-foreground/40">—</span>
          ) : estimatedCount !== null ? (
            <span className={cn(
              "px-2 py-0.5 text-xs font-bold uppercase tracking-[0.1em] border-2 tabular-nums",
              estimatedCount > 100
                ? "border-success/30 text-success bg-success/5"
                : estimatedCount > 20
                  ? "border-border text-foreground/70"
                  : "border-warning/30 text-warning bg-warning/5"
            )}>
              {estimatedCount.toLocaleString('fr-FR')} profils LinkedIn
            </span>
          ) : null}
        </div>
      </div>

      {/* Criteria list */}
      {criteria.length > 0 && (
        <div className="px-3.5 py-3 space-y-2.5">
          {criteria.map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="h-1.5 w-1.5 bg-foreground/30 shrink-0 mt-[7px]" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</p>
                <p className="text-xs text-foreground/80 mt-0.5 leading-relaxed">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pills */}
      {(locationKeywords.length > 0 || filters.calculated_experience_min != null || stopConditions.target_go_profiles) && (
        <div className="border-t border-border px-3.5 py-2.5 flex flex-wrap gap-1.5">
          {locationKeywords.length > 0 && (
            <span className="px-2 py-1 text-xs font-bold uppercase tracking-[0.1em] border border-border text-foreground/60">
              {locationKeywords.join(', ')}
            </span>
          )}
          {filters.calculated_experience_min != null && (
            <span className="px-2 py-1 text-xs font-bold uppercase tracking-[0.1em] border border-border text-foreground/60">
              {filters.calculated_experience_min}–{filters.calculated_experience_max} ans
            </span>
          )}
          {stopConditions.target_go_profiles && (
            <span className="px-2 py-1 text-xs font-bold uppercase tracking-[0.1em] border border-border text-foreground/60">
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
  Go: 'bg-success/20 text-success',
  Maybe: 'bg-warning/20 text-warning',
  No: 'bg-red-500/20 text-red-700',
};

function CandidateMiniCard({ candidate }: { candidate: ParsedCandidate }) {
  const initials = candidate.name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('');

  return (
    <div className="border border-border p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors">
      <div className="w-8 h-8 bg-foreground text-background flex items-center justify-center text-xs font-bold shrink-0">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground truncate">{candidate.name}</p>
        <p className="text-xs text-muted-foreground truncate">{candidate.title}</p>
      </div>
      {candidate.score && (
        <span className={cn(
          "text-xs font-bold px-2 py-0.5 shrink-0 uppercase tracking-wider",
          scoreStyles[candidate.score] || ''
        )}>
          {candidate.score}
        </span>
      )}
    </div>
  );
}
