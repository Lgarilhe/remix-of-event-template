import { CalendarDays } from 'lucide-react';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { EmailProviderLogo } from '@/components/assistant-ui/connector-logos';
import { SERVICE_LABELS, type MessagingService } from '@/lib/messagingServices';
import { cn } from '@/lib/utils';
import calendlyLogo from '@/assets/calendly-logo.webp';
import aircallLogo from '@/assets/aircall-logo.webp';
import googleMeetLogo from '@/assets/google-meet-logo.svg';

const SIZES = { xs: 'h-3 w-3', sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' };

export function ServiceLogo({ service, size = 'sm', decorative = false, className }: {
  service: MessagingService;
  size?: keyof typeof SIZES;
  decorative?: boolean;
  className?: string;
}) {
  const classes = cn(SIZES[size], 'shrink-0 object-contain', className);
  if (service === 'gmail' || service === 'outlook') return <EmailProviderLogo provider={service} className={classes} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : SERVICE_LABELS[service]} />;
  const asset = service === 'calendly' ? calendlyLogo : service === 'aircall' ? aircallLogo : service === 'google_meet' ? googleMeetLogo : null;
  if (asset) return <img src={asset} alt={decorative ? '' : SERVICE_LABELS[service]} aria-hidden={decorative || undefined} className={cn(classes, (service === 'calendly' || service === 'aircall') && 'dark:invert')} />;
  if (service === 'calendar') return <CalendarDays className={cn(classes, 'text-foreground')} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : 'Calendrier'} />;
  return <ChannelIcon channel={service as 'linkedin' | 'whatsapp' | 'email' | 'call'} size={size} decorative={decorative} className={className} />;
}
