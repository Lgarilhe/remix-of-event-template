import { useEffect, useId, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AGENT_MEMORY_EFFECT_LABEL,
  AGENT_MEMORY_KIND_LABEL,
  EDITABLE_AGENT_MEMORY_EFFECTS,
  agentMemoryScopeLabel,
  canUseAgentMemoryEffect,
  type AgentMemoryDraft,
  type AgentMemoryKind,
  type AgentMemoryScope,
} from '@/types/agentMemory';

interface Props {
  value: AgentMemoryDraft;
  onChange: (draft: AgentMemoryDraft) => void;
  projectId: string | null;
  orgType: 'agency' | 'enterprise' | 'freelance' | null;
  canManageOrganization: boolean;
  canManageProject: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function AgentMemoryFields({ value, onChange, projectId, orgType, canManageOrganization, canManageProject, disabled, autoFocus = false }: Props) {
  const id = useId();
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [removedRecruitingEffects, setRemovedRecruitingEffects] = useState(false);
  useEffect(() => {
    if (!autoFocus) return;
    // Native focus can scroll before the dialog settles at its new height.
    const frame = requestAnimationFrame(() => contentRef.current?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);
  const projectLabel = orgType === 'enterprise' ? 'poste' : 'mission';
  const hasNoEffect = value.effects.length === 0;
  const hasUnavailableEffect = value.effects.some((effect) => !canUseAgentMemoryEffect(value.scope, effect));
  const effectsDescription = `${id}-effects-help${hasNoEffect || hasUnavailableEffect ? ` ${id}-effects-error` : ''}`;
  const changeScope = (scope: AgentMemoryScope) => {
    const effects = value.effects.filter((effect) => canUseAgentMemoryEffect(scope, effect));
    setRemovedRecruitingEffects(effects.length !== value.effects.length);
    onChange({ ...value, scope, effects });
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-content`}>À mémoriser</Label>
        <Textarea ref={contentRef} id={`${id}-content`} aria-describedby={`${id}-content-help`} value={value.content} maxLength={2000} rows={3} disabled={disabled} autoFocus={autoFocus}
          onChange={(event) => onChange({ ...value, content: event.target.value })}
          placeholder="Ex. : répondre en français avec des explications courtes." />
        <p id={`${id}-content-help`} className="text-xs text-muted-foreground">Entre 5 et 2 000 caractères.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-scope`}>Niveau</Label>
          <Select value={value.scope} disabled={disabled} onValueChange={changeScope}>
            <SelectTrigger id={`${id}-scope`} aria-describedby={`${id}-scope-help`} className="min-h-11 md:min-h-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {projectId && <SelectItem value="project" className="min-h-11 md:min-h-0" disabled={!canManageProject}>{agentMemoryScopeLabel('project', orgType)}</SelectItem>}
              <SelectItem value="user" className="min-h-11 md:min-h-0">{agentMemoryScopeLabel('user', orgType)}</SelectItem>
              <SelectItem value="organization" className="min-h-11 md:min-h-0" disabled={!canManageOrganization}>{agentMemoryScopeLabel('organization', orgType)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-kind`}>Nature</Label>
          <Select value={value.kind} disabled={disabled} onValueChange={(kind: AgentMemoryKind) => onChange({ ...value, kind })}>
            <SelectTrigger id={`${id}-kind`} className="min-h-11 md:min-h-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(AGENT_MEMORY_KIND_LABEL).map(([kind, label]) => <SelectItem key={kind} value={kind} className="min-h-11 md:min-h-0">{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p id={`${id}-scope-help`} className="text-sm text-foreground-secondary">« Pour moi » concerne vos préférences dans cet espace. {projectId
        ? `Un critère propre à ce recrutement appartient au niveau « ${agentMemoryScopeLabel('project', orgType)} ».`
        : `Pour ajouter un critère propre à un recrutement, ouvrez ${orgType === 'enterprise' ? 'le' : 'la'} ${projectLabel} concerné${orgType === 'enterprise' ? '' : 'e'}.`}</p>
      <fieldset disabled={disabled} aria-describedby={effectsDescription} className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Utiliser pour</legend>
        {EDITABLE_AGENT_MEMORY_EFFECTS.map((effect) => (
          <div key={effect} className="flex items-center gap-2">
            <Checkbox id={`${id}-${effect}`} checked={value.effects.includes(effect)} disabled={!canUseAgentMemoryEffect(value.scope, effect)} aria-describedby={effectsDescription} aria-invalid={hasNoEffect || hasUnavailableEffect}
              onCheckedChange={(checked) => onChange({ ...value, effects: checked === true
                ? [...new Set([...value.effects, effect])]
                : value.effects.filter((current) => current !== effect) })} />
            <Label htmlFor={`${id}-${effect}`} className="flex min-h-11 flex-1 cursor-pointer items-center text-sm font-normal leading-5 md:min-h-0">{AGENT_MEMORY_EFFECT_LABEL[effect]}</Label>
          </div>
        ))}
      </fieldset>
      <div id={`${id}-effects-help`} className="space-y-2 text-sm text-foreground-secondary">
        {value.scope === 'user' && <p>La recherche et l’évaluation des profils demandent un niveau partagé : {projectId ? `« ${agentMemoryScopeLabel('project', orgType)} » ou ` : ''}« {agentMemoryScopeLabel('organization', orgType)} ».</p>}
        {value.effects.includes('search') && <p>Recherche : guide la prochaine génération de filtres. Vous relisez les filtres avant de lancer la recherche.</p>}
        {value.effects.includes('scoring') && <p>Évaluation des profils : s’applique aux prochaines évaluations. Les profils déjà notés doivent être réévalués.</p>}
        {!value.effects.includes('search') && !value.effects.includes('scoring') && <p>Les autres utilisations guident les réponses de l’assistant et la présentation des résultats.</p>}
      </div>
      {removedRecruitingEffects && <p role="status" className="text-sm text-foreground-secondary">Les usages Recherche et Évaluation des profils ont été retirés en choisissant « Pour moi ».</p>}
      {hasNoEffect && <p id={`${id}-effects-error`} role="alert" className="text-sm text-danger">Sélectionnez au moins une utilisation.</p>}
      {!hasNoEffect && hasUnavailableEffect && <p id={`${id}-effects-error`} role="alert" className="text-sm text-danger">Choisissez un niveau partagé pour utiliser cette mémoire dans la recherche ou l’évaluation des profils.</p>}
    </div>
  );
}
