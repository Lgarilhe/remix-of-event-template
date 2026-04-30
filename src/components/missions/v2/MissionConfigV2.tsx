/**
 * MissionConfigV2 — Configuration de la mission, refondue (DA v2).
 *
 * Layout aligné à gauche, 2 colonnes :
 *   - Form principal : sections en cards (Infos / Hunt / Portail)
 *   - Sidebar sticky : status + auto-save + raccourcis
 *
 * Réutilise MissionHuntMode et MissionClientPortal sans modification.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Settings, Cloud, CloudUpload, Check, AlertCircle, Globe, Target,
  Calendar, Eye, Briefcase,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { useOrganization } from '@/hooks/useOrganization';
import { MissionHuntMode } from '../MissionHuntMode';
import { MissionClientPortal } from '../MissionClientPortal';
import { Pill } from './Pill';

interface MissionConfigV2Props {
  project: SourcingProject;
  readOnly?: boolean;
}

const STATUS_OPTIONS: { value: SourcingProject['status']; label: string; color: string }[] = [
  { value: 'active', label: '🟢 Actif', color: 'hsl(var(--status-success))' },
  { value: 'paused', label: '🟡 En pause', color: 'hsl(var(--status-warning))' },
  { value: 'completed', label: '🔵 Terminé', color: 'hsl(var(--status-info))' },
  { value: 'archived', label: '⚪ Archivé', color: 'hsl(var(--muted-foreground))' },
];

// ──────────────────────────────────────────────────────────────────

export const MissionConfigV2: React.FC<MissionConfigV2Props> = ({ project, readOnly = false }) => {
  const { updateProject } = useSourcingProjects();
  const { isAgency } = useOrganization();

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    };
  }, []);

  const handleUpdate = useCallback(async (patch: Partial<SourcingProject>) => {
    if (readOnly) return;
    setSaveStatus('saving');
    try {
      await updateProject({ id: project.id, ...patch } as any);
      setSaveStatus('saved');
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
    }
  }, [project.id, updateProject, readOnly]);

  const currentStatus = STATUS_OPTIONS.find(s => s.value === project.status) || STATUS_OPTIONS[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 pb-8">
      {/* Form principal */}
      <div className="min-w-0">
        {/* Header */}
        <div className="mb-5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            Étape 1 · Cadrage
          </p>
          <h2 className="font-display text-[24px] font-bold leading-tight">Configuration</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Paramètres généraux de la mission, hunt mode et portail client.
          </p>
        </div>

        {readOnly && (
          <div className="mb-4 px-4 py-3 rounded-lg border border-border bg-muted/30 inline-flex items-center gap-2">
            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Lecture seule — la configuration est gérée par le lead recruteur
            </span>
          </div>
        )}

        <div className="space-y-4">
          {/* Section Infos mission */}
          <SectionCard
            emoji="⚙️"
            title="Infos mission"
            subtitle="Identité et statut"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Nom de la mission" required>
                <DebouncedInput
                  defaultValue={project.name}
                  onCommit={(v) => handleUpdate({ name: v.trim() || project.name })}
                  placeholder="Ex: Lead Engineer @ Doctolib"
                  readOnly={readOnly}
                />
              </Field>

              {isAgency && (
                <Field label="Client">
                  <DebouncedInput
                    defaultValue={project.client_name || ''}
                    onCommit={(v) => handleUpdate({ client_name: v || null })}
                    placeholder="Ex: Doctolib"
                    readOnly={readOnly}
                  />
                </Field>
              )}

              <Field label="Statut">
                <select
                  value={project.status}
                  onChange={(e) => handleUpdate({ status: e.target.value as SourcingProject['status'] })}
                  disabled={readOnly}
                  className={cn(
                    'w-full h-9 px-3 rounded-md border border-border bg-background text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                    readOnly && 'bg-muted/30 cursor-not-allowed',
                  )}
                >
                  {STATUS_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </Field>

              <Field
                label="Lien Calendly"
                hint="Le lien sera utilisé pour le bouton 'Programmer un RDV' sur les conversations candidat"
              >
                <DebouncedInput
                  defaultValue={project.calendly_link || ''}
                  onCommit={(v) => handleUpdate({ calendly_link: v || null })}
                  placeholder="https://calendly.com/..."
                  type="url"
                  readOnly={readOnly}
                />
              </Field>
            </div>

            <div className="pt-3 border-t border-border">
              <Field label="Notes internes" hint="Notes privées sur cette mission (visibles uniquement par ton équipe)">
                <DebouncedTextarea
                  defaultValue={project.notes || ''}
                  onCommit={(v) => handleUpdate({ notes: v || null })}
                  placeholder="Contexte, alertes, décisions clés..."
                  rows={4}
                  readOnly={readOnly}
                />
              </Field>
            </div>
          </SectionCard>

          {/* Mode Hunt et Portail client — composants déjà cards rounded-xl */}
          {!readOnly && <MissionHuntMode project={project} />}
          {!readOnly && <MissionClientPortal project={project} />}
        </div>
      </div>

      {/* Sidebar */}
      <aside className="lg:sticky lg:top-4 lg:self-start space-y-3">
        {/* Save indicator */}
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="flex items-center gap-2">
            {saveStatus === 'saving' && (
              <>
                <CloudUpload className="w-3.5 h-3.5 text-info animate-pulse" />
                <span className="text-[11px] text-muted-foreground">Enregistrement…</span>
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <Check className="w-3.5 h-3.5" style={{ color: 'hsl(var(--status-success))' }} />
                <span className="text-[11px]" style={{ color: 'hsl(var(--status-success))' }}>Enregistré</span>
              </>
            )}
            {saveStatus === 'idle' && (
              <>
                <Cloud className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">Auto-sauvegarde activée</span>
              </>
            )}
            {saveStatus === 'error' && (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                <span className="text-[11px] text-destructive">Erreur de sauvegarde</span>
              </>
            )}
          </div>
        </div>

        {/* Statut actuel */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Statut actuel
          </p>
          <div className="flex items-center gap-2 mb-3">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: currentStatus.color }}
            />
            <span className="font-display text-[16px] font-bold">{currentStatus.label}</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {project.status === 'active' && 'Sourcing, outreach et pipeline disponibles.'}
            {project.status === 'paused' && 'Aucune nouvelle action — la mission peut être réactivée.'}
            {project.status === 'completed' && 'Mission terminée — consultez le pipeline pour le bilan.'}
            {project.status === 'archived' && 'Mission archivée — accès en lecture seule.'}
          </p>
        </div>

        {/* Quick links */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Raccourcis
          </p>
          <div className="space-y-2">
            {project.calendly_link && (
              <a
                href={project.calendly_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors group"
              >
                <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate group-hover:underline">Ouvrir Calendly</span>
              </a>
            )}
            {!project.calendly_link && (
              <p className="text-[11px] text-muted-foreground/70 italic">
                Configure ton Calendly pour activer le bouton RDV dans l'inbox
              </p>
            )}
          </div>
        </div>

        {/* Tips */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            💡 Conseil
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Le <strong className="text-foreground">portail client</strong> permet à ton client de voir uniquement les candidats que tu as présentés, sans accès au reste de Konekt.
          </p>
        </div>
      </aside>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────

const SectionCard: React.FC<{
  emoji: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ emoji, title, subtitle, children }) => (
  <div className="bg-card border border-border rounded-xl overflow-hidden">
    <div className="px-5 py-3 border-b border-border flex items-center gap-3">
      <span className="text-base">{emoji}</span>
      <div>
        <h3 className="font-display text-[14px] font-bold leading-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
    <div className="p-5 space-y-3">{children}</div>
  </div>
);

const Field: React.FC<{
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, required, hint, children }) => (
  <div>
    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
    <div className="mt-1">{children}</div>
    {hint && <p className="text-[10.5px] text-muted-foreground mt-1.5 leading-snug">{hint}</p>}
  </div>
);

// Inputs avec sauvegarde au blur (pas debouncé sur la saisie pour rester perf)
const DebouncedInput: React.FC<{
  defaultValue: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
}> = ({ defaultValue, onCommit, placeholder, type = 'text', readOnly }) => (
  <input
    type={type}
    defaultValue={defaultValue}
    onBlur={(e) => {
      if (e.target.value !== defaultValue) onCommit(e.target.value);
    }}
    placeholder={placeholder}
    readOnly={readOnly}
    className={cn(
      'w-full h-9 px-3 rounded-md border border-border bg-background text-sm',
      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
      readOnly && 'bg-muted/30 cursor-not-allowed',
    )}
  />
);

const DebouncedTextarea: React.FC<{
  defaultValue: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
}> = ({ defaultValue, onCommit, placeholder, rows = 4, readOnly }) => (
  <textarea
    defaultValue={defaultValue}
    onBlur={(e) => {
      if (e.target.value !== defaultValue) onCommit(e.target.value);
    }}
    placeholder={placeholder}
    rows={rows}
    readOnly={readOnly}
    className={cn(
      'w-full px-3 py-2 rounded-md border border-border bg-background text-sm leading-relaxed resize-none',
      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
      readOnly && 'bg-muted/30 cursor-not-allowed',
    )}
  />
);
