import { Link } from 'react-router-dom';
import { useBaseKonektState } from '@/hooks/useBaseKonekt';
import { Button } from '@/components/ui/button';

export type SourcingSource = 'linkedin' | 'database';
export function SourcingSourcePicker({ source, onChange, linkedinAvailable, disabled = false, preserveDraft = false, compact = false }: {
  source: SourcingSource; onChange: (source: SourcingSource) => void; linkedinAvailable: boolean; disabled?: boolean; preserveDraft?: boolean; compact?: boolean;
}) {
  const base = useBaseKonektState();
  return <section aria-label="Source de la recherche" className="space-y-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium text-foreground">Chercher dans</span>
      <div role="group" aria-label="Choisir la source" className="flex rounded-lg bg-muted p-1">
        {([['database', 'Base Konekt'], ['linkedin', 'LinkedIn']] as const).map(([value, label]) =>
          <Button key={value} type="button" size="sm" variant="ghost" aria-pressed={source === value}
            disabled={disabled || (value === 'linkedin' && !linkedinAvailable)}
            onClick={() => onChange(value)} className={`max-sm:min-h-11 ${source === value ? 'bg-card shadow-sm' : ''}`}>{label}</Button>)}
      </div>
      {!linkedinAvailable && <Link target={preserveDraft ? '_blank' : undefined} rel={preserveDraft ? 'noopener noreferrer' : undefined} className="text-foreground underline underline-offset-4" to="/settings/account/connections">Relier LinkedIn</Link>}
    </div>
    {!compact && <p className="text-muted-foreground">{source === 'database'
      ? 'Sans compte LinkedIn : nom, poste, entreprise, lieu et lien du profil, selon les données disponibles. La fiche complète et la notation peuvent consommer des crédits.'
      : 'Recherche via votre compte et sa licence. Les informations visibles et les filtres dépendent de vos accès LinkedIn.'}</p>}
    {source === 'database' && (base.isLoading ? <p role="status" className="text-muted-foreground">Vérification de l’accès à la Base Konekt…</p>
      : base.isError ? <p role="alert">Accès à la Base Konekt non vérifié. <Button variant="ghost" size="sm" onClick={base.refetch}>Réessayer</Button></p>
      : !base.isEnabled ? <p role="status">La Base Konekt doit être activée sur un forfait compatible. <Link target={preserveDraft ? '_blank' : undefined} rel={preserveDraft ? 'noopener noreferrer' : undefined} className="underline underline-offset-4" to="/settings/org/billing#credits">Vérifier les accès</Link></p>
      : compact ? null : <p className="text-muted-foreground">{base.includedRemaining > 0 ? `${base.includedRemaining} recherches incluses restantes ce mois-ci.` : `${base.includedMonthly > 0 ? 'Forfait inclus épuisé' : 'Recherche facturée'} : ${base.state?.credits_per_search ?? 2} crédits par recherche.`}</p>)}
    <details className="text-muted-foreground">
      <summary className="min-h-11 cursor-pointer content-center text-foreground">Quelles différences entre les sources ?</summary>
      <div className="overflow-x-auto pb-2">
        <table className="w-full text-left text-sm">
          <thead><tr><th scope="col" className="py-2 pr-3">Informations</th><th scope="col" className="pr-3">Base Konekt</th><th scope="col">LinkedIn relié</th></tr></thead>
          <tbody>
            <tr><th scope="row" className="py-2 pr-3 font-normal">Identité, poste, entreprise, lieu</th><td className="pr-3">Dès l’aperçu, si renseignés</td><td>Selon les accès du compte</td></tr>
            <tr><th scope="row" className="py-2 pr-3 font-normal">Expériences, formations, compétences</th><td className="pr-3">Fiche complète à charger ; compétences parfois déduites</td><td>Profil à ouvrir ; selon sa visibilité</td></tr>
            <tr><th scope="row" className="py-2 pr-3 font-normal">Fraîcheur</th><td className="pr-3">Dernière collecte disponible</td><td>Données renvoyées au moment de l’appel</td></tr>
            <tr><th scope="row" className="py-2 pr-3 font-normal">Messages, invitations, réseau, à l’écoute</th><td className="pr-3">Indisponibles sans compte relié</td><td>Selon la licence et les autorisations</td></tr>
            <tr><th scope="row" className="py-2 pr-3 font-normal">Email et téléphone</th><td colSpan={2}>Jamais garantis ; enrichissement distinct</td></tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>;
}
