import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Konekt"

interface TeamInvitationProps {
  organizationName?: string
  inviterName?: string
  role?: string
  inviteUrl?: string
}

const TeamInvitationEmail = ({ organizationName, inviterName, role, inviteUrl }: TeamInvitationProps) => (
  <Html lang="fr" dir="ltr">
    <Head />
    <Preview>{inviterName ? `${inviterName} vous invite` : 'Vous êtes invité'} à rejoindre {organizationName || 'une équipe'} sur {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          Rejoignez {organizationName || 'votre équipe'} sur {SITE_NAME}
        </Heading>
        <Text style={text}>
          {inviterName ? `${inviterName} vous invite` : 'Vous êtes invité(e)'} à rejoindre l'organisation <strong>{organizationName}</strong> en tant que <strong>{role === 'admin' ? 'Administrateur' : 'Membre'}</strong>.
        </Text>
        <Text style={text}>
          Connectez-vous pour accepter l'invitation, puis reliez votre compte LinkedIn pour commencer à recruter avec votre équipe.
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
          — L'équipe {SITE_NAME}
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: TeamInvitationEmail,
  subject: (data: Record<string, any>) =>
    `${data.inviterName || 'Votre équipe'} vous invite à rejoindre ${data.organizationName || SITE_NAME}`,
  displayName: 'Invitation équipe',
  previewData: {
    organizationName: 'Konekt Recrutement',
    inviterName: 'Marie Dupont',
    role: 'member',
    inviteUrl: 'https://app.konekt.fr/auth',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Outfit', 'Helvetica Neue', Arial, sans-serif" }
const container = { padding: '40px 25px', maxWidth: '480px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: 'hsl(265, 4%, 12.9%)', margin: '0 0 24px', lineHeight: '1.3' }
const text = { fontSize: '15px', color: 'hsl(257, 4.6%, 55.4%)', lineHeight: '1.6', margin: '0 0 16px' }
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
