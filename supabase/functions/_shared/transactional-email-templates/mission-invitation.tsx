import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Skalr"

interface MissionInvitationProps {
  inviterName?: string
  organizationName?: string
  missionName?: string
  role?: string
  message?: string
  inviteUrl?: string
}

const MissionInvitationEmail = ({ inviterName, organizationName, missionName, role, message, inviteUrl }: MissionInvitationProps) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>{inviterName || 'Un recruteur'} vous invite à travailler sur la mission "{missionName || 'Recrutement'}"</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          Invitation à une mission sur {SITE_NAME}
        </Heading>
        <Text style={text}>
          <strong>{inviterName || 'Un recruteur'}</strong>{organizationName ? ` (${organizationName})` : ''} vous invite à collaborer sur la mission <strong>"{missionName || 'Recrutement'}"</strong> en tant que <strong>{role === 'lead' ? 'Lead recruteur' : role === 'sourcer' ? 'Sourcer' : 'Freelance'}</strong>.
        </Text>
        {message && (
          <Text style={messageStyle}>
            "{message}"
          </Text>
        )}
        <Text style={text}>
          Connectez-vous à {SITE_NAME} pour accepter l'invitation et commencer à sourcer des candidats.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={inviteUrl || '#'}>
            Accepter l'invitation
          </Button>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>
          Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet email.
        </Text>
        <Text style={footer}>
          — {SITE_NAME}
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template: TemplateEntry = {
  component: MissionInvitationEmail,
  subject: (data) => `${data.inviterName || 'Un recruteur'} vous invite sur la mission "${data.missionName || 'Recrutement'}" — ${SITE_NAME}`,
  previewData: {
    inviterName: 'Laurent Garilhe',
    organizationName: 'Skalr Talent',
    missionName: 'DevOps Senior — Numspot',
    role: 'freelance',
    message: 'Salut ! J\'aurais besoin de toi sur cette mission, tu es dispo ?',
    inviteUrl: 'https://app.skalr.fr/mission-invite/abc123',
  },
}

// Styles
const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { margin: '0 auto', padding: '40px 20px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: '700' as const, lineHeight: '1.3', margin: '0 0 20px', color: '#1a1a1a' }
const text = { fontSize: '14px', lineHeight: '1.6', color: '#333', margin: '0 0 16px' }
const messageStyle = { fontSize: '14px', lineHeight: '1.6', color: '#555', fontStyle: 'italic' as const, borderLeft: '3px solid #ddd', paddingLeft: '12px', margin: '0 0 16px' }
const buttonContainer = { margin: '24px 0' }
const button = { backgroundColor: '#1a1a1a', color: '#fff', padding: '12px 24px', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', display: 'inline-block', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }
const hr = { borderColor: '#eee', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#999', margin: '0 0 8px' }
