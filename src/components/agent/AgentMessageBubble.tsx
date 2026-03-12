import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { CheckCircle2, MapPin, Calendar, Target, Brain, ChevronDown } from 'lucide-react';
import { AgentMessage } from '@/hooks/useAgentChat';
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

export const AgentMessageBubble: React.FC<AgentMessageBubbleProps> = ({ message, isStreaming }) => {
  const isUser = message.role === 'user';
  const isStatus = message.role === 'status';
  const thinking = message.metadata?.thinking as string | undefined;

  const cleanContent = message.content
    .replace(/\[SEARCH_PLAN\][\s\S]*?\[\/SEARCH_PLAN\]/g, '')
    .replace(/\[AGENT_ACTION\][\s\S]*?\[\/AGENT_ACTION\]/g, '')
    .replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/g, '')
    .trim();

  const searchPlan = message.metadata?.search_plan as Record<string, unknown> | undefined;

  // ── Status message ──
  if (isStatus) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs"
        style={{
          background: 'rgba(0,240,255,0.04)',
          color: 'rgba(255,255,255,0.5)',
        }}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00f0ff]/50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#00f0ff]" />
        </span>
        <span>{cleanContent}</span>
      </div>
    );
  }

  // ── User message ──
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] px-4 py-3 text-sm leading-relaxed rounded-2xl rounded-br-sm"
          style={{
            background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(124,58,237,0.15))',
            border: '1px solid rgba(124,58,237,0.25)',
            color: 'rgba(255,255,255,0.9)',
          }}
        >
          <div className="[&_p]:my-0">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  // ── Assistant message ──
  return (
    <div className="flex gap-3 justify-start">
      <div className="flex-1 min-w-0 text-sm leading-relaxed">
        {/* Thinking toggle for saved messages */}
        {thinking && <ThinkingToggle thinking={thinking} />}

        {cleanContent && (
          <div
            className="px-4 py-3 rounded-xl"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div
              className="prose prose-sm prose-invert max-w-none [&_p]:my-1.5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:mt-2 [&_h3]:mb-1 [&_hr]:my-3 [&_code]:text-xs [&_code]:bg-white/5 [&_code]:px-1.5 [&_code]:py-0.5 text-sm"
              style={{
                '--tw-prose-body': 'rgba(255,255,255,0.65)',
                '--tw-prose-headings': 'rgba(255,255,255,0.95)',
                '--tw-prose-bold': 'rgba(255,255,255,0.95)',
                '--tw-prose-bullets': '#00f0ff',
                '--tw-prose-counters': '#00f0ff',
              } as React.CSSProperties}
            >
              <ReactMarkdown>{cleanContent}</ReactMarkdown>
            </div>
          </div>
        )}

        {searchPlan && <SearchPlanCard plan={searchPlan} />}

        {isStreaming && (
          <span className="inline-block w-0.5 h-4 bg-[#00f0ff]/60 animate-pulse ml-4 mt-1" />
        )}
      </div>
    </div>
  );
};

function ThinkingToggle({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  const lines = thinking.split('\n').filter(l => l.trim() && l.trim().length > 5);
  const displayLines = lines.slice(0, 10).map(l => {
    const trimmed = l.trim();
    return trimmed.length > 100 ? trimmed.slice(0, 97) + '…' : trimmed;
  });

  if (displayLines.length === 0) return null;

  return (
    <div className="mb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-left group"
      >
        <div
          className="h-5 w-5 rounded-full flex items-center justify-center transition-all"
          style={{
            background: expanded ? 'rgba(0,240,255,0.15)' : 'rgba(255,255,255,0.06)',
            border: expanded ? '1px solid rgba(0,240,255,0.3)' : '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <Brain className="w-2.5 h-2.5" style={{ color: expanded ? '#00f0ff' : 'rgba(255,255,255,0.4)' }} />
        </div>
        <span className="text-xs group-hover:text-white/50 transition-colors" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {expanded ? 'Masquer' : 'Voir'} la réflexion ({displayLines.length} étapes)
        </span>
        <ChevronDown className={cn(
          "w-3 h-3 transition-transform",
          expanded && "rotate-180"
        )} style={{ color: 'rgba(255,255,255,0.2)' }} />
      </button>

      {expanded && (
        <div
          className="mt-2 ml-1 pl-3 space-y-1 rounded-lg p-3"
          style={{
            borderLeft: '2px solid rgba(0,240,255,0.15)',
            background: 'rgba(0,240,255,0.02)',
          }}
        >
          {displayLines.map((line, i) => (
            <div key={i} className="flex items-start gap-2 relative">
              <span
                className="absolute left-[-14.5px] top-[7px] h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: 'rgba(255,255,255,0.15)' }}
              />
              <p
                className="text-[11px] leading-relaxed"
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  color: 'rgba(255,255,255,0.35)',
                }}
              >
                {line}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchPlanCard({ plan }: { plan: Record<string, unknown> }) {
  const filters = (plan as any).filters || {};
  const stopConditions = (plan as any).stop_conditions || {};

  return (
    <div
      className="mt-4 p-4 space-y-3 rounded-xl"
      style={{
        background: 'rgba(0,240,255,0.03)',
        border: '1px solid rgba(0,240,255,0.15)',
      }}
    >
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="w-4 h-4 text-[#00f0ff]" />
        <span className="text-xs font-bold uppercase tracking-wider text-white">
          Plan de recherche
        </span>
      </div>

      {(plan as any).summary && (
        <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {(plan as any).summary}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {filters.location_keywords?.length > 0 && (
          <PlanPill icon={MapPin} label={filters.location_keywords.join(', ')} />
        )}
        {filters.calculated_experience_min != null && (
          <PlanPill icon={Calendar} label={`${filters.calculated_experience_min}–${filters.calculated_experience_max} ans`} />
        )}
        {stopConditions.target_go_profiles && (
          <PlanPill icon={Target} label={`${stopConditions.target_go_profiles} profils Go`} />
        )}
      </div>
    </div>
  );
}

function PlanPill({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs"
      style={{
        background: 'rgba(0,240,255,0.1)',
        border: '1px solid rgba(0,240,255,0.2)',
        color: '#00f0ff',
      }}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </div>
  );
}
