import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  GitBranch,
  ChevronDown,
  Loader2,
  Plus,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { LinkedInProfile } from './types';
import { SequenceEnrollModal } from './SequenceEnrollModal';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { hasPlanFeature } from '@/lib/featureGates';
import { SEQUENCES_PLAN_REQUIRED_MESSAGE } from './enrollment-preview/enrollmentHelpers';

interface SequenceOption {
  id: string;
  name: string;
  steps: any[];
  is_active: boolean;
  project_id: string | null;
  /** Nombre d'étapes lu avec la liste (sequence_steps(count)). */
  stepCount: number;
}

/**
 * Poste ou mission transmis à l'inscription. Le poste complet (compétences,
 * description, lieu, accompagnement) nourrit l'aperçu IA : ne pas le réduire à
 * { id, title } (même contexte depuis une carte, la fiche ou la barre groupée).
 */
export interface SequenceEnrollJob {
  id: string;
  title: string;
  client?: unknown;
  skills?: string[];
  description?: string;
  location?: string;
  accompagnement?: string[];
}

interface SequenceEnrollButtonProps {
  selectedProfiles: LinkedInProfile[];
  accountId: string;
  selectedJob?: SequenceEnrollJob | null;
  onSuccess?: () => void;
  onCreateSequence?: () => void;
}

/** Identifiant de mission (sourcing_projects.id) d'un poste synthétique « project:{uuid} ». */
function missionIdOf(job: SequenceEnrollJob | null | undefined): string | null {
  return job?.id?.startsWith('project:') ? job.id.slice('project:'.length) : null;
}

export const SequenceEnrollButton: React.FC<SequenceEnrollButtonProps> = ({
  selectedProfiles,
  accountId,
  selectedJob,
  onSuccess,
  onCreateSequence,
}) => {
  const [sequences, setSequences] = useState<SequenceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedSequence, setSelectedSequence] = useState<SequenceOption | null>(null);
  const [showEnrollModal, setShowEnrollModal] = useState(false);

  // Gating par plan (lot P0-C) : pas d'inscription sur le plan gratuit. Tant que
  // l'état d'abonnement charge, on ne refuse rien (le serveur reste la référence).
  const { effectivePlanId, isLoading: isPlanLoading } = useSubscriptionState();
  const canSendSequences = isPlanLoading || hasPlanFeature(effectivePlanId, 'sequences_send');

  const missionId = missionIdOf(selectedJob);

  // Rechargée à chaque ouverture du menu : une séquence créée, activée ou
  // désactivée ailleurs apparaît (ou disparaît) sans remonter le composant.
  const fetchSequences = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data: seqData, error: seqError } = await supabase
        .from('outreach_sequences')
        .select('id, name, is_active, created_at, project_id, sequence_steps(count)')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (seqError) throw seqError;

      const enriched: SequenceOption[] = (seqData || []).map(seq => {
        const counts = (seq as { sequence_steps?: Array<{ count: number }> }).sequence_steps;
        return {
          id: seq.id,
          name: seq.name,
          is_active: seq.is_active,
          project_id: seq.project_id,
          stepCount: counts?.[0]?.count ?? 0,
          steps: [], // Étapes chargées au choix de la séquence
        };
      });

      setSequences(enriched);
    } catch (err) {
      console.error('Error fetching sequences:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  // Séquences de la mission courante d'abord, puis les autres ; filtre par nom.
  const visibleSequences = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? sequences.filter(s => s.name.toLowerCase().includes(q)) : sequences;
    if (!missionId) return { mission: [] as SequenceOption[], others: filtered };
    return {
      mission: filtered.filter(s => s.project_id === missionId),
      others: filtered.filter(s => s.project_id !== missionId),
    };
  }, [sequences, search, missionId]);

  const handleSelectSequence = async (sequence: SequenceOption) => {
    // Lazy-load steps only when the user actually picks a sequence
    if (sequence.steps.length === 0) {
      try {
        const { data: stepsData, error: stepsError } = await supabase
          .from('sequence_steps')
          .select('*')
          .eq('sequence_id', sequence.id)
          .order('step_order', { ascending: true });

        if (stepsError) throw stepsError;
        sequence = { ...sequence, steps: stepsData || [] };
      } catch (err) {
        // Ne PAS ouvrir le modal avec steps=[] : l'inscription créerait des
        // candidats « dormants » (actifs mais sans aucune exécution planifiée,
        // jamais repris par le moteur — audit 2026-07, Frontend H3).
        console.error('Error fetching steps:', err);
        toast.error('Impossible de charger les étapes de la séquence. Réessayez.');
        return;
      }
    }

    // Séquence réellement vide → bloquer aussi (même risque de dormants).
    if (sequence.steps.length === 0) {
      toast.error("Cette séquence ne contient aucune étape. Ajoutez au moins une étape avant d'inscrire des candidats.");
      return;
    }

    setSelectedSequence(sequence);
    setShowEnrollModal(true);
  };

  // Pas de toast ici : la fenêtre d'inscription a déjà donné le bilan exact.
  const handleEnrollSuccess = () => {
    setShowEnrollModal(false);
    setSelectedSequence(null);
    onSuccess?.();
  };

  if (selectedProfiles.length === 0) {
    return null;
  }

  const count = selectedProfiles.length;
  const renderItem = (seq: SequenceOption) => (
    <DropdownMenuItem
      key={seq.id}
      onClick={() => handleSelectSequence(seq)}
      className="cursor-pointer"
    >
      <div className="flex items-center justify-between w-full gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="w-4 h-4 text-success shrink-0" />
          <span className="font-medium truncate">{seq.name}</span>
        </div>
        {seq.stepCount > 0 && (
          <Badge variant="secondary" className="text-xs shrink-0">
            {seq.stepCount} étape{seq.stepCount > 1 ? 's' : ''}
          </Badge>
        )}
      </div>
    </DropdownMenuItem>
  );
  const hasVisible = visibleSequences.mission.length + visibleSequences.others.length > 0;

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) {
            setSearch('');
            return;
          }
          if (!canSendSequences) {
            return;
          }
          void fetchSequences();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            title="Inscrire dans une séquence"
            className="border-2 border-success/70 text-success bg-success/10 shadow-sm hover:bg-success/20 hover:border-success hover:shadow-md transition-all px-2.5 h-7 gap-1.5 text-xs font-semibold rounded-lg shrink-0"
          >
            <GitBranch className="w-3.5 h-3.5 shrink-0" />
            Séquence
            <ChevronDown className="w-3 h-3 shrink-0 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-card w-72 z-[9999]">
          {!canSendSequences ? (
            <UpgradePrompt
              title="Séquences"
              description={SEQUENCES_PLAN_REQUIRED_MESSAGE}
              className="border-0 bg-transparent"
            />
          ) : loading && sequences.length === 0 ? (
            <div className="flex items-center justify-center py-4" role="status" aria-label="Chargement des séquences">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <div className="p-4 text-center space-y-3" role="alert">
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0" aria-hidden="true" />
                Impossible de charger les séquences
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={(e) => {
                  e.preventDefault();
                  void fetchSequences();
                }}
              >
                Réessayer
              </Button>
            </div>
          ) : sequences.length === 0 ? (
            <div className="p-4 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                {missionId
                  ? 'Aucune séquence active. Activez-en une ou créez-la depuis les séquences de la mission.'
                  : "Aucune séquence active. Activez-en une ou créez-la depuis les séquences d'une mission."}
              </p>
              {onCreateSequence ? (
                <Button variant="outline" size="sm" onClick={onCreateSequence} className="w-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Créer une séquence
                </Button>
              ) : (
                <Button variant="outline" size="sm" asChild className="w-full">
                  <Link to={missionId ? `/missions/${missionId}?tab=outreach` : '/missions'}>
                    {missionId ? 'Ouvrir les séquences de la mission' : 'Voir les missions'}
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Inscrire {count} candidat{count > 1 ? 's' : ''} dans :
              </div>
              <div className="px-2 pb-1.5">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    // Les touches restent dans le champ (sinon le menu les
                    // prend pour de la navigation par lettre).
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Rechercher une séquence"
                    aria-label="Rechercher une séquence"
                    className="h-8 pl-7 text-xs"
                  />
                </div>
              </div>
              <DropdownMenuSeparator />
              <div className="max-h-72 overflow-y-auto">
                {!hasVisible && (
                  <p className="px-2 py-3 text-xs text-muted-foreground text-center">
                    Aucune séquence ne correspond à « {search.trim()} ».
                  </p>
                )}
                {visibleSequences.mission.length > 0 && (
                  <>
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Séquences de la mission
                    </DropdownMenuLabel>
                    {visibleSequences.mission.map(renderItem)}
                  </>
                )}
                {visibleSequences.others.length > 0 && (
                  <>
                    {visibleSequences.mission.length > 0 && (
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Autres séquences
                      </DropdownMenuLabel>
                    )}
                    {visibleSequences.others.map(renderItem)}
                  </>
                )}
              </div>
              {onCreateSequence && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onCreateSequence}
                    className="cursor-pointer text-muted-foreground"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Nouvelle séquence
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Enroll Modal */}
      {selectedSequence && (
        <SequenceEnrollModal
          isOpen={showEnrollModal}
          onClose={() => {
            setShowEnrollModal(false);
            setSelectedSequence(null);
          }}
          sequence={selectedSequence}
          profiles={selectedProfiles}
          accountId={accountId}
          job={selectedJob}
          onSuccess={handleEnrollSuccess}
        />
      )}
    </>
  );
};
