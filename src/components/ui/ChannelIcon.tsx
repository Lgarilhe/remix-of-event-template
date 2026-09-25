import React from 'react';
import { Mail, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CHANNELS, channelOfAccount, type Channel } from '@/lib/channels';
import whatsappLogo from '@/assets/whatsapp-logo.svg';
import linkedinLogo from '@/assets/linkedin-logo.svg';

/**
 * Pastille d'un canal : logo officiel pour LinkedIn et WhatsApp, icône grise
 * pour l'e-mail et l'appel (table `src/lib/channels.ts`). Le libellé, quand il
 * est affiché, reste en texte neutre et le logo devient décoratif, pour ne
 * pas lire le nom deux fois.
 */

export type ChannelType = Channel;

interface ChannelIconProps {
  channel: Channel;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  showLabel?: boolean;
}

const SIZES = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

const LOGOS: Partial<Record<Channel, string>> = {
  linkedin: linkedinLogo,
  whatsapp: whatsappLogo,
};

const ICONS: Partial<Record<Channel, React.ElementType>> = {
  email: Mail,
  call: Phone,
};

export const ChannelIcon: React.FC<ChannelIconProps> = ({ channel, size = 'sm', className, showLabel = false }) => {
  const label = CHANNELS[channel].label;
  const sizeClass = SIZES[size];
  const logo = LOGOS[channel];
  const Icon = ICONS[channel];

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {logo ? (
        <img src={logo} alt={showLabel ? '' : label} className={cn(sizeClass, 'rounded-sm')} />
      ) : Icon ? (
        <Icon
          className={cn(sizeClass, 'text-muted-foreground')}
          aria-hidden={showLabel ? true : undefined}
          aria-label={showLabel ? undefined : label}
          role={showLabel ? undefined : 'img'}
        />
      ) : null}
      {showLabel && <span className="text-xs font-medium text-foreground-secondary">{label}</span>}
    </span>
  );
};

/** Canal d'un compte de messagerie d'après son type (voir `channelOfAccount`). */
export const detectChannel = channelOfAccount;
