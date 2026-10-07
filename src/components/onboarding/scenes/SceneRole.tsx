import React, { useId, useMemo } from 'react';
import { Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LookupState } from '@/hooks/onboarding/useCompanyLookup';
import type { OrgType } from '../onboardingMeta';
import { CompanyCard } from '../parts/CompanyCard';
import { FillIn } from '../parts/FillIn';
import { NavRow } from '../parts/NavRow';
import { SceneHeading } from '../parts/SceneHeading';

const EXAMPLE_TITLES = ['Développeur back-end senior', 'Product Manager', 'Responsable comptable', 'Commercial grands comptes', 'Data Analyst'];

interface Props {
  orgType: OrgType;
  /** Nom de la société du poste : la sienne pour une entreprise, le client sinon. */
  companyName: string;
  title: string;
  onTitleChange: (value: string) => void;
  client: string;
  onClientChange: (value: string) => void;
  /** Le client vient d'être saisi (Entrée ou sortie du champ) : on lance sa fiche. */
  onClientCommit: (client: string) => void;
  lookup: LookupState;
  onPickCandidate: (id: string) => void;
  onNoCandidate: () => void;
  onRetryLookup: () => void;
  onSubmit: () => void;
  onBack: () => void;
  /** Mission déjà créée : le poste et le client s'ajustent depuis la mission, plus ici. */
  locked?: boolean;
}

/**
 * Le premier poste. Les postes ouverts de la société arrivent en suggestions dès
 * que sa fiche est prête ; sinon, quelques exemples. Un clic remplit le champ.
 */
export const SceneRole: React.FC<Props> = ({
  orgType,
  companyName,
  title,
  onTitleChange,
  client,
  onClientChange,
  onClientCommit,
  lookup,
  onPickCandidate,
  onNoCandidate,
  onRetryLookup,
  onSubmit,
  onBack,
  locked = false,
}) => {
  const titleId = useId();
  const clientId = useId();
  const needsClient = orgType !== 'enterprise';
  const ready = title.trim().length >= 3;

  const openRoles = useMemo(() => (lookup.status === 'ready' ? lookup.company.openRoles.slice(0, 6) : []), [lookup]);
  const loadingRoles = lookup.status === 'loading';

  return (
    <div className="space-y-7">
      <SceneHeading title="Quel est votre premier poste ?">
        <p>
          {locked
            ? 'La mission est créée. Le poste et le client se modifient depuis la mission.'
            : needsClient
              ? 'Le client et l\'intitulé suffisent : Konekt en tire le brief et prépare la recherche.'
              : "L'intitulé suffit : Konekt en tire le brief et prépare la recherche."}
        </p>
      </SceneHeading>

      <div className="space-y-5">
        {needsClient && (
          <FillIn
            id={clientId}
            lead="Client (facultatif)"
            value={client}
            onChange={onClientChange}
            onSubmit={() => onClientCommit(client)}
            placeholder="Nom du client"
            maxLength={80}
            disabled={locked}
            autoFocus={!locked}
          />
        )}
        <div
          onBlurCapture={(e) => {
            // Sortie du champ client : sa fiche part en arrière-plan.
            if (needsClient && (e.target as HTMLElement).id === clientId) onClientCommit(client);
          }}
        >
          <FillIn
            id={titleId}
            lead="Poste recherché"
            value={title}
            onChange={onTitleChange}
            onSubmit={() => ready && onSubmit()}
            placeholder={`Par exemple : ${EXAMPLE_TITLES[0]}`}
            maxLength={100}
            autoFocus={!needsClient && !locked}
            disabled={locked}
          />
        </div>
      </div>

      <div className="space-y-3">
        {openRoles.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Postes ouverts chez {lookup.status === 'ready' ? lookup.company.name : companyName}
            </p>
            <div className="flex flex-wrap gap-2">
              {openRoles.map((role) => (
                <Button key={role.title} variant="ghost" size="sm" onClick={() => onTitleChange(role.title)} className="h-auto max-w-full whitespace-normal rounded-lg border border-border hover:border-foreground py-1.5 text-left">
                  <Briefcase aria-hidden="true" />
                  <span className="min-w-0 truncate">{role.title}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : loadingRoles ? (
          <p className="text-xs text-muted-foreground">
            Recherche des postes ouverts chez {lookup.name}… Les suggestions apparaîtront ici.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Pas d'idée ? Essayez :</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_TITLES.slice(0, 4).map((example) => (
                <Button key={example} variant="outline" size="sm" onClick={() => onTitleChange(example)}>
                  {example}
                </Button>
              ))}
            </div>
          </div>
        )}

        <CompanyCard lookup={lookup} onPick={onPickCandidate} onNone={onNoCandidate} onRetry={onRetryLookup} />
      </div>

      <NavRow onBack={onBack} onNext={onSubmit} nextDisabled={!ready} nextLabel={locked ? 'Continuer' : 'Lire le poste'} />
    </div>
  );
};
