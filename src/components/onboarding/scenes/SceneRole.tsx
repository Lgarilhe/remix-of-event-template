import React, { useId, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LookupState } from '@/hooks/onboarding/useCompanyLookup';
import type { OrgType } from '../onboardingMeta';
import { CompanyCard } from '../parts/CompanyCard';
import { FillIn } from '../parts/FillIn';
import { NavRow } from '../parts/NavRow';
import { SceneHeading } from '../parts/SceneHeading';
import { SPRING_SOFT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';

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
  const d = useDelay();
  const needsClient = orgType !== 'enterprise';
  const ready = title.trim().length >= 3;

  const openRoles = useMemo(() => (lookup.status === 'ready' ? lookup.company.openRoles.slice(0, 6) : []), [lookup]);
  const loadingRoles = lookup.status === 'loading';

  return (
    <div className="space-y-7">
      <SceneHeading eyebrow="Votre poste" title="Quel est votre premier poste ?" accent={['premier']}>
        <p>
          {locked
            ? 'La mission est créée. Le poste et le client se modifient depuis la mission.'
            : needsClient
              ? 'Le client et l\'intitulé suffisent : Konekt en tire le brief et prépare la recherche.'
              : "L'intitulé suffit : Konekt en tire le brief et prépare la recherche."}
        </p>
      </SceneHeading>

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SOFT, delay: d(0.55) }} className="space-y-5">
        {needsClient && (
          <FillIn
            id={clientId}
            lead="Pour le client"
            label="nom du client, facultatif"
            value={client}
            onChange={onClientChange}
            onSubmit={() => onClientCommit(client)}
            placeholder="facultatif"
            maxLength={80}
            size="md"
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
            lead="Je cherche"
            label="intitulé du poste"
            value={title}
            onChange={onTitleChange}
            onSubmit={() => ready && onSubmit()}
            placeholder="intitulé du poste"
            examples={EXAMPLE_TITLES}
            maxLength={100}
            autoFocus={!needsClient && !locked}
            size="md"
            disabled={locked}
          />
        </div>
      </motion.div>

      <div className="space-y-3">
        <AnimatePresence mode="wait">
          {openRoles.length > 0 ? (
            <motion.div key="roles" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING_SOFT} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Postes ouverts chez {lookup.status === 'ready' ? lookup.company.name : companyName}
              </p>
              <div className="flex flex-wrap gap-2">
                {openRoles.map((role, i) => (
                  <motion.span key={role.title} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...SPRING_SOFT, delay: d(i * 0.05) }}>
                    <Button variant="outline" size="sm" onClick={() => onTitleChange(role.title)} className="h-auto max-w-full whitespace-normal py-1.5 text-left">
                      <Briefcase aria-hidden="true" />
                      <span className="min-w-0 truncate">{role.title}</span>
                    </Button>
                  </motion.span>
                ))}
              </div>
            </motion.div>
          ) : loadingRoles ? (
            <motion.p key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-muted-foreground">
              Recherche des postes ouverts chez {lookup.name}… Les suggestions apparaîtront ici.
            </motion.p>
          ) : (
            <motion.div key="examples" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Pas d'idée ? Essayez :</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_TITLES.slice(0, 4).map((example) => (
                  <Button key={example} variant="outline" size="sm" onClick={() => onTitleChange(example)}>
                    {example}
                  </Button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <CompanyCard lookup={lookup} onPick={onPickCandidate} onNone={onNoCandidate} onRetry={onRetryLookup} />
      </div>

      <NavRow onBack={onBack} onNext={onSubmit} nextDisabled={!ready} nextLabel={locked ? 'Continuer' : 'Lire le poste'} />
    </div>
  );
};
