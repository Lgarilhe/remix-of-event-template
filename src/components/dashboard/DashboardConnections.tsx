/**
 * DashboardConnections — état temps réel des canaux outreach.
 *
 * 3 cartes compactes : LinkedIn / Email / WhatsApp avec :
 * - Logo du canal (couleur de marque ou icon mono)
 * - Statut visuel (dot pulse coloré) : connected / connecting / error / disconnected
 * - Label (nom du compte ou identifier)
 * - Mini CTA "Reconnecter" si error/disconnected
 *
 * Si tout est connecté : header discret "Tous vos canaux sont actifs" + dot vert
 * Si problème : header tone destructive avec CTA pour aller dans Settings
 *
 * V2 anim : stagger entrance, status pulse animé, CTA hover lift.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Mail, AlertTriangle, ArrowRight, Plug, CheckCircle2 } from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import whatsappLogo from '@/assets/whatsapp-logo.svg';
import { cn } from '@/lib/utils';
import type { ChannelConnection, ConnectionStatus } from '@/hooks/useDashboardConnections';
import { LivePulse } from './LivePulse';

interface DashboardConnectionsProps {
  linkedin: ChannelConnection;
  whatsapp: ChannelConnection;
  email: ChannelConnection;
  hasIssue: boolean;
  allConnected: boolean;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connecté',
  connecting: 'Connexion…',
  error: 'À reconnecter',
  disconnected: 'Non connecté',
};

const STATUS_TONE: Record<ConnectionStatus, { dot: string; text: string; bg: string }> = {
  connected: { dot: 'bg-success', text: 'text-success', bg: 'bg-success/10' },
  connecting: { dot: 'bg-warning', text: 'text-warning', bg: 'bg-warning/10' },
  error: { dot: 'bg-destructive', text: 'text-destructive', bg: 'bg-destructive/10' },
  disconnected: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', bg: 'bg-muted/40' },
};

const ConnectionCard: React.FC<{
  channel: ChannelConnection;
  name: string;
  brandLogo?: React.ReactNode;
  brandIcon?: React.ReactNode;
  index: number;
  onClick: () => void;
}> = ({ channel, name, brandLogo, brandIcon, index, onClick }) => {
  const tone = STATUS_TONE[channel.status];
  const isOk = channel.status === 'connected';
  const needsAction = channel.status === 'error' || channel.status === 'disconnected';

  return (
    <motion.button
      onClick={onClick}
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.4, ease: 'easeOut', delay: index * 0.06 },
        },
      }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'group relative rounded-xl border p-3.5 text-left transition-colors flex items-center gap-3 overflow-hidden',
        needsAction
          ? 'bg-destructive/[0.04] hover:bg-destructive/[0.08] border-destructive/20 hover:border-destructive/40'
          : isOk
          ? 'bg-card hover:bg-muted/30 border-border'
          : 'bg-muted/20 hover:bg-muted/40 border-border',
      )}
    >
      {/* Brand logo / icon */}
      <div
        className={cn(
          'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
          isOk ? 'bg-foreground/[0.04]' : 'bg-muted/40',
        )}
      >
        {brandLogo || brandIcon}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-display font-bold text-foreground text-[13px] tracking-tight leading-none truncate">
            {name}
          </span>
          {channel.status === 'connecting' && <LivePulse tone="info" />}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'relative flex h-1.5 w-1.5 rounded-full shrink-0',
              tone.dot,
            )}
          >
            {isOk && (
              <motion.span
                className={cn('absolute inset-0 rounded-full', tone.dot)}
                initial={{ opacity: 0.5, scale: 1 }}
                animate={{ opacity: 0, scale: 2.6 }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
              />
            )}
          </span>
          <span className={cn('text-[10.5px] uppercase tracking-wider font-bold', tone.text)}>
            {STATUS_LABEL[channel.status]}
          </span>
          {channel.label && isOk && (
            <span className="text-[10.5px] text-muted-foreground truncate">· {channel.label}</span>
          )}
        </div>
      </div>

      {needsAction && (
        <ArrowRight
          className={cn(
            'w-4 h-4 shrink-0 transition-all opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0',
            tone.text,
          )}
          aria-hidden="true"
        />
      )}
    </motion.button>
  );
};

export const DashboardConnections: React.FC<DashboardConnectionsProps> = ({
  linkedin,
  whatsapp,
  email,
  hasIssue,
  allConnected,
}) => {
  const navigate = useNavigate();
  const goToConnectors = () => navigate('/settings?tab=account');

  return (
    <motion.div
      className="mb-6"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut', delay: 0.1 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Vos canaux
        </span>
        <div className="flex-1 h-px bg-border" />
        {hasIssue ? (
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-destructive">
            <AlertTriangle className="w-3 h-3" />
            Action requise
          </span>
        ) : allConnected ? (
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-success">
            <CheckCircle2 className="w-3 h-3" />
            Tout actif
          </span>
        ) : null}
      </div>

      <motion.div
        className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.05 } },
        }}
      >
        <ConnectionCard
          channel={linkedin}
          name="LinkedIn"
          brandLogo={
            <img src={linkedinLogo} alt="LinkedIn" className="w-5 h-5 object-contain" />
          }
          index={0}
          onClick={goToConnectors}
        />
        <ConnectionCard
          channel={email}
          name="Email"
          brandIcon={<Mail className="w-5 h-5 text-info" />}
          index={1}
          onClick={goToConnectors}
        />
        <ConnectionCard
          channel={whatsapp}
          name="WhatsApp"
          brandLogo={
            <img src={whatsappLogo} alt="WhatsApp" className="w-5 h-5 object-contain" />
          }
          index={2}
          onClick={goToConnectors}
        />
      </motion.div>
    </motion.div>
  );
};
