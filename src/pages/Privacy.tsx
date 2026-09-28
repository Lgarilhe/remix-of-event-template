import { Link } from 'react-router-dom';
import { Brain, Clock, Cookie, Database, Globe, Landmark, Lock, Shield, UserX } from 'lucide-react';
import { LegalPage, type LegalSection } from '@/components/public/LegalPage';
import { PRIVACY_CONTACT_EMAIL, legalLinkClass } from '@/components/public/legal';
import { withPreviewAccessToken } from '@/lib/previewToken';

const ContactLink = () => (
  <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className={legalLinkClass}>
    {PRIVACY_CONTACT_EMAIL}
  </a>
);

const tableClass = 'w-full text-sm';
const thClass = 'p-2.5 text-left text-xs font-semibold text-foreground';
const tdClass = 'p-2.5 align-top';

const SUBPROCESSORS = [
  { name: 'Supabase (AWS)', data: "Toutes les données de l'application", location: 'UE (Irlande)' },
  { name: 'Anthropic', data: "Profils transmis à l'IA", location: 'États-Unis (DPF)' },
  { name: 'Google AI', data: "Profils transmis à l'IA", location: 'États-Unis (DPF)' },
  { name: 'Deepgram', data: 'Audio du coaching en direct', location: 'États-Unis (DPF + CCT)' },
  { name: 'Unipile', data: 'Messages LinkedIn et e-mails', location: 'France' },
  { name: 'Coresignal', data: 'Profils professionnels publics (Base Konekt)', location: 'Lituanie (UE)' },
  { name: 'BetterContact', data: 'Coordonnées professionnelles (enrichissement)', location: 'France' },
  { name: 'Resend', data: 'E-mails transactionnels', location: 'États-Unis (DPF + CCT)' },
  { name: 'Stripe', data: 'Facturation', location: 'États-Unis (DPF + CCT)' },
];

const RETENTION = [
  { data: 'Candidats sans activité', duration: '24 mois', action: 'Purge automatique' },
  { data: 'Candidats refusés', duration: '12 mois', action: 'Purge automatique' },
  { data: 'Messages de prospection', duration: '24 mois', action: 'Archivage puis purge' },
  { data: 'Audio du coaching', duration: '6 mois', action: 'Suppression (transcription conservée)' },
  { data: 'Facturation', duration: '10 ans', action: 'Obligation légale' },
];

const SECTIONS: LegalSection[] = [
  {
    id: 'responsable',
    title: '1. Responsable de traitement',
    icon: Shield,
    children: (
      <>
        <p>
          <strong className="text-foreground">Konekt Services SAS</strong> est sous-traitant (article 28 du RGPD) pour les données des
          candidats traitées pour le compte de ses clients (cabinets de recrutement, entreprises, indépendants).
        </p>
        <p>Konekt est responsable de traitement pour ses propres données : comptes utilisateurs, facturation, statistiques d'usage.</p>
        <p>
          Contact du délégué à la protection des données : <ContactLink />
        </p>
      </>
    ),
  },
  {
    id: 'donnees',
    title: '2. Données collectées et traitées',
    icon: Database,
    children: (
      <>
        <p><strong className="text-foreground">Données des candidats</strong> (traitées pour le compte du client) :</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Identité professionnelle : nom, prénom, titre, entreprise actuelle</li>
          <li>Coordonnées professionnelles : profil LinkedIn, e-mail professionnel</li>
          <li>Parcours : expériences, formations, compétences, certifications</li>
          <li>Scores et évaluations de l'IA : score de correspondance, analyses de profil</li>
          <li>Communications : messages LinkedIn envoyés et reçus via la plateforme</li>
          <li>Enregistrements audio : coaching en direct (transcription et audio temporaire)</li>
        </ul>
        <p><strong className="text-foreground">Données des utilisateurs</strong> (clients de Konekt) :</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Compte : nom, e-mail, organisation, rôle</li>
          <li>Facturation : gérée par Stripe (Konekt ne stocke pas les données de carte)</li>
          <li>Usage : crédits IA consommés, actions effectuées, modèles utilisés</li>
        </ul>
      </>
    ),
  },
  {
    id: 'score-ia',
    title: "3. Score de l'IA : traitement automatisé",
    icon: Brain,
    children: (
      <>
        <p>
          Konekt utilise l'intelligence artificielle pour évaluer la correspondance entre un profil candidat et un poste. Ce score est
          un <strong className="text-foreground">outil d'aide à la décision</strong>, pas une décision automatisée au sens de l'article 22
          du RGPD.
        </p>
        <p><strong className="text-foreground">Comment le score est établi :</strong></p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Analyse des compétences techniques (compétences déclarées, expériences)</li>
          <li>Évaluation de la séniorité et de la cohérence du parcours</li>
          <li>Correspondance avec les critères du poste (indispensables, souhaitables)</li>
          <li>Score global de 0 à 100, avec une recommandation (retenir, à étudier, écarter)</li>
        </ul>
        <p><strong className="text-foreground">Garanties :</strong></p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Le score de l'IA n'est <strong className="text-foreground">jamais le seul critère de décision</strong> : un recruteur valide
            toujours avant de contacter un candidat
          </li>
          <li>
            Le score n'utilise <strong className="text-foreground">aucun critère discriminant</strong> (âge, genre, origine, handicap, etc.)
          </li>
          <li>Les candidats peuvent exercer leur <strong className="text-foreground">droit d'opposition au score de l'IA</strong></li>
          <li>
            Les données de profil envoyées à l'IA ne sont <strong className="text-foreground">pas conservées par le fournisseur</strong> pour
            l'entraînement de ses modèles (option de refus de l'API)
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'sous-traitants',
    title: '4. Sous-traitants ultérieurs',
    icon: Globe,
    children: (
      <>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className={tableClass}>
            <thead className="bg-muted/50">
              <tr className="border-b border-border">
                <th scope="col" className={thClass}>Sous-traitant</th>
                <th scope="col" className={thClass}>Données</th>
                <th scope="col" className={thClass}>Localisation</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((row) => (
                <tr key={row.name} className="border-b border-border last:border-b-0">
                  <td className={`${tdClass} font-medium text-foreground`}>{row.name}</td>
                  <td className={tdClass}>{row.data}</td>
                  <td className={tdClass}>{row.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          DPF : Data Privacy Framework (cadre UE et États-Unis). CCT : clauses contractuelles types. Les fournisseurs d'IA (Anthropic,
          Google) ne conservent pas les données des appels d'API pour l'entraînement de leurs modèles.
        </p>
      </>
    ),
  },
  {
    id: 'conservation',
    title: '5. Durées de conservation',
    icon: Clock,
    children: (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className={tableClass}>
          <thead className="bg-muted/50">
            <tr className="border-b border-border">
              <th scope="col" className={thClass}>Données</th>
              <th scope="col" className={thClass}>Durée</th>
              <th scope="col" className={thClass}>Action</th>
            </tr>
          </thead>
          <tbody>
            {RETENTION.map((row) => (
              <tr key={row.data} className="border-b border-border last:border-b-0">
                <td className={`${tdClass} font-medium text-foreground`}>{row.data}</td>
                <td className={tdClass}>{row.duration}</td>
                <td className={tdClass}>{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: 'droits',
    title: '6. Vos droits',
    icon: UserX,
    children: (
      <>
        <p>Conformément au RGPD, vous disposez des droits suivants :</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="text-foreground">Droit d'accès</strong> : obtenir une copie de vos données personnelles</li>
          <li><strong className="text-foreground">Droit de rectification</strong> : corriger des données inexactes</li>
          <li><strong className="text-foreground">Droit à l'effacement</strong> : demander la suppression de vos données</li>
          <li>
            <strong className="text-foreground">Droit d'opposition au score de l'IA</strong> : demander que votre profil ne soit plus évalué
            par l'IA
          </li>
          <li><strong className="text-foreground">Droit à la portabilité</strong> : recevoir vos données dans un format structuré</li>
          <li><strong className="text-foreground">Droit de réclamation</strong> : saisir la CNIL (cnil.fr)</li>
        </ul>
        <p>
          Pour exercer vos droits, écrivez-nous à <ContactLink />. Nous répondons sous 30 jours.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: '7. Cookies et traceurs',
    icon: Cookie,
    children: (
      <p>
        Konekt utilise uniquement des cookies <strong className="text-foreground">strictement nécessaires</strong> au fonctionnement de
        l'application (authentification, session, préférences). Aucun cookie publicitaire ni traceur tiers n'est utilisé.
      </p>
    ),
  },
  {
    id: 'securite',
    title: '8. Mesures de sécurité',
    icon: Lock,
    children: (
      <ul className="list-disc space-y-1 pl-5">
        <li>Chiffrement des données en transit (TLS) et au repos</li>
        <li>Sécurité au niveau des lignes (Row Level Security) sur toutes les tables Supabase</li>
        <li>Authentification par jeton, avec vérification de l'appartenance à l'organisation</li>
        <li>Clés d'API conservées côté serveur, jamais exposées dans le navigateur</li>
        <li>Limitation du nombre de requêtes sur toutes les fonctions serveur</li>
        <li>Suivi des erreurs via Sentry</li>
      </ul>
    ),
  },
  {
    id: 'mentions-legales',
    title: '9. Mentions légales',
    icon: Landmark,
    children: (
      <>
        <p>
          <strong className="text-foreground">Éditeur :</strong> Konekt Services SAS, société par actions simplifiée (France). Contact :{' '}
          <ContactLink />.
        </p>
        <p>
          <strong className="text-foreground">Hébergement :</strong> application servie par Vercel Inc. (États-Unis) ; données hébergées par
          Supabase sur Amazon Web Services, région Irlande (Union européenne).
        </p>
        <p>
          Cette politique peut être mise à jour ; la date de dernière modification figure en haut de page. Pour l'extension Chrome, voir
          aussi la{' '}
          <Link to={withPreviewAccessToken('/privacy-extension')} className={legalLinkClass}>
            confidentialité de l'extension Chrome
          </Link>
          .
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      seo={{
        title: 'Politique de confidentialité',
        description: 'Politique de confidentialité et RGPD de Konekt. Traitement des données personnelles, score de l’IA, droits des personnes.',
      }}
      title="Politique de confidentialité"
      intro={<p>Konekt Services SAS, plateforme de recrutement assisté par intelligence artificielle.</p>}
      updatedAt="mars 2026"
      sections={SECTIONS}
      related={{ label: "Extension Chrome", to: withPreviewAccessToken('/privacy-extension') }}
    />
  );
}
