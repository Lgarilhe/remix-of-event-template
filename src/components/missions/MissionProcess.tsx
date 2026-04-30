import React, { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MissionContextBanner } from './MissionContextBanner';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useMissionProcess, ProcessStep } from '@/hooks/useMissionProcess';
import { useMissionInvitations } from '@/hooks/useMissionInvitations';
import { useOrganizationMembers } from '@/hooks/useOrganization';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { GripVertical, Plus, Trash2, Zap, Clock, User, ChevronDown, Users, Sparkles, Loader2, FileText, Mail, X, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { JobDetails } from '@/types/jobDetails';

// ─── Process Templates ─────────────────────────────────────

type StepTemplate = { step_order: number; name: string; description: string; objectives: string[]; duration_minutes: number; interviewer_type: 'internal' | 'client' | 'panel'; interviewer_name: null; interviewer_user_id: null; evaluation_criteria: []; is_eliminatory: boolean; template_source: 'default' };

const PROCESS_TEMPLATES: Record<string, { label: string; description: string; steps: StepTemplate[] }> = {
  standard: {
    label: 'Standard (3 étapes)',
    description: 'Screening → Technique → Client',
    steps: [
      { step_order: 1, name: 'Screening call', description: 'Premier échange téléphonique', objectives: ['Motivation', 'Disponibilité', 'Prétentions salariales'], duration_minutes: 30, interviewer_type: 'internal', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: true, template_source: 'default' },
      { step_order: 2, name: 'Entretien technique', description: 'Évaluation des compétences', objectives: ['Compétences techniques', 'Résolution de problèmes'], duration_minutes: 60, interviewer_type: 'internal', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: false, template_source: 'default' },
      { step_order: 3, name: 'Entretien client', description: 'Rencontre avec le hiring manager', objectives: ['Culture fit', 'Adéquation avec l\'équipe'], duration_minutes: 45, interviewer_type: 'client', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: false, template_source: 'default' },
    ],
  },
  senior: {
    label: 'Senior (5 étapes)',
    description: 'Screening → Tech → Cas pratique → Culture → Direction',
    steps: [
      { step_order: 1, name: 'Screening call', description: 'Premier échange', objectives: ['Motivation', 'Disponibilité', 'Prétentions'], duration_minutes: 30, interviewer_type: 'internal', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: true, template_source: 'default' },
      { step_order: 2, name: 'Entretien technique approfondi', description: 'Deep-dive technique', objectives: ['Architecture', 'Expertise technique', 'Vision'], duration_minutes: 90, interviewer_type: 'internal', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: true, template_source: 'default' },
      { step_order: 3, name: 'Cas pratique', description: 'Mise en situation ou take-home', objectives: ['Méthodologie', 'Qualité du livrable', 'Communication'], duration_minutes: 120, interviewer_type: 'internal', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: false, template_source: 'default' },
      { step_order: 4, name: 'Culture fit', description: 'Échange équipe et valeurs', objectives: ['Valeurs', 'Collaboration', 'Leadership'], duration_minutes: 45, interviewer_type: 'client', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: false, template_source: 'default' },
      { step_order: 5, name: 'Entretien direction', description: 'Validation finale par la direction', objectives: ['Vision stratégique', 'Fit managérial'], duration_minutes: 30, interviewer_type: 'client', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: false, template_source: 'default' },
    ],
  },
  fast: {
    label: 'Rapide (2 étapes)',
    description: 'Screening → Entretien unique',
    steps: [
      { step_order: 1, name: 'Screening call', description: 'Premier échange rapide', objectives: ['Motivation', 'Disponibilité'], duration_minutes: 20, interviewer_type: 'internal', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: true, template_source: 'default' },
      { step_order: 2, name: 'Entretien final', description: 'Entretien combiné technique + culture', objectives: ['Compétences', 'Culture fit', 'Motivation'], duration_minutes: 60, interviewer_type: 'client', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: false, template_source: 'default' },
    ],
  },
  executive: {
    label: 'Executive (4 étapes)',
    description: 'Screening → Stratégie → Panel → Board',
    steps: [
      { step_order: 1, name: 'Screening approfondi', description: 'Échange de cadrage', objectives: ['Parcours', 'Vision', 'Motivations'], duration_minutes: 45, interviewer_type: 'internal', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: true, template_source: 'default' },
      { step_order: 2, name: 'Cas stratégique', description: 'Présentation d\'une vision stratégique', objectives: ['Vision', 'Leadership', 'Communication'], duration_minutes: 90, interviewer_type: 'client', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: true, template_source: 'default' },
      { step_order: 3, name: 'Panel entretien', description: 'Rencontre avec les stakeholders', objectives: ['Fit équipe direction', 'Collaboration'], duration_minutes: 60, interviewer_type: 'panel', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: false, template_source: 'default' },
      { step_order: 4, name: 'Validation board', description: 'Validation finale', objectives: ['Approbation direction'], duration_minutes: 30, interviewer_type: 'client', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: false, template_source: 'default' },
    ],
  },
};

// ─── Step Card ─────────────────────────────────────────────

interface StepCardProps {
  step: ProcessStep;
  index: number;
  onUpdate: (patch: Partial<ProcessStep> & { id: string }) => void;
  onDelete: (id: string) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isDragTarget: boolean;
}

const INTERVIEWER_TYPE_LABELS: Record<string, string> = {
  internal: 'Interne',
  client: 'Client',
  panel: 'Panel',
};

// ── Format / provider config ──
const FORMAT_OPTIONS: { value: 'video' | 'phone' | 'onsite'; label: string; emoji: string; desc: string }[] = [
  { value: 'video', label: 'Visioconférence', emoji: '🎥', desc: 'Teams, Zoom, Meet…' },
  { value: 'phone', label: 'Téléphonique', emoji: '📞', desc: 'Appel classique' },
  { value: 'onsite', label: 'Présentiel', emoji: '🤝', desc: 'Sur place / bureaux' },
];

const PROVIDER_OPTIONS: { value: 'teams' | 'zoom' | 'google_meet' | 'other'; label: string; logo: React.ReactNode }[] = [
  {
    value: 'teams',
    label: 'Microsoft Teams',
    logo: (
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
        <path d="M14.4 9.6h6.4a1.6 1.6 0 0 1 1.6 1.6v6.4a4.8 4.8 0 0 1-9.6 0V11.2a1.6 1.6 0 0 1 1.6-1.6zM8 8a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4zm-2.4 9.6V11.2A1.6 1.6 0 0 1 7.2 9.6h6.4v8a3.2 3.2 0 0 1-3.2 3.2H8a4.8 4.8 0 0 1-2.4-3.2z" />
      </svg>
    ),
  },
  {
    value: 'zoom',
    label: 'Zoom',
    logo: (
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
        <path d="M2 8a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8zm17.5 1.5L22 7v10l-2.5-2.5v-5z" />
      </svg>
    ),
  },
  {
    value: 'google_meet',
    label: 'Google Meet',
    logo: (
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
        <path d="M3 6a2 2 0 0 1 2-2h10v6h-3l3 3v5H5a2 2 0 0 1-2-2V6zm14 0v3l3-2.5v11l-3-2.5v3h-2V6h2z" />
      </svg>
    ),
  },
  {
    value: 'other',
    label: 'Lien personnalisé',
    logo: (
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
];

function getFormatLabel(format: 'video' | 'phone' | 'onsite' | null | undefined): string {
  const f = format || 'video';
  return FORMAT_OPTIONS.find(o => o.value === f)?.emoji || '🎥';
}

const StepCard: React.FC<StepCardProps> = ({
  step, index, onUpdate, onDelete,
  onDragStart, onDragOver, onDragEnd, isDragging, isDragTarget,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [editingObjective, setEditingObjective] = useState('');

  const addObjective = () => {
    const val = editingObjective.trim();
    if (val && !step.objectives.includes(val)) {
      onUpdate({ id: step.id, objectives: [...step.objectives, val] });
    }
    setEditingObjective('');
  };

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDragEnd={onDragEnd}
      className={cn(
        "rounded-lg border border-border bg-card transition-all",
        isDragging && "opacity-50 scale-[0.98]",
        isDragTarget && "border-primary/40 shadow-sm",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors">
          <GripVertical className="w-4 h-4" />
        </div>

        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-foreground text-background text-xs font-bold shrink-0 font-display">
          {index + 1}
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <input
            defaultValue={step.name}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val && val !== step.name) onUpdate({ id: step.id, name: val });
            }}
            className="text-[14px] font-semibold text-foreground bg-transparent border-none focus:outline-none focus:bg-muted/30 rounded px-1 -mx-1 min-w-0 max-w-[60%] sm:max-w-none"
          />
          {/* Format pill — toujours visible en collapsed */}
          <span
            className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
            title="Format"
          >
            <span>{getFormatLabel(step.meeting_format)}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {step.is_eliminatory && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'hsl(var(--status-warning-muted))', color: 'hsl(var(--status-warning))' }}>
              <Zap className="w-2.5 h-2.5" /> Éliminatoire
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="w-3 h-3" /> {step.duration_minutes}min
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <User className="w-3 h-3" /> {step.interviewer_name || INTERVIEWER_TYPE_LABELS[step.interviewer_type]}
          </span>
          <button onClick={() => setExpanded(!expanded)} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" aria-label={expanded ? 'Réduire' : 'Développer'}>
            <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
          </button>
          <button onClick={() => onDelete(step.id)} className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" aria-label="Supprimer">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-border/50 space-y-4 bg-muted/20">
          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</label>
            <input
              defaultValue={step.description || ''}
              onBlur={(e) => onUpdate({ id: step.id, description: e.target.value || null })}
              placeholder="Description de l'étape..."
              className="w-full h-9 px-3 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
            />
          </div>

          {/* Row: duration, type, interviewer, eliminatory */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Durée (min)</label>
              <input
                type="number"
                defaultValue={step.duration_minutes}
                onBlur={(e) => onUpdate({ id: step.id, duration_minutes: Number(e.target.value) || 30 })}
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Réalisé par</label>
              <select
                value={step.interviewer_type}
                onChange={(e) => onUpdate({ id: step.id, interviewer_type: e.target.value as any })}
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors"
              >
                <option value="internal">Interne</option>
                <option value="client">Client</option>
                <option value="panel">Panel</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Interviewer</label>
              <input
                defaultValue={step.interviewer_name || ''}
                onBlur={(e) => onUpdate({ id: step.id, interviewer_name: e.target.value || null })}
                placeholder="Nom..."
                className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Éliminatoire</label>
              <button
                onClick={() => onUpdate({ id: step.id, is_eliminatory: !step.is_eliminatory })}
                className={cn(
                  "w-full h-9 px-3 text-xs font-medium rounded-md border transition-colors inline-flex items-center justify-center gap-1.5",
                  step.is_eliminatory
                    ? "border-warning/40"
                    : "bg-background text-muted-foreground border-border hover:bg-muted/50"
                )}
                style={step.is_eliminatory ? { background: 'hsl(var(--status-warning-muted))', color: 'hsl(var(--status-warning))' } : undefined}
              >
                {step.is_eliminatory ? <><Zap className="w-3 h-3" /> Oui</> : 'Non'}
              </button>
            </div>
          </div>

          {/* Format de l'entretien — visio / téléphone / présentiel */}
          <div className="space-y-2 pt-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Format de l'entretien
            </label>
            <div className="grid grid-cols-3 gap-2">
              {FORMAT_OPTIONS.map(opt => {
                const isActive = (step.meeting_format || 'video') === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onUpdate({ id: step.id, meeting_format: opt.value })}
                    className={cn(
                      'flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-md border text-left transition-all',
                      isActive
                        ? 'border-foreground/40 bg-background'
                        : 'border-border bg-background/40 hover:border-borderHi hover:bg-background',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{opt.emoji}</span>
                      <span className={cn('text-[12px] font-semibold', !isActive && 'text-muted-foreground')}>
                        {opt.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/70">{opt.desc}</span>
                  </button>
                );
              })}
            </div>

            {/* Sub-options selon le format */}
            {(step.meeting_format || 'video') === 'video' && (
              <div className="mt-2 pl-1 space-y-2 konekt-fade-up">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Outil de visio
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PROVIDER_OPTIONS.map(prov => {
                    const isActive = step.meeting_provider === prov.value;
                    return (
                      <button
                        key={prov.value}
                        type="button"
                        onClick={() => onUpdate({ id: step.id, meeting_provider: prov.value })}
                        className={cn(
                          'flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-[11.5px] font-medium transition-colors',
                          isActive
                            ? 'border-foreground/40 bg-background text-foreground'
                            : 'border-border bg-background/40 text-muted-foreground hover:bg-background hover:text-foreground',
                        )}
                      >
                        <span className={isActive ? 'text-foreground' : 'text-muted-foreground/70'}>
                          {prov.logo}
                        </span>
                        <span className="truncate">{prov.label}</span>
                      </button>
                    );
                  })}
                </div>
                {step.meeting_provider === 'other' && (
                  <input
                    defaultValue={step.meeting_link || ''}
                    onBlur={(e) => onUpdate({ id: step.id, meeting_link: e.target.value || null })}
                    placeholder="https://… (lien meeting personnalisé)"
                    className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors"
                  />
                )}
                {step.meeting_provider && step.meeting_provider !== 'other' && (
                  <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" />
                    Le lien {PROVIDER_OPTIONS.find(p => p.value === step.meeting_provider)?.label} sera généré automatiquement à chaque entretien planifié.
                  </p>
                )}
              </div>
            )}

            {step.meeting_format === 'onsite' && (
              <div className="mt-2 pl-1 space-y-1.5 konekt-fade-up">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Adresse (optionnel)
                </label>
                <input
                  defaultValue={step.location_address || ''}
                  onBlur={(e) => onUpdate({ id: step.id, location_address: e.target.value || null })}
                  placeholder="Ex: 12 rue de Paris, 75002 — bureaux client"
                  className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors"
                />
                <p className="text-[11px] text-muted-foreground">
                  L'adresse sera incluse dans l'invitation calendar du candidat.
                </p>
              </div>
            )}

            {step.meeting_format === 'phone' && (
              <p className="text-[11px] text-muted-foreground pl-1 konekt-fade-up">
                Le numéro de téléphone du candidat sera utilisé. L'interviewer recevra le numéro dans son invitation calendar.
              </p>
            )}
          </div>

          {/* Objectives */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Objectifs</label>
            <div className="flex flex-wrap gap-1.5">
              {step.objectives.map((obj, i) => (
                <span key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/50 border border-border text-xs font-medium text-foreground">
                  ☑ {obj}
                  <button
                    onClick={() => onUpdate({ id: step.id, objectives: step.objectives.filter((_, j) => j !== i) })}
                    className="hover:opacity-60 ml-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
              <div className="flex items-center gap-1">
                <input
                  value={editingObjective}
                  onChange={(e) => setEditingObjective(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addObjective(); } }}
                  onBlur={() => { if (editingObjective.trim()) addObjective(); }}
                  placeholder="Ajouter un objectif..."
                  className="h-8 w-40 px-2 text-xs border border-dashed border-border bg-transparent text-foreground focus:border-border focus:outline-none"
                />
                <button onClick={addObjective} className="text-muted-foreground hover:text-foreground">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────

interface MissionProcessProps {
  project: SourcingProject;
  readOnly?: boolean;
}

// ─── Team Section ──────────────────────────────────────────

interface MissionTeamSectionProps {
  team: any[];
  loadingTeam: boolean;
  readOnly: boolean;
  getMemberName: (userId: string) => string;
  orgMembers: any[];
  projectId: string;
  projectName: string;
  onAdd: (input: { user_id: string; role: string }) => Promise<any>;
  onRemove: (id: string) => Promise<any>;
}

const MissionTeamSection: React.FC<MissionTeamSectionProps> = ({
  team, loadingTeam, readOnly, getMemberName, orgMembers, projectId, projectName, onAdd, onRemove,
}) => {
  const { invitations, sendInvitation, isSending, cancelInvitation } = useMissionInvitations(projectId);
  const [showAssign, setShowAssign] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('sourcer');
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

  const assignedIds = new Set(team.map((m: any) => m.user_id));
  const availableMembers = orgMembers.filter(m => !assignedIds.has(m.user_id));

  const handleAssign = async () => {
    if (!selectedUserId) return;
    try {
      await onAdd({ user_id: selectedUserId, role: selectedRole });
      setSelectedUserId('');
      setShowAssign(false);
    } catch {
      // Error toasted by hook
    }
  };

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Équipe mission ({team.length})
          </h3>
        </div>
        {!readOnly && availableMembers.length > 0 && !showAssign && (
          <button
            onClick={() => setShowAssign(true)}
            className="flex items-center gap-1 h-8 px-3 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground hover:border-border transition-colors"
          >
            <Plus className="w-3 h-3" /> Assigner
          </button>
        )}
      </div>

      {/* Assign form */}
      {showAssign && (
        <div className="flex items-center gap-2 mb-4">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="flex-1 h-9 px-3 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
          >
            <option value="">Sélectionner un membre...</option>
            {availableMembers.map((m: any) => (
              <option key={m.user_id} value={m.user_id}>{getMemberName(m.user_id)}</option>
            ))}
          </select>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="h-9 px-3 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground focus:border-border focus:outline-none"
          >
            <option value="lead">Lead</option>
            <option value="sourcer">Sourcer</option>
            <option value="account_manager">Account Manager</option>
            <option value="reviewer">Reviewer</option>
            <option value="freelance">Freelance</option>
          </select>
          <button
            onClick={handleAssign}
            disabled={!selectedUserId}
            className="h-9 px-4 bg-foreground text-background text-xs font-bold uppercase tracking-wider border border-border disabled:opacity-50"
          >
            OK
          </button>
          <button
            onClick={() => { setShowAssign(false); setSelectedUserId(''); }}
            className="h-9 px-3 text-muted-foreground hover:text-foreground border border-border text-xs uppercase"
          >
            ×
          </button>
        </div>
      )}

      {loadingTeam ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-4 h-4 border border-border border-t-foreground animate-spin" />
        </div>
      ) : team.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucun membre assigné à cette mission.</p>
      ) : (
        <div className="space-y-2">
          {team.map((member: any) => (
            <div key={member.id} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-card">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{getMemberName(member.user_id)}</p>
              </div>
              <span className="px-2 py-0.5 text-xs font-medium rounded-md border border-border text-muted-foreground bg-muted/50">
                {ROLE_LABELS[member.role] || member.role}
              </span>
              {!readOnly && (
                <button
                  onClick={() => setRemoveTarget({ id: member.id, name: getMemberName(member.user_id) })}
                  className="text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* External invitations */}
      {!readOnly && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Invitations externes ({invitations.filter(i => i.status === 'pending').length} en attente)
            </p>
            {!showInvite && (
              <button
                onClick={() => setShowInvite(true)}
                className="flex items-center gap-1 h-8 px-3 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground hover:border-border transition-colors"
              >
                <Mail className="w-3 h-3" /> Inviter par email
              </button>
            )}
          </div>

          {showInvite && (
            <div className="flex items-center gap-2 mb-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@freelance.com"
                className="flex-1 h-9 px-3 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (inviteEmail.trim()) {
                      sendInvitation({ email: inviteEmail.trim(), role: 'freelance', missionName: projectName })
                        .then(() => { setInviteEmail(''); setShowInvite(false); })
                        .catch(() => {});
                    }
                  }
                }}
              />
              <button
                onClick={() => {
                  if (inviteEmail.trim()) {
                    sendInvitation({ email: inviteEmail.trim(), role: 'freelance', missionName: projectName })
                      .then(() => { setInviteEmail(''); setShowInvite(false); })
                      .catch(() => {});
                  }
                }}
                disabled={!inviteEmail.trim() || isSending}
                className="h-9 px-4 bg-foreground text-background text-xs font-bold uppercase tracking-wider border border-border disabled:opacity-50"
              >
                {isSending ? 'Envoi...' : 'Inviter'}
              </button>
              <button
                onClick={() => { setShowInvite(false); setInviteEmail(''); }}
                className="h-9 px-2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {invitations.length > 0 && (
            <div className="space-y-1.5">
              {invitations.map(inv => (
                <div key={inv.id} className="flex items-center gap-3 px-3 py-2 border border-border">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{inv.email}</p>
                  </div>
                  <span className={cn(
                    "px-2 py-0.5 text-xs font-medium rounded-md border",
                    inv.status === 'accepted' ? "border-success/30 text-success bg-success/10" :
                    inv.status === 'pending' ? "border-warning/30 text-warning bg-warning/10" :
                    "border-border text-muted-foreground"
                  )}>
                    {inv.status === 'pending' ? 'En attente' : inv.status === 'accepted' ? 'Acceptée' : inv.status === 'rejected' ? 'Refusée' : 'Expirée'}
                  </span>
                  {inv.status === 'pending' && (
                    <>
                      <button
                        onClick={async () => {
                          const url = `${window.location.origin}/mission-invite/${inv.token}`;
                          try {
                            await navigator.clipboard.writeText(url);
                            toast.success('Lien d\'invitation copié');
                          } catch {
                            toast.error('Lien : ' + url);
                          }
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        title="Copier le lien d'invitation"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => cancelInvitation(inv.id)}
                        className="text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                        title="Annuler l'invitation"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer ce membre ?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget && `Retirer ${removeTarget.name} de cette mission ?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (removeTarget) onRemove(removeTarget.id);
                setRemoveTarget(null);
              }}
            >
              Retirer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ─── Role Labels ───────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  lead: 'Lead',
  sourcer: 'Sourcer',
  account_manager: 'Account Manager',
  reviewer: 'Reviewer',
  freelance: 'Freelance',
};

export const MissionProcess: React.FC<MissionProcessProps> = ({ project, readOnly = false }) => {
  const {
    steps, team, loadingSteps, loadingTeam,
    addStep, updateStep, deleteStep, reorderSteps,
    initializeDefaultSteps, initializeFromTemplate, addTeamMember, removeTeamMember, isAdding,
  } = useMissionProcess(project.id);

  // Fetch org members for the assign dropdown + name resolution
  const { members: orgMembers } = useOrganizationMembers(project.organization_id);
  const { data: memberProfiles = [] } = useQuery({
    queryKey: ['member-profiles-mission', orgMembers.map(m => m.user_id)],
    queryFn: async () => {
      if (orgMembers.length === 0) return [];
      const { data } = await supabase
        .from('profiles')
        .select('user_id, display_name, recruiter_headline')
        .in('user_id', orgMembers.map(m => m.user_id));
      return data || [];
    },
    enabled: orgMembers.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const getMemberName = (userId: string) => {
    const profile = memberProfiles.find((p: any) => p.user_id === userId);
    return profile?.display_name || userId.slice(0, 8) + '...';
  };

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [addingStep, setAddingStep] = useState(false);
  const [suggestingAI, setSuggestingAI] = useState(false);

  // AI suggestion based on job details
  const handleAISuggestion = async () => {
    const jd = (project.job_details || {}) as JobDetails;
    const seniority = jd.seniority?.toLowerCase() || '';
    const manages = jd.manages || 0;

    // Simple rule-based suggestion (no edge function needed)
    let templateKey = 'standard';
    if (seniority.includes('junior') || seniority.includes('stage') || seniority.includes('alternance')) {
      templateKey = 'fast';
    } else if (seniority.includes('lead') || seniority.includes('senior') || seniority.includes('principal')) {
      templateKey = 'senior';
    } else if (seniority.includes('director') || seniority.includes('vp') || seniority.includes('c-level') || seniority.includes('head') || manages > 5) {
      templateKey = 'executive';
    }

    setSuggestingAI(true);
    try {
      await initializeFromTemplate(PROCESS_TEMPLATES[templateKey].steps);
      toast.success(`Process "${PROCESS_TEMPLATES[templateKey].label}" suggéré par l'IA`);
    } finally {
      setSuggestingAI(false);
    }
  };
  const [newStepName, setNewStepName] = useState('');

  const handleDragEnd = () => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      const reordered = [...steps];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(dragOverIndex, 0, moved);
      reorderSteps(reordered.map(s => s.id));
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleAddStep = async () => {
    const name = newStepName.trim();
    if (!name) return;
    await addStep({ name });
    setNewStepName('');
    setAddingStep(false);
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Contextual banner */}
      <MissionContextBanner
        icon="🏗️"
        title="Structurez votre process"
        description="Définissez les étapes d'évaluation. L'IA adaptera le scoring et les scorecards en fonction du process défini."
        storageKey={`process-onboarding:${project.id}`}
        variant="info"
        className="mb-4"
      />
      {readOnly && (
        <div className="px-4 py-3 rounded-lg border border-border bg-muted/30 flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            👁️ Lecture seule — le process est défini par le lead recruteur
          </span>
        </div>
      )}
      {/* Process header stats */}
      {steps.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-center gap-3 p-4 rounded-xl border border-border bg-card">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Étapes</p>
            <p className="font-display text-[24px] font-bold tabular-nums leading-none">{steps.length}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Durée totale</p>
            <p className="font-display text-[24px] font-bold tabular-nums leading-none">
              {steps.reduce((sum, s) => sum + s.duration_minutes, 0)}
              <span className="text-[13px] font-medium text-muted-foreground ml-1">min</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Éliminatoires</p>
            <p
              className="font-display text-[24px] font-bold tabular-nums leading-none"
              style={steps.filter(s => s.is_eliminatory).length > 0 ? { color: 'hsl(var(--status-warning))' } : undefined}
            >
              {steps.filter(s => s.is_eliminatory).length}
            </p>
          </div>
          {!readOnly && (
            <button
              onClick={handleAISuggestion}
              disabled={suggestingAI}
              className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full text-[12px] font-semibold text-white konekt-skalr-bg konekt-shine transition-transform active:scale-[0.97] disabled:opacity-50"
            >
              {suggestingAI ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />}
              Réoptimiser avec l'IA
            </button>
          )}
        </div>
      )}

      {/* Steps timeline */}
      <div className="flex items-center justify-between mb-3 mt-6">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Étapes du process
          </p>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            {steps.length} étape{steps.length > 1 ? 's' : ''} · glisse pour réordonner
          </p>
        </div>
        {steps.length === 0 && !loadingSteps && !readOnly && (
          <button
            onClick={initializeDefaultSteps}
            disabled={isAdding}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold border border-border bg-foreground text-background hover:opacity-90 transition-opacity"
          >
            Créer un process par défaut
          </button>
        )}
      </div>

      {loadingSteps ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border border-border border-t-foreground animate-spin" />
        </div>
      ) : steps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <div className="text-4xl mb-4">🏗️</div>
          <h3 className="text-sm font-semibold text-foreground mb-1">
            {readOnly ? 'Aucune étape définie' : 'Configurez votre process d\'interview'}
          </h3>
          <p className="text-xs text-muted-foreground mb-6 max-w-sm mx-auto">
            {readOnly ? 'Aucune étape définie pour cette mission.' : 'Choisissez un template adapté ou laissez l\'IA analyser le brief pour suggérer le process idéal.'}
          </p>
          {!readOnly && (
            <div className="space-y-4">
              {/* AI suggestion button */}
              <button
                onClick={handleAISuggestion}
                disabled={isAdding || suggestingAI}
                className="relative overflow-hidden w-full flex items-center justify-center gap-2 h-[40px] bg-foreground text-background border border-border text-xs font-medium uppercase tracking-wider group"
              >
                {suggestingAI ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" /><span className="relative z-10">Analyse du brief...</span></>
                ) : (
                  <><Sparkles className="w-3.5 h-3.5 relative z-10" /><span className="relative z-10">Suggestion IA (basé sur le brief)</span></>
                )}
              </button>

              {/* Template grid */}
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(PROCESS_TEMPLATES).map(([key, tpl]) => (
                  <button
                    key={key}
                    onClick={() => initializeFromTemplate(tpl.steps)}
                    disabled={isAdding}
                    className="rounded-lg border border-border bg-card p-4 text-left hover:border-primary/30 hover:shadow-sm transition-all disabled:opacity-50 group"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <FileText className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      <p className="text-sm font-semibold text-foreground">{tpl.label}</p>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{tpl.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="relative">
          {/* Vertical connector line */}
          <div className="absolute left-[30px] top-[28px] bottom-[28px] w-[2px] bg-border" />

          <div className="relative space-y-2">
            {/* Fixed first step: Submit candidate */}
            <div className="flex items-center gap-3 px-4 py-2 relative z-10">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted border border-border text-muted-foreground text-xs font-medium shrink-0">→</div>
              <span className="text-xs font-medium text-muted-foreground">Candidat soumis</span>
            </div>

            {/* Draggable steps */}
            {steps.map((step, index) => (
              <div key={step.id} className="relative z-10">
                <StepCard
                  step={step}
                  index={index}
                  onUpdate={updateStep}
                  onDelete={deleteStep}
                  onDragStart={setDragIndex}
                  onDragOver={setDragOverIndex}
                  onDragEnd={handleDragEnd}
                  isDragging={dragIndex === index}
                  isDragTarget={dragOverIndex === index}
                />
              </div>
            ))}

            {/* Fixed last step: Hired */}
            <div className="flex items-center gap-3 px-4 py-2 relative z-10">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-success/10 border border-success/30 text-success text-xs font-medium shrink-0">✓</div>
              <span className="text-xs font-medium text-success">Embauché</span>
            </div>
          </div>
        </div>
      )}

      {/* Add step — hidden in read-only */}
      {!readOnly && <div className="mt-3">
        {addingStep ? (
          <div className="flex items-center gap-2">
            <input
              value={newStepName}
              onChange={(e) => setNewStepName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddStep(); if (e.key === 'Escape') setAddingStep(false); }}
              autoFocus
              placeholder="Nom de l'étape..."
              className="flex-1 h-9 px-3 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
            />
            <button
              onClick={handleAddStep}
              disabled={!newStepName.trim()}
              className="h-9 px-4 bg-foreground text-background text-xs font-bold uppercase tracking-wider border border-border disabled:opacity-50"
            >
              Ajouter
            </button>
            <button
              onClick={() => { setAddingStep(false); setNewStepName(''); }}
              className="h-9 px-3 text-muted-foreground hover:text-foreground border border-border text-xs font-bold uppercase tracking-wider"
            >
              Annuler
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingStep(true)}
            className="relative overflow-hidden flex items-center gap-1.5 h-9 px-4 text-xs font-medium uppercase tracking-wider border border-dashed border-border bg-background text-muted-foreground hover:text-foreground hover:border-border transition-colors group w-full justify-center"
          >
            <Plus className="w-3.5 h-3.5 relative z-10" />
            <span className="relative z-10">Ajouter une étape</span>
          </button>
        )}
      </div>}

      {/* Team section */}
      <MissionTeamSection
        team={team}
        loadingTeam={loadingTeam}
        readOnly={readOnly}
        getMemberName={getMemberName}
        orgMembers={orgMembers}
        projectId={project.id}
        projectName={project.name}
        onAdd={addTeamMember}
        onRemove={removeTeamMember}
      />
    </div>
  );
};
