import React, { useState } from 'react';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useMissionProcess, ProcessStep } from '@/hooks/useMissionProcess';
import { useMissionInvitations } from '@/hooks/useMissionInvitations';
import { useOrganizationMembers } from '@/hooks/useOrganization';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { GripVertical, Plus, Trash2, Zap, Clock, User, ChevronDown, Users, Sparkles, Loader2, FileText, Mail, X } from 'lucide-react';
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
        "border border-foreground/20 bg-background transition-all",
        isDragging && "opacity-50",
        isDragTarget && "border-brutal-accent border-2",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
          <GripVertical className="w-4 h-4" />
        </div>

        <div className="flex items-center justify-center w-7 h-7 bg-foreground text-background text-[11px] font-bold shrink-0">
          {index + 1}
        </div>

        <div className="flex-1 min-w-0">
          <input
            defaultValue={step.name}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val && val !== step.name) onUpdate({ id: step.id, name: val });
            }}
            className="text-sm font-bold uppercase tracking-wider text-foreground bg-transparent border-none focus:outline-none focus:bg-muted/30 px-1 -mx-1 w-full"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {step.is_eliminatory && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-red-600 text-white text-[9px] font-bold uppercase tracking-wider">
              <Zap className="w-2.5 h-2.5" /> Éliminatoire
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="w-3 h-3" /> {step.duration_minutes}min
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <User className="w-3 h-3" /> {step.interviewer_name || INTERVIEWER_TYPE_LABELS[step.interviewer_type]}
          </span>
          <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
          </button>
          <button onClick={() => onDelete(step.id)} className="text-muted-foreground hover:text-red-500 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-foreground/10 space-y-4">
          {/* Description */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</label>
            <input
              defaultValue={step.description || ''}
              onBlur={(e) => onUpdate({ id: step.id, description: e.target.value || null })}
              placeholder="Description de l'étape..."
              className="w-full h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
            />
          </div>

          {/* Row: duration, type, interviewer, eliminatory */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Durée (min)</label>
              <input
                type="number"
                defaultValue={step.duration_minutes}
                onBlur={(e) => onUpdate({ id: step.id, duration_minutes: Number(e.target.value) || 30 })}
                className="w-full h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Type</label>
              <select
                value={step.interviewer_type}
                onChange={(e) => onUpdate({ id: step.id, interviewer_type: e.target.value as any })}
                className="w-full h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
              >
                <option value="internal">Interne</option>
                <option value="client">Client</option>
                <option value="panel">Panel</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Interviewer</label>
              <input
                defaultValue={step.interviewer_name || ''}
                onBlur={(e) => onUpdate({ id: step.id, interviewer_name: e.target.value || null })}
                placeholder="Nom..."
                className="w-full h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Éliminatoire</label>
              <button
                onClick={() => onUpdate({ id: step.id, is_eliminatory: !step.is_eliminatory })}
                className={cn(
                  "w-full h-[34px] px-3 text-[10px] font-bold uppercase tracking-wider border transition-colors",
                  step.is_eliminatory
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-background text-muted-foreground border-foreground/30 hover:border-foreground"
                )}
              >
                {step.is_eliminatory ? '⚡ Oui' : 'Non'}
              </button>
            </div>
          </div>

          {/* Objectives */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Objectifs</label>
            <div className="flex flex-wrap gap-1.5">
              {step.objectives.map((obj, i) => (
                <span key={i} className="flex items-center gap-1 px-2 py-1 bg-foreground/5 border border-foreground/20 text-[10px] font-medium text-foreground">
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
                  className="h-[30px] w-40 px-2 text-[11px] border border-dashed border-foreground/20 bg-transparent text-foreground focus:border-foreground/50 focus:outline-none"
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
  onAdd: (input: { user_id: string; role: string }) => Promise<any>;
  onRemove: (id: string) => Promise<any>;
}

const MissionTeamSection: React.FC<MissionTeamSectionProps> = ({
  team, loadingTeam, readOnly, getMemberName, orgMembers, projectId, onAdd, onRemove,
}) => {
  const { invitations, sendInvitation, isSending, cancelInvitation } = useMissionInvitations(projectId);
  const [showAssign, setShowAssign] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('sourcer');

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
    <div className="mt-8 pt-6 border-t border-foreground/10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Équipe mission ({team.length})
          </h3>
        </div>
        {!readOnly && availableMembers.length > 0 && !showAssign && (
          <button
            onClick={() => setShowAssign(true)}
            className="flex items-center gap-1 h-[30px] px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground/30 bg-background text-foreground hover:border-foreground transition-colors"
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
            className="flex-1 h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
          >
            <option value="">Sélectionner un membre...</option>
            {availableMembers.map((m: any) => (
              <option key={m.user_id} value={m.user_id}>{getMemberName(m.user_id)}</option>
            ))}
          </select>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="h-[34px] px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none"
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
            className="h-[34px] px-4 bg-foreground text-background text-[10px] font-bold uppercase tracking-wider border border-foreground disabled:opacity-50"
          >
            OK
          </button>
          <button
            onClick={() => { setShowAssign(false); setSelectedUserId(''); }}
            className="h-[34px] px-3 text-muted-foreground hover:text-foreground border border-foreground/30 text-[10px] uppercase"
          >
            ×
          </button>
        </div>
      )}

      {loadingTeam ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-4 h-4 border-2 border-foreground/20 border-t-foreground animate-spin" />
        </div>
      ) : team.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucun membre assigné à cette mission.</p>
      ) : (
        <div className="space-y-2">
          {team.map((member: any) => (
            <div key={member.id} className="flex items-center gap-3 px-4 py-2 border border-foreground/10">
              <div className="w-7 h-7 bg-foreground/10 flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{getMemberName(member.user_id)}</p>
              </div>
              <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border border-foreground/20 text-muted-foreground">
                {ROLE_LABELS[member.role] || member.role}
              </span>
              {!readOnly && (
                <button
                  onClick={() => {
                    if (confirm(`Retirer ${getMemberName(member.user_id)} de cette mission ?`)) {
                      onRemove(member.id);
                    }
                  }}
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
        <div className="mt-4 pt-4 border-t border-foreground/10">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Invitations externes ({invitations.filter(i => i.status === 'pending').length} en attente)
            </p>
            {!showInvite && (
              <button
                onClick={() => setShowInvite(true)}
                className="flex items-center gap-1 h-[30px] px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground/30 bg-background text-foreground hover:border-foreground transition-colors"
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
                className="flex-1 h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (inviteEmail.trim()) {
                      sendInvitation({ email: inviteEmail.trim(), role: 'freelance' })
                        .then(() => { setInviteEmail(''); setShowInvite(false); })
                        .catch(() => {});
                    }
                  }
                }}
              />
              <button
                onClick={() => {
                  if (inviteEmail.trim()) {
                    sendInvitation({ email: inviteEmail.trim(), role: 'freelance' })
                      .then(() => { setInviteEmail(''); setShowInvite(false); })
                      .catch(() => {});
                  }
                }}
                disabled={!inviteEmail.trim() || isSending}
                className="h-[34px] px-4 bg-foreground text-background text-[10px] font-bold uppercase tracking-wider border border-foreground disabled:opacity-50"
              >
                {isSending ? 'Envoi...' : 'Inviter'}
              </button>
              <button
                onClick={() => { setShowInvite(false); setInviteEmail(''); }}
                className="h-[34px] px-2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {invitations.length > 0 && (
            <div className="space-y-1.5">
              {invitations.map(inv => (
                <div key={inv.id} className="flex items-center gap-3 px-3 py-2 border border-foreground/10">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{inv.email}</p>
                  </div>
                  <span className={cn(
                    "px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border",
                    inv.status === 'accepted' ? "border-green-600 text-green-600" :
                    inv.status === 'pending' ? "border-amber-500 text-amber-600" :
                    "border-foreground/20 text-muted-foreground"
                  )}>
                    {inv.status === 'pending' ? 'En attente' : inv.status === 'accepted' ? 'Acceptée' : inv.status === 'rejected' ? 'Refusée' : 'Expirée'}
                  </span>
                  {inv.status === 'pending' && (
                    <button
                      onClick={() => cancelInvitation(inv.id)}
                      className="text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                      title="Annuler l'invitation"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
    <div className="bg-background border border-foreground border-t-0 p-4 sm:p-6">
      {readOnly && (
        <div className="mb-4 px-3 py-2 border border-foreground/20 bg-muted/30 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            👁️ Lecture seule — le process est défini par le lead recruteur
          </span>
        </div>
      )}
      {/* Steps timeline */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Étapes du process ({steps.length})
        </h3>
        {steps.length === 0 && !loadingSteps && !readOnly && (
          <button
            onClick={initializeDefaultSteps}
            disabled={isAdding}
            className="relative overflow-hidden flex items-center gap-1.5 h-[30px] px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground bg-foreground text-background group"
          >
            <span className="relative z-10">Créer un process par défaut</span>
          </button>
        )}
      </div>

      {loadingSteps ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground animate-spin" />
        </div>
      ) : steps.length === 0 ? (
        <div className="border border-dashed border-foreground/20 p-6">
          <div className="text-3xl mb-3 text-center">🏗️</div>
          <p className="text-sm text-muted-foreground mb-5 text-center">
            {readOnly ? 'Aucune étape définie pour cette mission.' : 'Choisissez un template ou laissez l\'IA suggérer un process.'}
          </p>
          {!readOnly && (
            <div className="space-y-4">
              {/* AI suggestion button */}
              <button
                onClick={handleAISuggestion}
                disabled={isAdding || suggestingAI}
                className="relative overflow-hidden w-full flex items-center justify-center gap-2 h-[40px] bg-foreground text-background border border-foreground text-[10px] font-medium uppercase tracking-wider group"
              >
                {suggestingAI ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" /><span className="relative z-10">Analyse du brief...</span></>
                ) : (
                  <><Sparkles className="w-3.5 h-3.5 relative z-10" /><span className="relative z-10">Suggestion IA (basé sur le brief)</span></>
                )}
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              </button>

              {/* Template grid */}
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(PROCESS_TEMPLATES).map(([key, tpl]) => (
                  <button
                    key={key}
                    onClick={() => initializeFromTemplate(tpl.steps)}
                    disabled={isAdding}
                    className="border border-foreground/20 p-3 text-left hover:border-foreground hover:shadow-[2px_2px_0px_0px_hsl(var(--foreground))] transition-all disabled:opacity-50"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <FileText className="w-3 h-3 text-muted-foreground" />
                      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground">{tpl.label}</p>
                    </div>
                    <p className="text-[9px] text-muted-foreground">{tpl.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Fixed first step: Submit candidate */}
          <div className="flex items-center gap-3 px-4 py-3 border border-foreground/10 bg-muted/20">
            <div className="flex items-center justify-center w-7 h-7 bg-muted text-muted-foreground text-[11px] font-bold shrink-0">→</div>
            <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Candidat soumis</span>
          </div>

          {/* Draggable steps */}
          {steps.map((step, index) => (
            <StepCard
              key={step.id}
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
          ))}

          {/* Fixed last step: Hired */}
          <div className="flex items-center gap-3 px-4 py-3 border border-foreground/10 bg-brutal-accent/10">
            <div className="flex items-center justify-center w-7 h-7 bg-brutal-accent text-background text-[11px] font-bold shrink-0">✓</div>
            <span className="text-sm font-bold uppercase tracking-wider text-foreground">Embauché</span>
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
              className="flex-1 h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
            />
            <button
              onClick={handleAddStep}
              disabled={!newStepName.trim()}
              className="h-[34px] px-4 bg-foreground text-background text-[10px] font-bold uppercase tracking-wider border border-foreground disabled:opacity-50"
            >
              Ajouter
            </button>
            <button
              onClick={() => { setAddingStep(false); setNewStepName(''); }}
              className="h-[34px] px-3 text-muted-foreground hover:text-foreground border border-foreground/30 text-[10px] font-bold uppercase tracking-wider"
            >
              Annuler
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingStep(true)}
            className="relative overflow-hidden flex items-center gap-1.5 h-[34px] px-4 text-[10px] font-medium uppercase tracking-wider border border-dashed border-foreground/30 bg-background text-muted-foreground hover:text-foreground hover:border-foreground transition-colors group w-full justify-center"
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
        onAdd={addTeamMember}
        onRemove={removeTeamMember}
      />
    </div>
  );
};
