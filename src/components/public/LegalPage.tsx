import { useEffect, type ReactNode } from 'react';
import { Link, useLocation, type To } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { PublicHeader } from './PublicHeader';
import { PublicFooter } from './PublicFooter';

export interface LegalSection {
  /** Ancre de la section (sommaire, liens externes : /privacy#mentions-legales). */
  id: string;
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
}

interface LegalPageProps {
  seo: { title: string; description: string };
  title: string;
  intro?: ReactNode;
  /** Date de dernière mise à jour, en toutes lettres (« 23 avril 2026 »). */
  updatedAt: string;
  sections: LegalSection[];
  /** Lien vers l'autre page légale, dans l'en-tête. */
  related?: { label: string; to: To };
}

/**
 * Gabarit commun des pages légales : en-tête public, titre en casse de phrase,
 * date de mise à jour, sommaire et sections ancrées.
 */
export function LegalPage({ seo, title, intro, updatedAt, sections, related }: LegalPageProps) {
  const location = useLocation();

  // Le routeur ne fait pas défiler jusqu'à l'ancre : on s'en charge à l'arrivée
  // (lien « Mentions légales » du pied de page) et à chaque changement d'ancre.
  useEffect(() => {
    if (!location.hash) return;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    target?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SEOHead title={seo.title} description={seo.description} />
      <PublicHeader
        width="narrow"
        actions={
          related && (
            <Button asChild variant="ghost" size="sm" className="max-md:h-11">
              <Link to={related.to}>{related.label}</Link>
            </Button>
          )
        }
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
          {intro && <div className="mt-3 space-y-2 text-md leading-relaxed text-foreground-secondary">{intro}</div>}
          <p className="mt-3 text-sm text-muted-foreground">Dernière mise à jour : {updatedAt}</p>
        </header>

        <nav aria-labelledby="legal-sommaire" className="mt-8 rounded-xl border border-border bg-card p-5">
          <h2 id="legal-sommaire" className="text-sm font-semibold text-foreground">
            Sommaire
          </h2>
          <ol className="mt-3 space-y-1">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex min-h-11 items-center text-sm text-foreground-secondary underline-offset-4 transition-colors hover:text-foreground hover:underline md:min-h-0"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          {sections.map(({ id, title: sectionTitle, icon: Icon, children }) => (
            <section key={id} id={id} aria-labelledby={`${id}-titre`} className="scroll-mt-6 space-y-3">
              <h2 id={`${id}-titre`} className="flex items-center gap-2 text-lg font-semibold text-foreground">
                {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                {sectionTitle}
              </h2>
              <div className="space-y-3 text-sm leading-relaxed text-foreground-secondary">{children}</div>
            </section>
          ))}
        </div>
      </main>

      <PublicFooter width="narrow" />
    </div>
  );
}
