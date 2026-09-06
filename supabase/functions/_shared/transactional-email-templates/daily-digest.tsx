import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Konekt"

// Données déjà résumées côté agent-daily-digest (texte déterministe, aucun
// appel IA) : le template ne fait que les mettre en forme.
interface DigestMission {
  label: string
  client?: string
  found: number
  messaged: number
  shortlisted: number
}

interface DigestInterview {
  time: string
  candidateName: string
  jobTitle?: string
  eventName?: string
}

interface DigestAction {
  summary: string
}

interface DailyDigestProps {
  dateLabel?: string
  organizationName?: string
  missions?: DigestMission[]
  missionsTotal?: number
  interviews?: DigestInterview[]
  actions?: DigestAction[]
  actionsTotal?: number
  appUrl?: string
  settingsUrl?: string
}

const DailyDigestEmail = ({
  dateLabel,
  organizationName,
  missions = [],
  missionsTotal,
  interviews = [],
  actions = [],
  actionsTotal,
  appUrl,
  settingsUrl,
}: DailyDigestProps) => {
  const missionsCount = missionsTotal ?? missions.length
  const actionsCount = actionsTotal ?? actions.length
  const missionsMore = Math.max(0, missionsCount - missions.length)
  const actionsMore = Math.max(0, actionsCount - actions.length)

  return (
    <Html lang="fr" dir="ltr">
      <Head />
      <Preview>
        {`${missionsCount} mission(s) active(s), ${interviews.length} entretien(s) dans les 24 h, ${actionsCount} action(s) IA en attente`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Votre matinée {SITE_NAME}</Heading>
          <Text style={text}>
            {dateLabel ? `Voici votre point du ${dateLabel}` : 'Voici votre point du jour'}
            {organizationName ? ` pour ${organizationName}.` : '.'}
          </Text>

          <Heading as="h2" style={h2}>Missions actives ({missionsCount})</Heading>
          {missions.length === 0 ? (
            <Text style={text}>Aucune mission active. Créez une mission pour lancer un recrutement.</Text>
          ) : (
            missions.map((m, i) => (
              <Text key={i} style={item}>
                <strong>{m.label}</strong>
                {m.client ? ` (${m.client})` : ''} : {m.found} sourcés, {m.messaged} contactés, {m.shortlisted} shortlistés
              </Text>
            ))
          )}
          {missionsMore > 0 && (
            <Text style={muted}>et {missionsMore} autre(s) mission(s) dans {SITE_NAME}.</Text>
          )}

          <Heading as="h2" style={h2}>Entretiens dans les prochaines 24 h ({interviews.length})</Heading>
          {interviews.length === 0 ? (
            <Text style={text}>Aucun entretien programmé.</Text>
          ) : (
            interviews.map((it, i) => (
              <Text key={i} style={item}>
                {it.time} : <strong>{it.candidateName}</strong>
                {it.jobTitle ? ` (${it.jobTitle})` : ''}
                {it.eventName ? `, ${it.eventName}` : ''}
              </Text>
            ))
          )}

          <Heading as="h2" style={h2}>Actions IA en attente d'approbation ({actionsCount})</Heading>
          {actions.length === 0 ? (
            <Text style={text}>Rien en attente.</Text>
          ) : (
            actions.map((a, i) => (
              <Text key={i} style={item}>{a.summary}</Text>
            ))
          )}
          {actionsMore > 0 && (
            <Text style={muted}>et {actionsMore} autre(s) action(s) à valider dans {SITE_NAME}.</Text>
          )}

          <Section style={buttonContainer}>
            <Button style={button} href={appUrl || '#'}>
              Ouvrir {SITE_NAME}
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            Vous recevez cet email parce que le digest matinal est activé
            {organizationName ? ` pour ${organizationName}` : ' pour votre organisation'}.
            {' '}Pour ne plus le recevoir, désactivez-le dans{' '}
            {settingsUrl ? (
              <Link href={settingsUrl} style={footerLink}>Paramètres, Actions IA</Link>
            ) : (
              'Paramètres, Actions IA'
            )}.
          </Text>
          <Text style={footer}>
            L'équipe {SITE_NAME}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: DailyDigestEmail,
  subject: (data: Record<string, any>) =>
    data.dateLabel ? `Votre matinée ${SITE_NAME} du ${data.dateLabel}` : `Votre matinée ${SITE_NAME}`,
  displayName: 'Digest matinal',
  previewData: {
    dateLabel: 'lundi 7 septembre',
    organizationName: 'Konekt Recrutement',
    missions: [
      { label: 'DevOps Senior', client: 'Numspot', found: 42, messaged: 18, shortlisted: 3 },
      { label: 'Product Manager', found: 12, messaged: 4, shortlisted: 0 },
    ],
    missionsTotal: 2,
    interviews: [
      { time: '10:30', candidateName: 'Marie Dupont', jobTitle: 'DevOps Senior', eventName: 'Entretien technique' },
    ],
    actions: [
      { summary: 'Enrôler 5 candidats dans la séquence « Relance DevOps »' },
    ],
    actionsTotal: 1,
    appUrl: 'https://konekt-app-navy.vercel.app/dashboard',
    settingsUrl: 'https://konekt-app-navy.vercel.app/settings?tab=agent-actions',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Outfit', 'Helvetica Neue', Arial, sans-serif" }
const container = { padding: '40px 25px', maxWidth: '480px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: 'hsl(265, 4%, 12.9%)', margin: '0 0 24px', lineHeight: '1.3' }
const h2 = { fontSize: '15px', fontWeight: '700' as const, color: 'hsl(265, 4%, 12.9%)', margin: '24px 0 8px', lineHeight: '1.3' }
const text = { fontSize: '15px', color: 'hsl(257, 4.6%, 55.4%)', lineHeight: '1.6', margin: '0 0 16px' }
const item = { fontSize: '14px', color: 'hsl(265, 4%, 12.9%)', lineHeight: '1.6', margin: '0 0 6px' }
const muted = { fontSize: '13px', color: 'hsl(257, 4.6%, 55.4%)', lineHeight: '1.6', margin: '0 0 8px' }
const buttonContainer = { textAlign: 'center' as const, margin: '32px 0' }
const button = {
  backgroundColor: 'hsl(266, 4%, 20.8%)',
  color: 'hsl(248, 0.3%, 98.4%)',
  borderRadius: '0.375rem',
  fontSize: '15px',
  fontWeight: '600' as const,
  padding: '12px 32px',
  textDecoration: 'none',
}
const hr = { borderColor: 'hsl(256, 1.3%, 92.9%)', margin: '32px 0' }
const footer = { fontSize: '12px', color: 'hsl(257, 4.6%, 55.4%)', margin: '0 0 8px' }
const footerLink = { color: 'hsl(257, 4.6%, 55.4%)', textDecoration: 'underline' }
