import React, { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Brain, ChevronDown, Search, BarChart3, Send, Activity, User } from 'lucide-react';
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

interface SampleProfile {
  index: number;
  total: number;
  name: string;
  title: string;
  company: string;
  location: string;
  yearsExp: number;
  trajectory: string[];
  strengths: string[];
  concerns: string[];
  tags: string[];
}

function extractSampleProfiles(content: string): { profiles: SampleProfile[]; contentWithout: string } {
  const profiles: SampleProfile[] = [];
  let contentWithout = content;
  const regex = /\[PROFILE\]\s*(\{[\s\S]*?\})\s*\[\/PROFILE\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      profiles.push(parsed);
      contentWithout = contentWithout.replace(match[0], '');
    } catch {}
  }
  return { profiles, contentWithout: contentWithout.trim() };
}

interface ParsedCandidate {
  name: string;
  title: string;
  score?: 'Go' | 'Maybe' | 'No';
}

function extractCandidates(content: string): { candidates: ParsedCandidate[]; contentWithout: string } {
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

// ── Strip system tags from content ──
function stripSystemTags(content: string, isStreaming: boolean): string {
  let raw = content;
  for (const tag of ['SEARCH_PLAN', 'AGENT_ACTION', 'OPTIONS']) {
    raw = raw.replace(new RegExp(`\\[${tag}\\][\\s\\S]*?\\[\\/${tag}\\]`, 'g'), '');
    if (isStreaming) {
      const openIdx = raw.indexOf(`[${tag}]`);
      if (openIdx !== -1) raw = raw.slice(0, openIdx);
    }
  }
  // Also hide incomplete [PROFILE] tags during streaming
  if (isStreaming) {
    const profileOpenIdx = raw.indexOf('[PROFILE]');
    if (profileOpenIdx !== -1) raw = raw.slice(0, profileOpenIdx);
  }
  return raw.replace(/\n{3,}/g, '\n\n').trim();
}

// ── Prose wrapper for markdown rendering ──
function MarkdownProse({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn(
      "prose prose-sm max-w-none",
      "[&_p]:my-1.5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5",
      "[&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs",
      "[&_h1]:font-bold [&_h2]:font-semibold [&_h3]:font-semibold",
      "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:mt-2.5 [&_h2]:mb-1 [&_h3]:mt-2 [&_h3]:mb-1",
      "[&_hr]:my-3 [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded",
      "[&_li]:marker:text-foreground/40",
      "text-[13px] leading-relaxed text-foreground/80 [&_strong]:text-foreground",
      className,
    )}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

export const AgentMessageBubble: React.FC<AgentMessageBubbleProps> = ({ message, isStreaming }) => {
  const isUser = message.role === 'user';
  const isStatus = message.role === 'status';
  const thinking = message.metadata?.thinking as string | undefined;

  const cleanContent = useMemo(
    () => stripSystemTags(message.content, !!isStreaming),
    [message.content, isStreaming]
  );

  const searchPlan = message.metadata?.search_plan as Record<string, unknown> | undefined;

  // ── Status message ──
  if (isStatus) {
    const StatusIcon = /recherche/i.test(cleanContent) ? Search
      : /scoring/i.test(cleanContent) ? BarChart3
      : /envoi/i.test(cleanContent) ? Send
      : Activity;

    return (
      <div className="flex items-center gap-2.5 px-3 py-2 bg-muted/30 border border-border/50 rounded-lg text-xs animate-fade-in">
        <StatusIcon className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-muted-foreground font-medium">{cleanContent}</span>
      </div>
    );
  }

  // ── User message ──
  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] px-4 py-3 text-[13px] leading-relaxed bg-foreground text-background rounded-2xl rounded-br-sm">
          <div className="[&_p]:my-0">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  // ── STREAMING: simplified view — just show clean markdown, no complex parsing ──
  if (isStreaming) {
    return (
      <div className="animate-fade-in flex gap-2.5">
        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <AnimatedOrb size={18} speed={6} />
        </div>
        <div className="flex-1 min-w-0">
          {cleanContent ? (
            <MarkdownProse content={cleanContent} />
          ) : (
            <div className="flex items-center gap-1.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary/20 animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          <span className="inline-block w-0.5 h-4 bg-primary/60 animate-pulse ml-0.5" />
        </div>
      </div>
    );
  }

  // ── FINAL assistant message — full parsing with rich cards ──
  const { profiles: sampleProfiles, contentWithout: afterProfiles } = extractSampleProfiles(cleanContent);
  const { candidates, contentWithout: afterCandidates } = extractCandidates(afterProfiles);
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
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex gap-2.5"
    >
      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <AnimatedOrb size={18} />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
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

        {/* Remaining text content */}
        {(() => {
          const remaining = stepCurrent != null
            ? displayContent.split('\n\n').slice(1).join('\n\n').trim()
            : displayContent;
          if (!remaining) return null;
          return <MarkdownProse content={remaining} />;
        })()}

        {sampleProfiles.length > 0 && (
          <div className="space-y-2 mt-1">
            {sampleProfiles.map((p, i) => (
              <SampleProfileCard key={i} profile={p} />
            ))}
          </div>
        )}

        {candidates.length > 0 && (
          <div className="space-y-1.5 mt-1">
            {candidates.map((c, i) => (
              <CandidateMiniCard key={i} candidate={c} />
            ))}
          </div>
        )}

        {searchPlan && <SearchPlanCard plan={searchPlan} conversationId={message.conversation_id} />}
      </div>
    </motion.div>
  );
};

// ── Thinking Card ──
function ThinkingCard({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  const displayLines = filterThinkingLines(thinking, 12)
    .map(l => l.length > 120 ? l.slice(0, 117) + '…' : l);

  if (displayLines.length === 0) return null;

  return (
    <div className="border border-border/60 rounded-lg bg-muted/15 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="h-5 w-5 rounded-md bg-muted flex items-center justify-center">
          <Brain className="w-3 h-3 text-muted-foreground" />
        </div>
        <span className="text-xs text-muted-foreground font-medium flex-1">
          Réflexion terminée
        </span>
        <span className="text-[10px] text-muted-foreground/40 tabular-nums">
          {displayLines.length} étapes
        </span>
        <ChevronDown className={cn(
          "w-3 h-3 transition-transform text-muted-foreground/40",
          expanded && "rotate-180"
        )} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/30 px-3 py-2.5 space-y-0.5 max-h-[240px] overflow-y-auto scrollbar-hide">
              {displayLines.map((line, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <span className="mt-[6px] h-1 w-1 rounded-full bg-foreground/15 shrink-0" />
                  <p className="text-[11px] leading-relaxed font-mono text-muted-foreground/60">
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
    <div className="border border-border/60 rounded-xl p-4 bg-muted/10">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0 skalr-gradient-bg">
          {current}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Étape {current}/{total}
          </p>
          <p className="text-sm font-semibold text-foreground">{title}</p>
        </div>
      </div>
      {question && (
        <MarkdownProse
          content={question.replace(/^\*{0,2}➡️?\s*\d+\/\d+\s*[—–\-]\s*.+?\*{0,2}\s*/i, '').trim()}
          className="[&_p]:my-0 text-foreground/70"
        />
      )}
      <div className="flex gap-1 mt-3">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-[3px] flex-1 rounded-full",
              i < current - 1
                ? "bg-foreground/20"
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
      className="pl-4 py-3 bg-muted/10 rounded-lg"
      style={{ borderLeft: '3px solid hsl(var(--skalr-purple))' }}
    >
      <p
        className="text-[10px] font-bold uppercase tracking-wider mb-2.5"
        style={{ color: 'hsl(var(--skalr-purple))' }}
      >
        Résumé du poste
      </p>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2.5 text-[13px] text-foreground/70 leading-relaxed">
            <span
              className="w-[5px] h-[5px] rounded-full mt-[7px] shrink-0 opacity-40"
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
                  "text-[10px] font-medium px-2 py-0.5 rounded-md",
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

// ── Search Plan Card ──
function SearchPlanCard({ plan, conversationId }: { plan: Record<string, unknown>; conversationId: string }) {
  const filters = (plan as any).filters || {};
  const stopConditions = (plan as any).stop_conditions || {};

  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState(false);

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
      return value.split(',').map((item) => item.trim()).filter(Boolean);
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
  if (keywords.length > 0) criteria.push({ label: 'Mots-clés', value: keywords.join(', ') });
  if (locationKeywords.length > 0) criteria.push({ label: 'Localisation', value: locationKeywords.join(', ') });
  if (filters.calculated_experience_min != null) {
    criteria.push({ label: 'Expérience', value: `${filters.calculated_experience_min}–${filters.calculated_experience_max} ans` });
  }
  if (titleKeywords.length > 0) criteria.push({ label: 'Titre', value: titleKeywords.join(', ') });
  if (companyKeywords.length > 0) criteria.push({ label: 'Entreprises', value: companyKeywords.join(', ') });
  if (skills.length > 0) criteria.push({ label: 'Compétences', value: skills.join(', ') });

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between bg-muted/20">
        <span className="text-xs font-bold uppercase tracking-wider text-foreground">
          Plan de recherche
        </span>
        <div className="flex items-center gap-1.5">
          {countLoading ? (
            <span className="text-[10px] text-muted-foreground/50 animate-pulse">Estimation…</span>
          ) : countError ? (
            <span className="text-[10px] text-muted-foreground/40">—</span>
          ) : estimatedCount !== null ? (
            <span className={cn(
              "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md tabular-nums",
              estimatedCount > 100
                ? "bg-success/10 text-success border border-success/20"
                : estimatedCount > 20
                  ? "bg-muted text-foreground/70 border border-border/50"
                  : "bg-warning/10 text-warning border border-warning/20"
            )}>
              {estimatedCount.toLocaleString('fr-FR')} profils
            </span>
          ) : null}
        </div>
      </div>

      {criteria.length > 0 && (
        <div className="px-4 py-3 space-y-2.5">
          {criteria.map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/20 shrink-0 mt-[7px]" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                <p className="text-xs text-foreground/80 mt-0.5 leading-relaxed">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {(locationKeywords.length > 0 || filters.calculated_experience_min != null || stopConditions.target_go_profiles) && (
        <div className="border-t border-border/30 px-4 py-2.5 flex flex-wrap gap-1.5">
          {locationKeywords.length > 0 && (
            <span className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md bg-muted text-muted-foreground">
              {locationKeywords.join(', ')}
            </span>
          )}
          {filters.calculated_experience_min != null && (
            <span className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md bg-muted text-muted-foreground">
              {filters.calculated_experience_min}–{filters.calculated_experience_max} ans
            </span>
          )}
          {stopConditions.target_go_profiles && (
            <span className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md bg-muted text-muted-foreground">
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
  Go: 'bg-success/15 text-success border border-success/20',
  Maybe: 'bg-warning/15 text-warning border border-warning/20',
  No: 'bg-red-500/15 text-red-600 border border-red-500/20',
};

function CandidateMiniCard({ candidate }: { candidate: ParsedCandidate }) {
  const initials = candidate.name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('');

  return (
    <div className="border border-border/50 rounded-lg p-3 flex items-center gap-3 hover:bg-muted/30 transition-colors">
      <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center text-[10px] font-bold shrink-0">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground truncate">{candidate.name}</p>
        <p className="text-xs text-muted-foreground truncate">{candidate.title}</p>
      </div>
      {candidate.score && (
        <span className={cn(
          "text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 uppercase tracking-wider",
          scoreStyles[candidate.score] || ''
        )}>
          {candidate.score}
        </span>
      )}
    </div>
  );
}

// ── Sample Profile Card (calibration phase) ──
function SampleProfileCard({ profile }: { profile: SampleProfile }) {
  const initials = profile.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden bg-card">
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground truncate">{profile.name}</p>
            <span className="text-[10px] text-muted-foreground font-medium px-1.5 py-0.5 bg-muted rounded-full shrink-0">
              {profile.index}/{profile.total}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {profile.title} @ {profile.company}
          </p>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            <span>📍 {profile.location}</span>
            <span>·</span>
            <span>{profile.yearsExp} ans d'XP</span>
          </div>
        </div>
      </div>

      {/* Trajectory */}
      {profile.trajectory.length > 0 && (
        <div className="px-4 pb-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Parcours</p>
          <div className="flex items-center gap-1.5 text-xs text-foreground/70 overflow-x-auto">
            {profile.trajectory.map((t, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-muted-foreground/30">→</span>}
                <span className="whitespace-nowrap">{t}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {profile.tags.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1">
          {profile.tags.map((tag, i) => (
            <span key={i} className="text-[10px] font-medium px-1.5 py-0.5 bg-primary/10 text-primary rounded-md">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Strengths & Concerns */}
      <div className="px-4 pb-3 space-y-1">
        {profile.strengths.map((s, i) => (
          <div key={`s-${i}`} className="flex items-start gap-1.5 text-xs">
            <span className="text-accent mt-0.5 shrink-0">✓</span>
            <span className="text-foreground/70">{s}</span>
          </div>
        ))}
        {profile.concerns.map((c, i) => (
          <div key={`c-${i}`} className="flex items-start gap-1.5 text-xs">
            <span className="text-warning mt-0.5 shrink-0">⚠</span>
            <span className="text-foreground/70">{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
