import React from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 bg-foreground/[0.03] border border-border">
      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-3">{title}</h4>
      {children}
    </div>
  );
}

export function BadgeItem({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 border border-border text-foreground font-medium uppercase tracking-wider">
      {icon}{children}
    </span>
  );
}

export function ContactLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="text-muted-foreground">{icon}</span>{children}</div>;
}

export function BrutalButton({ children, onClick, first = true }: { children: React.ReactNode; onClick: () => void; first?: boolean }) {
  return (
    <button onClick={onClick}
      className={cn(
        "relative overflow-hidden h-9 px-4 flex items-center gap-2 border border-border text-foreground text-xs font-medium uppercase tracking-wider group",
        !first && '-ml-px'
      )}>
      {children}
    </button>
  );
}

export function BrutalActionButton({ children, onClick, disabled, loading, first }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; loading?: boolean; first?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn(
        "relative overflow-hidden h-[34px] px-4 flex items-center gap-2 border border-border text-foreground text-xs font-medium uppercase tracking-wider group disabled:opacity-50 disabled:cursor-not-allowed",
        first !== false && 'first:ml-0',
        !first && '-ml-px'
      )}>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" /> : children}
    </button>
  );
}

export function CenteredLoader() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border border-border">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-foreground/[0.03] transition-colors">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
        {open ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function CollapsibleCard({ title, subtitle, icon, variant = 'dark', defaultOpen = false, children }: {
  title: string;
  subtitle?: string | null;
  icon: React.ReactNode;
  variant?: 'dark' | 'accent';
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border border-border bg-card">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full px-3 py-2 flex items-center gap-2 transition-colors",
          variant === 'dark' ? "bg-foreground text-background hover:bg-foreground/90" : "bg-accent text-foreground hover:bg-accent/80"
        )}
      >
        {icon}
        <div className="flex-1 min-w-0 text-left">
          <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
          {subtitle && <span className="text-xs opacity-70 ml-2">{subtitle}</span>}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
}

export function formatExpDate(dateStr?: string) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  return parts[0] || '';
}

export function calcDuration(startDate?: string, endDate?: string) {
  if (!startDate) return '';
  const startYear = parseInt(startDate.split('-')[0]);
  const endYear = endDate ? parseInt(endDate.split('-')[0]) : new Date().getFullYear();
  if (isNaN(startYear) || isNaN(endYear)) return '';
  const diff = endYear - startYear;
  return diff <= 0 ? '<1 an' : diff === 1 ? '1 an' : `${diff} ans`;
}

export function ExperienceItem({ exp }: { exp: { title: string; company: string; logo?: string; description?: string; startDate?: string; endDate?: string; isCurrent?: boolean } }) {
  const [expanded, setExpanded] = React.useState(false);
  const duration = calcDuration(exp.startDate, exp.endDate);
  return (
    <div className="relative pl-5 py-1.5">
      {exp.logo ? (
        <img
          src={exp.logo}
          alt={exp.company}
          className="absolute left-0 top-2.5 w-3 h-3 rounded-sm object-contain"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className={cn("absolute left-0.5 top-3 w-2 h-2 rounded-full border-2", exp.isCurrent ? "bg-emerald-500 border-emerald-500" : "bg-background border-border")} />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground leading-tight">{exp.title}</p>
          <p className="text-xs text-muted-foreground">{exp.company}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">{formatExpDate(exp.startDate)} — {exp.isCurrent ? 'Auj.' : formatExpDate(exp.endDate)}</p>
          {duration && <p className="text-[8px] text-muted-foreground/70">{duration}</p>}
        </div>
      </div>
      {exp.description && (
        <>
          <button onClick={() => setExpanded(!expanded)} className="text-[8px] text-muted-foreground hover:text-foreground mt-0.5 flex items-center gap-0.5">
            {expanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
            {expanded ? 'Masquer' : 'Détails'}
          </button>
          {expanded && <p className="text-xs text-muted-foreground leading-relaxed mt-1">{exp.description}</p>}
        </>
      )}
    </div>
  );
}

export function EducationItem({ edu }: { edu: { school: string; logo?: string; degree?: string; field?: string; startYear?: string; endYear?: string } }) {
  const [expanded, setExpanded] = React.useState(false);
  const hasDetails = edu.degree || edu.field;
  return (
    <div className="relative pl-5 py-1.5">
      {edu.logo ? (
        <img
          src={edu.logo}
          alt={edu.school}
          className="absolute left-0 top-2.5 w-3 h-3 rounded-sm object-contain"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className="absolute left-0.5 top-3 w-2 h-2 rounded-full border-2 bg-background border-border" />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground leading-tight">{edu.school}</p>
          {!expanded && edu.degree && <p className="text-xs text-muted-foreground truncate">{edu.degree}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">{edu.startYear || ''}{edu.startYear && edu.endYear ? ' — ' : ''}{edu.endYear || ''}</p>
        </div>
      </div>
      {hasDetails && (
        <>
          <button onClick={() => setExpanded(!expanded)} className="text-[8px] text-muted-foreground hover:text-foreground mt-0.5 flex items-center gap-0.5">
            {expanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
            {expanded ? 'Masquer' : 'Détails'}
          </button>
          {expanded && (
            <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
              {edu.degree && <p>{edu.degree}</p>}
              {edu.field && <p>{edu.field}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
