import React, { useState } from 'react';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useMissionProcess, ProcessStep } from '@/hooks/useMissionProcess';
import { GripVertical, Plus, Trash2, Zap, Clock, User, ChevronDown, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

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

export const MissionProcess: React.FC<MissionProcessProps> = ({ project, readOnly = false }) => {
  const {
    steps, team, loadingSteps, loadingTeam,
    addStep, updateStep, deleteStep, reorderSteps,
    initializeDefaultSteps, isAdding,
  } = useMissionProcess(project.id);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [addingStep, setAddingStep] = useState(false);
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
        <div className="border border-dashed border-foreground/20 p-8 text-center">
          <div className="text-3xl mb-3">🏗️</div>
          <p className="text-sm text-muted-foreground mb-4">
            {readOnly ? 'Aucune étape définie pour cette mission.' : 'Aucune étape définie. Créez votre process de recrutement.'}
          </p>
          {!readOnly && <button
            onClick={initializeDefaultSteps}
            disabled={isAdding}
            className="relative overflow-hidden h-[34px] px-5 bg-foreground text-background border border-foreground text-[10px] font-medium uppercase tracking-wider group"
          >
            <span className="relative z-10">{isAdding ? 'Création...' : 'Créer un process par défaut'}</span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </button>}
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
          <div className="flex items-center gap-3 px-4 py-3 border border-foreground/10 bg-emerald-50">
            <div className="flex items-center justify-center w-7 h-7 bg-emerald-600 text-white text-[11px] font-bold shrink-0">✓</div>
            <span className="text-sm font-bold uppercase tracking-wider text-emerald-700">Embauché</span>
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
      <div className="mt-8 pt-6 border-t border-foreground/10">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Équipe mission ({team.length})
          </h3>
        </div>

        {loadingTeam ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-4 h-4 border-2 border-foreground/20 border-t-foreground animate-spin" />
          </div>
        ) : team.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun membre assigné à cette mission.</p>
        ) : (
          <div className="space-y-2">
            {team.map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-4 py-2 border border-foreground/10">
                <div className="w-7 h-7 bg-foreground/10 flex items-center justify-center">
                  <User className="w-3.5 h-3.5 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{member.user_id}</p>
                </div>
                <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border border-foreground/20 text-muted-foreground">
                  {member.role}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
