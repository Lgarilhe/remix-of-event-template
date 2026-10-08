import { BookOpen, Brain, Database, SlidersHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { type SourcingAgent } from '@/types/sourcingAgent';
import { AGENT_MEMORY_KIND_LABEL, type AgentMemoryKind } from '@/types/agentMemory';

interface Props {
  projectId: string;
  projectName?: string;
  agent?: SourcingAgent | null;
  orgType: 'enterprise' | 'agency' | 'freelance';
  verified: boolean;
  onMemories: () => void;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === 'string' ? value : '';
const kindLabel = (value: unknown) => typeof value === 'string' && Object.prototype.hasOwnProperty.call(AGENT_MEMORY_KIND_LABEL, value)
  ? AGENT_MEMORY_KIND_LABEL[value as AgentMemoryKind] : 'Mémoire';

export function SourcingAgentContext({ projectId, projectName, agent, orgType, verified, onMemories }: Props) {
  const context = agent?.context_snapshot ?? {};
  const brief = record(context.job_details);
  const source = agent?.source === 'linkedin' ? 'LinkedIn' : agent ? 'Vos candidats existants' : 'À choisir';
  const rows = [...(Array.isArray(context.search_memory_provenance) ? context.search_memory_provenance : []),
    ...(Array.isArray(context.scoring_memory_provenance) ? context.scoring_memory_provenance : [])].map(record);
  const memories = [...new Map(rows.filter(row => typeof row.id === 'string' && typeof row.content === 'string').map(row => [string(row.id), row])).values()];
  const organizationLabel = orgType === 'agency' ? 'Cabinet' : orgType === 'enterprise' ? 'Entreprise' : 'Votre activité';
  const organizationPhrase = orgType === 'agency' ? 'du cabinet' : orgType === 'enterprise' ? 'de l’entreprise' : 'de votre activité';
  return <Card className="space-y-5 p-4 sm:p-5">
    <div className="space-y-1"><h3 className="text-base font-semibold">Le cap de votre agent</h3><p className="text-sm text-muted-foreground">{agent ? verified ? 'Le contexte de son dernier calibrage.' : 'Le contexte enregistré reste à vérifier avant de reprendre.' : 'Il partira du cadrage et des règles de votre mission.'}</p></div>
    <dl className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1"><dt className="flex items-center gap-2 text-xs text-muted-foreground"><BookOpen aria-hidden="true" className="h-4 w-4 text-foreground" />{orgType === 'enterprise' ? 'Poste' : 'Mission'}</dt><dd className="text-sm font-medium break-words">{string(brief.title) || projectName || 'Mission en cours'}</dd></div>
      <div className="space-y-1"><dt className="flex items-center gap-2 text-xs text-muted-foreground"><Database aria-hidden="true" className="h-4 w-4 text-foreground" />Source de recherche</dt><dd className="text-sm font-medium">{source}</dd></div>
    </dl>
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="flex items-center gap-2 text-sm font-medium"><Brain aria-hidden="true" className="h-4 w-4" />Mémoires de recherche et de scoring</h4><Button type="button" variant="ghost" size="sm" className="max-sm:min-h-11" onClick={onMemories}>Voir les mémoires</Button></div>
      <p className="text-xs text-muted-foreground">Les règles confirmées {organizationPhrase} encadrent {orgType === 'enterprise' ? 'le poste' : 'la mission'}. Vos avis sur les profils ne créent aucune règle automatiquement.</p>
      {memories.length > 0 ? <Collapsible><CollapsibleTrigger asChild><Button type="button" variant="outline" size="sm" className="max-sm:min-h-11">Lire les {memories.length} mémoire{memories.length > 1 ? 's' : ''} du calibrage</Button></CollapsibleTrigger><CollapsibleContent><ul className="mt-3 divide-y divide-border">{memories.map(memory => <li key={string(memory.id)} className="space-y-1 py-3"><p className="text-xs font-medium">{memory.scope === 'organization' ? organizationLabel : orgType === 'enterprise' ? 'Poste' : 'Mission'} · {kindLabel(memory.kind)}</p><p className="text-sm whitespace-pre-wrap break-words">{string(memory.content)}</p></li>)}</ul></CollapsibleContent></Collapsible> : <p className="text-xs text-muted-foreground">{agent ? 'Aucune mémoire de recherche ou de scoring enregistrée dans ce calibrage.' : 'Les mémoires applicables seront vérifiées lors de la préparation.'}</p>}
    </div>
    <Button type="button" variant="ghost" size="sm" className="max-sm:min-h-11" asChild><Link to={`/missions/${projectId}/sourcing`}><SlidersHorizontal aria-hidden="true" className="h-4 w-4" />Revoir le cadrage et les filtres de la mission</Link></Button>
  </Card>;
}
