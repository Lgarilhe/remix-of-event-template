import React from "react";
import { MapPin, Briefcase, TrendingUp, AlertTriangle, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfileData {
  name: string;
  title: string;
  company: string;
  location?: string;
  yearsExp?: number;
  score?: number;
  trajectory?: string[];
  strengths?: string[];
  concerns?: string[];
  tags?: string[];
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
      : score >= 60
        ? "bg-amber-500/15 text-amber-400 border-amber-500/20"
        : "bg-red-500/15 text-red-400 border-red-500/20";

  return (
    <span className={cn("text-xs font-bold px-2 py-0.5 rounded-md border tabular-nums", color)}>
      {score}
    </span>
  );
}

export function ProfileCard({ data }: { data: ProfileData }) {
  return (
    <div className="my-3 p-4 rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm space-y-3 animate-fade-in">
      {/* Header: name + score */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground truncate">{data.name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {data.title}
            {data.company && <span className="text-foreground/70"> · {data.company}</span>}
          </p>
        </div>
        {data.score != null && <ScoreBadge score={data.score} />}
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {data.location && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {data.location}
          </span>
        )}
        {data.yearsExp != null && (
          <span className="flex items-center gap-1">
            <Briefcase className="h-3 w-3" />
            {data.yearsExp} ans d'exp.
          </span>
        )}
      </div>

      {/* Trajectory */}
      {data.trajectory && data.trajectory.length > 0 && (
        <div className="text-[11px] text-muted-foreground/80 leading-relaxed">
          <span className="text-muted-foreground font-medium">Parcours :</span>{" "}
          {data.trajectory.join(" → ")}
        </div>
      )}

      {/* Strengths */}
      {data.strengths && data.strengths.length > 0 && (
        <div className="space-y-1">
          {data.strengths.map((s, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-emerald-400/90">
              <TrendingUp className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}

      {/* Concerns */}
      {data.concerns && data.concerns.length > 0 && (
        <div className="space-y-1">
          {data.concerns.map((c, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-400/90">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tags */}
      {data.tags && data.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-primary/10 text-primary/80 border border-primary/10"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Parse text containing [PROFILE]{...}[/PROFILE] blocks into segments.
 * Returns alternating text and profile-data segments.
 */
export function parseProfileBlocks(
  text: string,
): Array<{ type: "text"; value: string } | { type: "profile"; data: ProfileData }> {
  const regex = /\[PROFILE\]([\s\S]*?)\[\/PROFILE\]/g;
  const segments: Array<{ type: "text"; value: string } | { type: "profile"; data: ProfileData }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before this profile block
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "text", value: before });
    }

    try {
      const data = JSON.parse(match[1].trim()) as ProfileData;
      segments.push({ type: "profile", data });
    } catch {
      // If JSON parse fails, render as text
      segments.push({ type: "text", value: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex).trim();
    if (rest) segments.push({ type: "text", value: rest });
  }

  return segments;
}
