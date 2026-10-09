import { CandidateActions } from '@/components/outreach/inbox/CandidateActions';
import { useCandidateActions } from '@/hooks/useCandidateActions';

/** Même composant et hook que les conversations, avec une identité fixe pour les courses réseau. */
export function ActionPreparationFixture() {
  const controller = useCandidateActions({ candidate_id: 'ACo_fixture_camille', linkedin_url: 'https://www.linkedin.com/in/camille-fixture', account_id: 'account', chat_id: 'chat-0' });
  return <main className="mx-auto min-h-screen max-w-3xl bg-background p-4 text-foreground"><h1 className="text-xl">Conversation de Camille Durand</h1><CandidateActions controller={controller} /></main>;
}
