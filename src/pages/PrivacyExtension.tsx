import { Link } from 'react-router-dom';
import { Clock, Cookie, Database, Globe, Key, Lock, Mail, Shield, UserX } from 'lucide-react';
import { LegalPage, type LegalSection } from '@/components/public/LegalPage';
import { PRIVACY_CONTACT_EMAIL, legalLinkClass } from '@/components/public/legal';
import { withPreviewAccessToken } from '@/lib/previewToken';

/**
 * Politique de confidentialité propre à l'extension Chrome Konekt.
 * Hébergée sur konekt-app-navy.vercel.app/privacy-extension pour satisfaire
 * l'exigence du Chrome Web Store (adresse publique accessible pour la revue).
 */

const code = 'rounded-sm bg-muted px-1 text-xs text-foreground';

const ContactLink = () => (
  <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className={legalLinkClass}>
    {PRIVACY_CONTACT_EMAIL}
  </a>
);

const ConnectionsLink = () => (
  <Link to="/settings/account/connections#extension" className={legalLinkClass}>
    Paramètres → Connexions
  </Link>
);

const SECTIONS: LegalSection[] = [
  {
    id: 'cookie-linkedin',
    title: 'Cookie LinkedIn (li_at, li_a)',
    icon: Cookie,
    children: (
      <>
        <p>
          <strong className="text-foreground">Quand</strong> : uniquement lorsque vous cliquez sur «&nbsp;Reconnecter mon compte LinkedIn&nbsp;»
          dans la fenêtre de l'extension.
        </p>
        <p>
          <strong className="text-foreground">Comment</strong> : l'extension utilise l'API <code className={code}>chrome.cookies.get</code>{' '}
          pour lire les cookies <code className={code}>li_at</code> (session LinkedIn) et <code className={code}>li_a</code> (Sales
          Navigator) sur le domaine <code className={code}>linkedin.com</code>.
        </p>
        <p>
          <strong className="text-foreground">Pourquoi</strong> : ces cookies permettent à l'infrastructure Konekt (via le partenaire
          Unipile) de maintenir une session LinkedIn active au nom de l'utilisateur, pour envoyer des messages et effectuer des recherches
          depuis Konekt.
        </p>
        <p className="font-semibold text-foreground">
          Stockage : aucun. Les cookies sont lus au moment du clic et envoyés directement à l'API Konekt. L'extension ne les stocke jamais.
        </p>
      </>
    ),
  },
  {
    id: 'adresses-profils',
    title: 'Adresses des profils LinkedIn visités',
    icon: Globe,
    children: (
      <>
        <p>
          <strong className="text-foreground">Quand</strong> : lorsque vous naviguez sur <code className={code}>linkedin.com/in/*</code>,{' '}
          <code className={code}>linkedin.com/search/*</code> ou <code className={code}>linkedin.com/recruiter/*</code>.
        </p>
        <p>
          <strong className="text-foreground">Pourquoi</strong> : afficher la mention «&nbsp;Déjà en pipeline Konekt&nbsp;» sur les résultats de
          recherche LinkedIn, pour éviter les doublons.
        </p>
        <p>
          <strong className="text-foreground">Stockage</strong> : cache en mémoire du service worker (5 minutes, vidé au redémarrage de
          Chrome). Les adresses sont aussi enregistrées par Konekt dans la table <code className={code}>job_candidate_status</code> si vous
          avez explicitement ajouté le candidat au pipeline d'un clic.
        </p>
      </>
    ),
  },
  {
    id: 'jeton-api',
    title: "Jeton d'API Konekt",
    icon: Key,
    children: (
      <>
        <p>
          <strong className="text-foreground">Quand</strong> : vous collez une fois le jeton généré depuis les paramètres de Konekt (
          <ConnectionsLink />
          ).
        </p>
        <p>
          <strong className="text-foreground">Stockage</strong> : <code className={code}>chrome.storage.local</code> (espace isolé de
          l'extension, inaccessible aux pages web). Le jeton transite dans l'en-tête{' '}
          <code className={code}>X-Konekt-Extension-Token</code>, uniquement vers l'API Konekt, en HTTPS.
        </p>
      </>
    ),
  },
  {
    id: 'non-collectees',
    title: 'Données non collectées',
    icon: UserX,
    children: (
      <ul className="list-disc space-y-1 pl-5">
        <li>Aucune donnée LinkedIn en dehors de celles affichées sur la page où vous cliquez sur «&nbsp;Ajouter&nbsp;» (nom, titre, adresse publique)</li>
        <li>Aucune donnée de navigation en dehors de linkedin.com</li>
        <li>Aucune donnée personnelle (mot de passe, e-mail hors Konekt, coordonnées bancaires, etc.)</li>
        <li>Aucune télémétrie envoyée à un tiers (ni Google Analytics, ni Sentry dans l'extension)</li>
        <li>Aucune donnée de santé, de géolocalisation ni information sensible</li>
      </ul>
    ),
  },
  {
    id: 'destinataires',
    title: 'Destinataires des données',
    icon: Database,
    children: (
      <>
        <p>Toutes les données collectées sont envoyées <strong className="text-foreground">exclusivement</strong> à :</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Le <strong className="text-foreground">serveur de Konekt</strong> (hébergé chez Supabase, dans l'Union européenne, en Irlande)</li>
          <li>
            Indirectement via Konekt : <strong className="text-foreground">Unipile</strong> (partenaire LinkedIn, uniquement lors de la
            reconnexion LinkedIn), conformément à sa politique :{' '}
            <a href="https://www.unipile.com/privacy" target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
              unipile.com/privacy
            </a>
          </li>
        </ul>
        <p className="font-semibold text-foreground">
          Aucune donnée n'est vendue ni partagée avec des tiers publicitaires, des courtiers en données ou toute autre entité que celles
          nécessaires au service.
        </p>
      </>
    ),
  },
  {
    id: 'securite',
    title: 'Sécurité',
    icon: Lock,
    children: (
      <ul className="list-disc space-y-1 pl-5">
        <li>HTTPS pour toutes les communications entre l'extension et le serveur de Konekt</li>
        <li>Jeton haché en SHA-256 dans la base (Konekt ne conserve jamais le jeton en clair)</li>
        <li>
          Permissions Chrome minimales : <code className={code}>cookies</code> limité à linkedin.com, <code className={code}>storage</code>,{' '}
          <code className={code}>activeTab</code>, <code className={code}>scripting</code>
        </li>
        <li>
          Espace isolé de l'extension : jeton et préférences dans <code className={code}>chrome.storage.local</code>, hors de portée des
          pages web visitées
        </li>
      </ul>
    ),
  },
  {
    id: 'conservation',
    title: 'Durée de conservation',
    icon: Clock,
    children: (
      <ul className="list-disc space-y-1 pl-5">
        <li><strong className="text-foreground">Jeton d'API dans l'extension</strong> : conservé jusqu'à la désinstallation ou à sa révocation</li>
        <li><strong className="text-foreground">Cache des statuts de pipeline</strong> : 5 minutes en mémoire, vidé au redémarrage de Chrome</li>
        <li><strong className="text-foreground">Cookie LinkedIn</strong> : jamais stocké par l'extension (transmis au moment du clic)</li>
      </ul>
    ),
  },
  {
    id: 'droits',
    title: 'Droits RGPD',
    icon: Shield,
    children: (
      <>
        <p>Conformément au RGPD (règlement UE 2016/679) :</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-foreground">Droit d'accès</strong> : consultez vos données dans Konekt (
            <Link to={withPreviewAccessToken('/settings')} className={legalLinkClass}>Paramètres</Link>)
          </li>
          <li><strong className="text-foreground">Droit de rectification</strong> : modifiez vos données depuis l'application Konekt</li>
          <li><strong className="text-foreground">Droit à l'effacement</strong> : écrivez à <ContactLink /></li>
          <li>
            <strong className="text-foreground">Droit de révocation</strong> : révoquez les jetons de l'extension à tout moment depuis{' '}
            <ConnectionsLink />
          </li>
          <li>
            <strong className="text-foreground">Droit d'opposition</strong> : désinstallez l'extension à tout moment (le jeton local est
            supprimé)
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    icon: Mail,
    children: (
      <>
        <p>
          Pour toute question sur cette politique ou pour exercer vos droits, écrivez à <ContactLink />.
        </p>
        <p>
          Cette extension est éditée par <strong className="text-foreground">Konekt</strong> (France). Toute contestation relève du droit
          français et des tribunaux de Paris.
        </p>
        <p>
          Voir aussi la{' '}
          <Link to={withPreviewAccessToken('/privacy')} className={legalLinkClass}>
            politique de confidentialité de Konekt
          </Link>{' '}
          et la{' '}
          <a href="https://www.unipile.com/privacy" target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
            politique de confidentialité d'Unipile
          </a>
          .
        </p>
      </>
    ),
  },
];

export default function PrivacyExtensionPage() {
  return (
    <LegalPage
      seo={{
        title: "Confidentialité de l'extension Chrome",
        description: "Quelles données l'extension Chrome Konekt collecte, pourquoi, et comment elles sont utilisées. RGPD, transparence totale.",
      }}
      title="Confidentialité de l'extension Chrome"
      intro={
        <p>
          Cette politique concerne l'<strong className="text-foreground">extension Chrome Konekt</strong>, complément de l'application web
          Konekt. Elle détaille les données collectées par l'extension, leur traitement et vos droits.
        </p>
      }
      updatedAt="23 avril 2026"
      sections={SECTIONS}
      related={{ label: 'Politique générale', to: withPreviewAccessToken('/privacy') }}
    />
  );
}
