import { Link } from 'react-router-dom';
import { useBaseKonektState } from '@/hooks/useBaseKonekt';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';

export type SourcingSource = 'linkedin' | 'database';
export function SourcingSourcePicker({ source, onChange, linkedinAvailable, disabled = false, preserveDraft = false, compact = false }: {
  source: SourcingSource; onChange: (source: SourcingSource) => void; linkedinAvailable: boolean; disabled?: boolean; preserveDraft?: boolean; compact?: boolean;
}) {
  const base = useBaseKonektState();
  const searchCost = base.state?.credits_per_search;
  return <section aria-label="Source de la recherche" className="space-y-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium text-foreground">Chercher dans</span>
      <SegmentedControl<SourcingSource>
        aria-label="Choisir la source" variant="quiet" value={source} onValueChange={onChange} disabled={disabled}
        options={[{ value: 'database', label: 'Base Konekt' }, { value: 'linkedin', label: 'LinkedIn', disabled: !linkedinAvailable }]} />
      {!linkedinAvailable && <Link target={preserveDraft ? '_blank' : undefined} rel={preserveDraft ? 'noopener noreferrer' : undefined} className="text-foreground underline underline-offset-4" to="/settings/account/connections">Relier LinkedIn</Link>}
    </div>
    {!compact && <p className="text-muted-foreground">{source === 'database'
      ? 'Sans compte LinkedIn : nom, poste, entreprise, lieu et lien du profil, selon les données disponibles. La fiche complète se charge à la demande.'
      : 'Recherche via votre compte et sa licence. Les informations visibles et les filtres dépendent de vos accès LinkedIn.'}</p>}
    {source === 'database' && (base.isLoading ? <p role="status" className="text-muted-foreground">Vérification de l’accès à la Base Konekt…</p>
      : base.isError || !base.state ? <p role="alert">Accès à la Base Konekt non vérifié. <Button variant="ghost" size="sm" onClick={base.refetch}>Réessayer</Button></p>
      : !base.isEnabled || !base.planAllows ? <p role="status">{!base.planAllows ? 'La Base Konekt nécessite un forfait compatible.' : 'La Base Konekt n’est pas activée pour votre organisation.'} <Link target={preserveDraft ? '_blank' : undefined} rel={preserveDraft ? 'noopener noreferrer' : undefined} className="underline underline-offset-4" to="/settings/org/billing#credits">Vérifier les accès</Link></p>
      : compact ? null : base.state.included_remaining > 0 ? <p className="text-muted-foreground">{base.state.included_remaining} recherches incluses restantes ce mois-ci.</p>
      : typeof searchCost === 'number' && Number.isFinite(searchCost) && searchCost >= 0 ? <p className="text-muted-foreground">{base.state.included_monthly > 0 ? 'Forfait inclus épuisé' : 'Recherche facturée'} : {searchCost} crédits par recherche.</p> : null)}
    <details className="text-muted-foreground">
      <summary className="cursor-pointer py-2 max-sm:min-h-11 text-foreground">Quelles différences entre les sources ?</summary>
      <div className="overflow-x-auto pb-2">
        <table className="w-full text-left text-sm">
          <thead><tr><th scope="col" className="py-2 pr-3">Informations</th><th scope="col" className="pr-3">Base Konekt</th><th scope="col">LinkedIn relié</th></tr></thead>
          <tbody>
            <tr><th scope="row" className="py-2 pr-3 font-normal">Identité, poste, entreprise, lieu</th><td className="pr-3">Dès l’aperçu, si renseignés</td><td>Selon les accès du compte</td></tr>
            <tr><th scope="row" className="py-2 pr-3 font-normal">Expériences, formations, compétences</th><td className="pr-3">Selon les données de la fiche complète à charger</td><td>Selon les données accessibles au compte</td></tr>
            <tr><th scope="row" className="py-2 pr-3 font-normal">Messages et invitations LinkedIn</th><td className="pr-3">Compte LinkedIn relié nécessaire</td><td>Selon la licence et les autorisations</td></tr>
            <tr><th scope="row" className="py-2 pr-3 font-normal">Email et téléphone</th><td colSpan={2}>Jamais garantis ; enrichissement distinct</td></tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>;
}
