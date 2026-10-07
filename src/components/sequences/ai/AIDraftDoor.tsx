// Portes de la rédaction par l'IA (lot 5e), derrière l'interrupteur
// konekt.sequences-v2. Une seule rédaction (AIDraftWizard, sur
// /sequences/nouvelle?mission=<id>&depart=ia) ; ici, les portes :
// - AIDraftChoice : « Rédiger avec l'IA à partir du poste », marquée
//   « Recommandé », dans « Nouvelle séquence » (porte 2) ;
// - MissionSequencesEmpty : état vide de l'onglet Séquences du panneau de
//   mission, « Rédiger une séquence pour cette mission » (porte 1).
// Poste non décrit (canScoreProfiles) : porte désactivée, avec « Décrivez
// d'abord le poste dans le Cadrage pour que l'IA puisse rédiger. » et
// [Décrire le poste]. Formule gratuite : portes ouvertes, dans la limite des
// crédits (décision 6) ; la séquence sera enregistrée sans envoi.
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMissionDraftReadiness } from '@/hooks/useSequenceAI';
import { newSequencePath } from '@/lib/sequencesBeta';
import { AI_DRAFT_NOT_DESCRIBED } from '@/lib/sequenceDraft';

function NotDescribed({ cadrageHref }: { cadrageHref: string | null }) {
  // Le lien sur sa propre ligne : sa cible de 44 px au doigt n'écarte pas les lignes de la phrase.
  return (
    <div className="space-y-0.5">
      <p className="text-sm text-muted-foreground">{AI_DRAFT_NOT_DESCRIBED}</p>
      {cadrageHref && (
        <Link to={cadrageHref} className="inline-flex items-center text-sm font-medium text-foreground underline underline-offset-2 hover:no-underline max-md:min-h-11">
          Décrire le poste
        </Link>
      )}
    </div>
  );
}

/** Porte 2 : premier choix de « Nouvelle séquence » quand elle vient d'une mission. */
export function AIDraftChoice({ missionId, onGo }: { missionId: string; onGo: () => void }) {
  const navigate = useNavigate();
  const { loading, described, cadrageHref } = useMissionDraftReadiness(missionId);
  const disabled = loading || !described;
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          onGo();
          navigate(newSequencePath({ kind: 'ia' }, missionId));
        }}
        className="h-auto w-full justify-start gap-4 whitespace-normal p-4 text-left font-normal"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground-secondary">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Rédiger avec l’IA à partir du poste</span>
            <Badge variant="brand">Recommandé</Badge>
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">Vous relisez chaque message avant d’inscrire.</span>
        </span>
      </Button>
      {!loading && !described && <NotDescribed cadrageHref={cadrageHref} />}
    </div>
  );
}

/**
 * Porte 1 : la mission n'a pas encore de séquence (textes de la spécification,
 * section 4). `quiet` : panneau ouvert à côté d'une page qui a déjà son bouton
 * plein, la porte passe en bouton discret.
 */
export function MissionSequencesEmpty({ missionId, onFromTemplate, quiet = false }: { missionId: string; onFromTemplate: () => void; quiet?: boolean }) {
  const navigate = useNavigate();
  const { loading, described, cadrageHref } = useMissionDraftReadiness(missionId);
  return (
    <div className="space-y-4 py-6">
      <div className="space-y-1.5">
        <h3 className="text-md font-semibold text-foreground">Cette mission n’a pas encore de séquence.</h3>
        <p className="text-sm text-foreground-secondary">
          Une séquence envoie la visite, l’invitation, le message et les relances à votre place, depuis votre compte LinkedIn, et s’arrête dès qu’un candidat répond.
        </p>
      </div>
      <div className="space-y-2">
        <Button
          type="button"
          variant={quiet ? 'outline' : 'primary'}
          disabled={loading || !described}
          onClick={() => navigate(newSequencePath({ kind: 'ia' }, missionId))}
          className="max-md:h-11"
        >
          <Sparkles aria-hidden="true" />
          Rédiger une séquence pour cette mission
        </Button>
        {!loading && !described && <NotDescribed cadrageHref={cadrageHref} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button type="button" variant="ghost" size="sm" onClick={onFromTemplate} className="-ml-3 max-md:h-11">
          Depuis un modèle
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => navigate(newSequencePath({ kind: 'zero' }, missionId))} className="max-md:h-11">
          Partir de zéro
        </Button>
      </div>
    </div>
  );
}
