import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AGENT_MEMORY_EFFECT_LABEL,
  AGENT_MEMORY_KIND_LABEL,
  EDITABLE_AGENT_MEMORY_EFFECTS,
  agentMemoryScopeLabel,
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
}

export function AgentMemoryFields({ value, onChange, projectId, orgType, canManageOrganization, canManageProject, disabled }: Props) {
  const id = useId();
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-content`}>À mémoriser</Label>
        <Textarea id={`${id}-content`} value={value.content} maxLength={2000} rows={3} disabled={disabled}
          onChange={(event) => onChange({ ...value, content: event.target.value })}
          placeholder="Une règle ou une préférence durable, formulée précisément." />
        <p className="text-xs text-muted-foreground">Entre 5 et 2 000 caractères.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-scope`}>Niveau</Label>
          <Select value={value.scope} disabled={disabled} onValueChange={(scope: AgentMemoryScope) => onChange({ ...value, scope })}>
            <SelectTrigger id={`${id}-scope`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {projectId && <SelectItem value="project" disabled={!canManageProject}>{agentMemoryScopeLabel('project', orgType)}</SelectItem>}
              <SelectItem value="user">{agentMemoryScopeLabel('user', orgType)}</SelectItem>
              <SelectItem value="organization" disabled={!canManageOrganization}>{agentMemoryScopeLabel('organization', orgType)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-kind`}>Nature</Label>
          <Select value={value.kind} disabled={disabled} onValueChange={(kind: AgentMemoryKind) => onChange({ ...value, kind })}>
            <SelectTrigger id={`${id}-kind`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(AGENT_MEMORY_KIND_LABEL).map(([kind, label]) => <SelectItem key={kind} value={kind}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">« Pour moi » concerne vos préférences dans cet espace. Un critère propre à un recrutement doit rester au niveau de la mission.</p>
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Effets</legend>
        {EDITABLE_AGENT_MEMORY_EFFECTS.map((effect) => (
          <div key={effect} className="flex items-center gap-2">
            <Checkbox id={`${id}-${effect}`} checked={value.effects.includes(effect)}
              onCheckedChange={(checked) => onChange({ ...value, effects: checked === true
                ? [...new Set([...value.effects, effect])]
                : value.effects.filter((current) => current !== effect) })} />
            <Label htmlFor={`${id}-${effect}`} className="cursor-pointer text-sm font-normal">{AGENT_MEMORY_EFFECT_LABEL[effect]}</Label>
          </div>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">Cette mémoire guide les réponses de l’assistant. Elle ne met pas à jour les filtres enregistrés ni la grille de notation.</p>
    </div>
  );
}
