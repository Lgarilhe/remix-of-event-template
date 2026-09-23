/**
 * Réponses de candidats (§4.1, D26, D35). Section toujours affichée : c'est
 * l'accès à la messagerie, avec la ligne « Ouvrir la messagerie » dans tous
 * les états.
 *
 * Une ligne par conversation. Toutes les réponses comptées (3 derniers jours
 * ouvrés) sont affichées, en gras ; les plus anciennes complètent jusqu'à 8
 * lignes, grisées (hors du chiffre). Le lien /inbox?chatId= laisse la
 * messagerie marquer lue cette seule conversation ; une réponse sans
 * conversation connue est marquée lue ici, au clic.
 */
import { MessageSquare, MessagesSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSidebarNotifications } from '@/hooks/sidebar/useSidebarNotifications';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { useMissionNames } from '@/hooks/sidebar/useMyMissions';
import { formatShortTime, initialsOf, repliesToShow } from '@/lib/sidebarSignals';
import { SidebarSection } from '../SidebarSection';
import { SidebarRow } from '../SidebarRow';

export function RepliesSection() {
  const { replies, markRead } = useSidebarNotifications();
  const navigate = useNavigate();
  const closeMobile = useCloseMobileSidebar();

  const candidates = replies.data?.candidates ?? [];
  const others = replies.data?.others ?? 0;
  const shown = repliesToShow(candidates);
  const missionName = useMissionNames({ enabled: shown.some((r) => !!r.projectId) });
  const now = new Date();

  const footer = (
    <>
      {others > 0 && (
        <SidebarRow leading={<MessagesSquare />} title="Autres messages LinkedIn" sub="Hors recrutement" to="/inbox" />
      )}
      <SidebarRow leading={<MessageSquare />} title="Ouvrir la messagerie" to="/inbox" />
    </>
  );

  return (
    <SidebarSection
      id="replies"
      title="Réponses de candidats"
      titleTo="/inbox"
      state={replies.status}
      stale={replies.stale}
      onRetry={replies.retry}
      isEmpty={candidates.length === 0}
      hideWhenEmpty={false}
      emptyText="Aucune réponse en attente."
      errorText="Impossible de charger vos réponses."
      loadingRows={2}
      footer={footer}
    >
      {shown.map((r) => {
        const common = {
          leading: <span className="text-[9.5px] font-semibold leading-none">{initialsOf(r.name)}</span>,
          title: r.name,
          sub: missionName(r.projectId) ?? r.headline,
          right: formatShortTime(r.lastAt, now),
          strong: r.counted,
          muted: !r.counted,
        };
        if (r.chatId) {
          return <SidebarRow key={`chat:${r.chatId}`} {...common} to={r.link ?? '/inbox'} />;
        }
        // Conversation inconnue : la messagerie ne pourrait jamais la solder.
        return (
          <SidebarRow
            key={`ids:${r.ids[0]}`}
            {...common}
            onSelect={() => {
              closeMobile();
              void markRead(r.ids);
              navigate(r.link ?? '/inbox');
            }}
          />
        );
      })}
    </SidebarSection>
  );
}
