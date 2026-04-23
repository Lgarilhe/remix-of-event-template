import { SEOHead } from '@/components/SEOHead';
import { Link } from 'react-router-dom';
import { Puzzle, Shield, Mail, Database, Lock, Clock, UserX, Cookie, ArrowLeft, Key, Globe } from 'lucide-react';

/**
 * Page privacy policy dédiée à l'extension Chrome Konekt.
 * Hébergée sur konekt-app-navy.vercel.app/privacy-extension pour satisfaire
 * l'exigence Chrome Web Store (URL publique accessible pour la review).
 */

const Section = ({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) => (
  <section className="space-y-3">
    <h2 className="flex items-center gap-2 text-lg font-bold uppercase tracking-wider text-foreground">
      <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
      {title}
    </h2>
    <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
      {children}
    </div>
  </section>
);

export default function PrivacyExtensionPage() {
  return (
    <>
      <SEOHead
        title="Politique de confidentialité — Extension Chrome Konekt"
        description="Quelles données l'extension Chrome Konekt collecte, pourquoi, et comment elles sont utilisées. RGPD, transparence totale."
      />
      <div className="min-h-screen bg-background text-foreground">
        {/* Header */}
        <header className="border-b-2 border-border">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link to="/" className="text-sm font-bold uppercase tracking-wider hover:text-muted-foreground transition-colors flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Konekt
            </Link>
            <Link to="/privacy" className="text-xs text-muted-foreground hover:text-foreground">
              Privacy général →
            </Link>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-6 py-12 space-y-10">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Puzzle className="w-8 h-8" aria-hidden="true" />
              <h1 className="text-3xl font-bold tracking-tight">Privacy — Extension Chrome</h1>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Cette politique concerne spécifiquement l'<strong>extension Chrome Konekt</strong>, complément de l'application web Konekt. Elle explique en détail quelles données sont collectées par l'extension, comment elles sont traitées, et vos droits.
            </p>
            <p className="text-xs text-muted-foreground">
              Dernière mise à jour : 2026-04-23 · Contact : <a href="mailto:l.garilhe@konekt.fr" className="text-info underline">l.garilhe@konekt.fr</a>
            </p>
          </div>

          <Section icon={Cookie} title="Cookie LinkedIn (li_at, li_a)">
            <p>
              <strong>Quand</strong> : uniquement lorsque vous cliquez explicitement sur "Reconnecter mon compte LinkedIn" dans la popup de l'extension.
            </p>
            <p>
              <strong>Comment</strong> : l'extension utilise l'API <code className="text-xs bg-muted px-1">chrome.cookies.get</code> pour lire les cookies <code className="text-xs bg-muted px-1">li_at</code> (session LinkedIn) et <code className="text-xs bg-muted px-1">li_a</code> (Sales Navigator) depuis le domaine <code className="text-xs bg-muted px-1">linkedin.com</code>.
            </p>
            <p>
              <strong>Pourquoi</strong> : ces cookies permettent à l'infrastructure Konekt (via le partenaire Unipile) de maintenir une session LinkedIn active au nom de l'utilisateur pour envoyer des messages et effectuer des recherches depuis Konekt.
            </p>
            <p className="font-semibold text-foreground">
              Stockage : <strong>aucun</strong>. Les cookies sont lus à la volée au moment du clic et envoyés directement à l'API Konekt. L'extension ne les stocke jamais.
            </p>
          </Section>

          <Section icon={Globe} title="URLs de profils LinkedIn visités">
            <p>
              <strong>Quand</strong> : lorsque vous naviguez sur <code className="text-xs bg-muted px-1">linkedin.com/in/*</code>, <code className="text-xs bg-muted px-1">linkedin.com/search/*</code> ou <code className="text-xs bg-muted px-1">linkedin.com/recruiter/*</code>.
            </p>
            <p>
              <strong>Pourquoi</strong> : afficher les badges "Déjà en pipeline Konekt" sur les cards de résultats de recherche LinkedIn (feature d'anti-doublon).
            </p>
            <p>
              <strong>Stockage</strong> : cache mémoire côté service worker (5 minutes TTL, vidé au redémarrage de Chrome). Les URLs sont aussi stockées côté backend Konekt dans la table <code className="text-xs bg-muted px-1">job_candidate_status</code> si vous avez explicitement ajouté le candidat au pipeline via un clic.
            </p>
          </Section>

          <Section icon={Key} title="Token API Konekt">
            <p>
              <strong>Quand</strong> : vous collez une fois votre token généré depuis les paramètres Konekt (<Link to="/settings?tab=account" className="text-info underline">Paramètres → Mon compte</Link>).
            </p>
            <p>
              <strong>Stockage</strong> : <code className="text-xs bg-muted px-1">chrome.storage.local</code> (sandbox isolé de l'extension, non accessible aux pages web). Le token transite en header <code className="text-xs bg-muted px-1">X-Konekt-Extension-Token</code> uniquement vers l'API Konekt, via HTTPS.
            </p>
          </Section>

          <Section icon={UserX} title="Données PAS collectées">
            <ul className="list-disc ml-6 space-y-1">
              <li>❌ Aucune donnée LinkedIn hors celles affichées sur la page où vous cliquez "Ajouter" (nom, headline, URL publique)</li>
              <li>❌ Aucune donnée de navigation hors de linkedin.com</li>
              <li>❌ Aucune donnée personnelle (mot de passe, email hors Konekt, coordonnées bancaires, etc.)</li>
              <li>❌ Aucune télémétrie anonymisée envoyée à un tiers (ni Google Analytics, ni Sentry côté extension)</li>
              <li>❌ Aucune donnée de santé, géolocalisation, information sensible</li>
            </ul>
          </Section>

          <Section icon={Database} title="Destinataires des données">
            <p>Toutes les données collectées sont envoyées <strong>exclusivement</strong> à :</p>
            <ul className="list-disc ml-6 space-y-1">
              <li>Le <strong>backend Konekt</strong> (hébergé chez Supabase, projet EU Ireland)</li>
              <li>Indirectement via Konekt : <strong>Unipile</strong> (partenaire LinkedIn, uniquement lors du "Reconnect LinkedIn"), conformément à leur politique : <a href="https://www.unipile.com/privacy" target="_blank" rel="noopener noreferrer" className="text-info underline">unipile.com/privacy</a></li>
            </ul>
            <p className="font-semibold text-foreground">
              Aucune donnée n'est vendue ni partagée avec des tiers publicitaires, data brokers ou toute autre entité que celles nécessaires au service.
            </p>
          </Section>

          <Section icon={Lock} title="Sécurité">
            <ul className="list-disc ml-6 space-y-1">
              <li>HTTPS pour toutes les communications extension → backend Konekt</li>
              <li>Token hashé SHA-256 côté base (le clair n'est jamais stocké par Konekt)</li>
              <li>Permissions Chrome minimales : <code className="text-xs bg-muted px-1">cookies</code> scopé à linkedin.com uniquement, <code className="text-xs bg-muted px-1">storage</code>, <code className="text-xs bg-muted px-1">activeTab</code>, <code className="text-xs bg-muted px-1">scripting</code></li>
              <li>Sandbox d'extension : token et préférences dans <code className="text-xs bg-muted px-1">chrome.storage.local</code>, isolés des pages web visitées</li>
            </ul>
          </Section>

          <Section icon={Clock} title="Durée de conservation">
            <ul className="list-disc ml-6 space-y-1">
              <li><strong>Token API côté extension</strong> : conservé jusqu'à désinstallation ou révocation manuelle</li>
              <li><strong>Cache pipeline status</strong> : 5 minutes en mémoire service worker, vidé au redémarrage Chrome</li>
              <li><strong>Cookie LinkedIn</strong> : jamais stocké par l'extension (transmis à la volée)</li>
            </ul>
          </Section>

          <Section icon={Shield} title="Droits RGPD">
            <p>Conformément au RGPD (règlement UE 2016/679) :</p>
            <ul className="list-disc ml-6 space-y-1">
              <li><strong>Droit d'accès</strong> : voir toutes vos données dans Konekt (<Link to="/settings" className="text-info underline">Paramètres</Link>)</li>
              <li><strong>Droit de rectification</strong> : modifier vos données depuis l'app Konekt</li>
              <li><strong>Droit à l'effacement</strong> : contactez <a href="mailto:l.garilhe@konekt.fr" className="text-info underline">l.garilhe@konekt.fr</a></li>
              <li><strong>Droit de révocation</strong> : révoquez les tokens extension à tout moment depuis <Link to="/settings?tab=account" className="text-info underline">Paramètres → Mon compte</Link></li>
              <li><strong>Droit d'opposition</strong> : désinstallez l'extension à tout moment (suppression automatique du token local)</li>
            </ul>
          </Section>

          <Section icon={Mail} title="Contact">
            <p>
              Pour toute question relative à cette politique ou pour exercer vos droits, contactez <a href="mailto:l.garilhe@konekt.fr" className="text-info underline font-medium">l.garilhe@konekt.fr</a>.
            </p>
            <p>
              Cette extension est éditée par <strong>Konekt</strong> (France). Toute contestation est régie par le droit français, juridiction des tribunaux de Paris.
            </p>
          </Section>

          <div className="border-t border-border pt-6 text-xs text-muted-foreground">
            <p>Voir aussi : <Link to="/privacy" className="text-info underline">Politique générale Konekt</Link> · <a href="https://www.unipile.com/privacy" target="_blank" rel="noopener noreferrer" className="text-info underline">Privacy Unipile</a></p>
          </div>
        </main>
      </div>
    </>
  );
}
