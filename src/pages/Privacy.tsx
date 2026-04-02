import { SEOHead } from '@/components/SEOHead';
import { Link } from 'react-router-dom';
import { Shield, Mail, Database, Brain, Globe, Clock, UserX, FileDown, ArrowLeft } from 'lucide-react';

const Section = ({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) => (
  <section className="space-y-3">
    <h2 className="flex items-center gap-2 text-lg font-bold uppercase tracking-wider text-foreground">
      <Icon className="w-5 h-5 shrink-0" />
      {title}
    </h2>
    <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
      {children}
    </div>
  </section>
);

export default function PrivacyPage() {
  return (
    <>
      <SEOHead
        title="Politique de confidentialité — Konekt"
        description="Politique de confidentialité et RGPD de Konekt. Traitement des données personnelles, scoring IA, droits des personnes."
      />
      <div className="min-h-screen bg-background text-foreground">
        {/* Header */}
        <header className="border-b-2 border-border">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link to="/" className="text-sm font-bold uppercase tracking-widest hover:text-muted-foreground transition-colors flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Konekt
            </Link>
            <span className="text-xs text-muted-foreground">Dernière mise à jour : mars 2026</span>
          </div>
        </header>

        {/* Content */}
        <main className="max-w-3xl mx-auto px-6 py-12 space-y-10">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-wider">Politique de confidentialité</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Konekt Services SAS — Plateforme SaaS de recrutement assisté par intelligence artificielle.
            </p>
          </div>

          {/* 1. Responsable de traitement */}
          <Section icon={Shield} title="1. Responsable de traitement">
            <p>
              <strong>Konekt Services SAS</strong> est sous-traitant (article 28 du RGPD) pour les données des candidats
              traitées pour le compte de ses clients (cabinets de recrutement, entreprises, freelances).
            </p>
            <p>
              Konekt est responsable de traitement pour ses propres données : comptes utilisateurs,
              facturation, analytics d'usage.
            </p>
            <p>
              Contact DPO : <a href="mailto:privacy@konekt.io" className="underline text-foreground hover:text-muted-foreground">privacy@konekt.io</a>
            </p>
          </Section>

          {/* 2. Données collectées */}
          <Section icon={Database} title="2. Données collectées et traitées">
            <p><strong>Données des candidats</strong> (traitées pour le compte du client) :</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Identité professionnelle : nom, prénom, titre, entreprise actuelle</li>
              <li>Coordonnées professionnelles : profil LinkedIn, email professionnel</li>
              <li>Parcours : expériences, formations, compétences, certifications</li>
              <li>Scores et évaluations IA : scoring de correspondance, analyses de profil</li>
              <li>Communications : messages LinkedIn envoyés/reçus via la plateforme</li>
              <li>Enregistrements audio : coaching live (transcription et audio temporaire)</li>
            </ul>
            <p className="mt-2"><strong>Données des utilisateurs</strong> (clients Konekt) :</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Compte : nom, email, organisation, rôle</li>
              <li>Facturation : gérée par Stripe (Konekt ne stocke pas les données de carte)</li>
              <li>Usage : crédits IA consommés, actions effectuées, modèles utilisés</li>
            </ul>
          </Section>

          {/* 3. Scoring IA */}
          <Section icon={Brain} title="3. Scoring IA — Traitement automatisé">
            <p>
              Konekt utilise l'intelligence artificielle pour évaluer la correspondance entre un profil
              candidat et un poste. Ce scoring est un <strong>outil d'aide à la décision</strong>, pas une
              décision automatisée au sens de l'article 22 du RGPD.
            </p>
            <p><strong>Comment fonctionne le scoring :</strong></p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Analyse des compétences techniques (skills déclarés, expériences)</li>
              <li>Évaluation de la séniorité et de la cohérence du parcours</li>
              <li>Correspondance avec les critères du poste (must-have, nice-to-have)</li>
              <li>Score global de 0 à 100 avec recommandation (go / maybe / skip)</li>
            </ul>
            <p className="mt-2"><strong>Garanties :</strong></p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Le score IA n'est <strong>jamais le seul critère de décision</strong> — un recruteur humain
                  valide toujours avant de contacter un candidat</li>
              <li>Le scoring n'utilise <strong>aucun critère discriminant</strong> (âge, genre, origine, handicap, etc.)</li>
              <li>Les candidats peuvent exercer leur <strong>droit d'opposition au scoring IA</strong></li>
              <li>Les données de profil envoyées à l'IA ne sont <strong>pas conservées par le fournisseur IA</strong>
                  pour l'entraînement de ses modèles (opt-out API)</li>
            </ul>
          </Section>

          {/* 4. Sous-traitants */}
          <Section icon={Globe} title="4. Sous-traitants ultérieurs">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-border">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-2 border-b border-border font-bold">Sous-traitant</th>
                    <th className="text-left p-2 border-b border-border font-bold">Données</th>
                    <th className="text-left p-2 border-b border-border font-bold">Localisation</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: 'Supabase (AWS)', data: 'Toutes les données app', location: 'EU (Irlande)' },
                    { name: 'Anthropic', data: 'Profils dans les prompts IA', location: 'US (DPF)' },
                    { name: 'Google AI', data: 'Profils dans les prompts IA', location: 'US (DPF)' },
                    { name: 'Deepgram', data: 'Audio coaching live', location: 'US (DPF + SCC)' },
                    { name: 'Unipile', data: 'Messages LinkedIn/Email', location: 'France' },
                    { name: 'Stripe', data: 'Facturation', location: 'US (DPF + SCC)' },
                  ].map((row) => (
                    <tr key={row.name} className="border-b border-border/50">
                      <td className="p-2 font-medium text-foreground">{row.name}</td>
                      <td className="p-2">{row.data}</td>
                      <td className="p-2">{row.location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs">
              DPF = Data Privacy Framework (cadre UE-US). SCC = Standard Contractual Clauses.
              Les fournisseurs IA (Anthropic, Google) ne conservent pas les données des appels API
              pour l'entraînement de leurs modèles.
            </p>
          </Section>

          {/* 5. Durées de rétention */}
          <Section icon={Clock} title="5. Durées de conservation">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-border">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-2 border-b border-border font-bold">Données</th>
                    <th className="text-left p-2 border-b border-border font-bold">Durée</th>
                    <th className="text-left p-2 border-b border-border font-bold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { data: 'Candidats sans activité', duration: '24 mois', action: 'Purge automatique' },
                    { data: 'Candidats refusés', duration: '12 mois', action: 'Purge automatique' },
                    { data: 'Messages outreach', duration: '24 mois', action: 'Archivage puis purge' },
                    { data: 'Audio coaching', duration: '6 mois', action: 'Suppression (transcript conservé)' },
                    { data: 'Facturation', duration: '10 ans', action: 'Obligation légale' },
                  ].map((row) => (
                    <tr key={row.data} className="border-b border-border/50">
                      <td className="p-2 font-medium text-foreground">{row.data}</td>
                      <td className="p-2">{row.duration}</td>
                      <td className="p-2">{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 6. Droits */}
          <Section icon={UserX} title="6. Vos droits">
            <p>Conformément au RGPD, vous disposez des droits suivants :</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Droit d'accès</strong> : obtenir une copie de vos données personnelles</li>
              <li><strong>Droit de rectification</strong> : corriger des données inexactes</li>
              <li><strong>Droit à l'effacement</strong> : demander la suppression de vos données</li>
              <li><strong>Droit d'opposition au scoring IA</strong> : demander que votre profil ne soit plus évalué par l'IA</li>
              <li><strong>Droit à la portabilité</strong> : recevoir vos données dans un format structuré</li>
              <li><strong>Droit de réclamation</strong> : saisir la CNIL (cnil.fr)</li>
            </ul>
            <p className="mt-2">
              Pour exercer vos droits, contactez-nous à{' '}
              <a href="mailto:privacy@konekt.io" className="underline text-foreground hover:text-muted-foreground">
                privacy@konekt.io
              </a>
              . Nous répondons sous 30 jours.
            </p>
          </Section>

          {/* 7. Cookies */}
          <Section icon={FileDown} title="7. Cookies et traceurs">
            <p>
              Konekt utilise uniquement des cookies <strong>strictement nécessaires</strong> au fonctionnement
              de l'application (authentification, session, préférences). Aucun cookie publicitaire ou de
              tracking tiers n'est utilisé.
            </p>
          </Section>

          {/* 8. Sécurité */}
          <Section icon={Shield} title="8. Mesures de sécurité">
            <ul className="list-disc pl-5 space-y-1">
              <li>Chiffrement des données en transit (TLS) et au repos</li>
              <li>Row Level Security (RLS) sur toutes les tables Supabase</li>
              <li>Authentification JWT avec vérification d'appartenance à l'organisation</li>
              <li>Clés API stockées côté serveur (jamais exposées au frontend)</li>
              <li>Rate limiting sur toutes les edge functions</li>
              <li>Monitoring des erreurs via Sentry</li>
            </ul>
          </Section>

          {/* Footer */}
          <div className="pt-8 border-t border-border text-xs text-muted-foreground space-y-2">
            <p>Konekt Services SAS — France</p>
            <p>Contact : <a href="mailto:privacy@konekt.io" className="underline">privacy@konekt.io</a></p>
            <p>Cette politique peut être mise à jour. La date de dernière modification est indiquée en haut de page.</p>
          </div>
        </main>
      </div>
    </>
  );
}
