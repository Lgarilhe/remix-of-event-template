import type { SVGProps } from 'react';

import type { EmailConnectorProvider } from '@/hooks/useEmailConnectorStatus';

type LogoProps = SVGProps<SVGSVGElement>;

export function GmailLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label="Gmail" {...props}>
      <path fill="#4285F4" d="M3.7 19.5H7V9.4L2 5.7v11.9c0 1 .8 1.9 1.7 1.9Z" />
      <path fill="#34A853" d="M17 19.5h3.3c1 0 1.7-.8 1.7-1.9V5.7l-5 3.7v10.1Z" />
      <path fill="#EA4335" d="M17 5.2v4.2L12 13 7 9.4V5.2L12 8.8l5-3.6Z" />
      <path fill="#FBBC04" d="M17 5.2v4.2l5-3.7V4.8c0-2.2-2.5-3.5-4.3-2.2L17 3.1v2.1Z" />
      <path fill="#C5221F" d="M2 5.7l5 3.7V5.2l-.7-.5C4.5 3.4 2 4.7 2 6.9V5.7Z" />
    </svg>
  );
}

export function OutlookLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label="Outlook" {...props}>
      <path fill="#0078D4" d="M8.6 3h11.2A1.2 1.2 0 0 1 21 4.2v15.6a1.2 1.2 0 0 1-1.2 1.2H8.6V3Z" />
      <path fill="#28A8EA" d="M12.2 7.1H21v9.8h-8.8z" />
      <path fill="#50D9FF" d="m12.2 7.1 4.4 3.3L21 7.1h-8.8Z" />
      <path fill="#0364B8" d="M12.2 7.1v9.8l4.4-3.4 4.4 3.4V7.1l-4.4 3.3-4.4-3.3Z" opacity=".82" />
      <path fill="#0364B8" d="M2.8 5.8 13 4.1v15.8L2.8 18.2A1 1 0 0 1 2 17.3V6.7a1 1 0 0 1 .8-.9Z" />
      <path fill="#fff" d="M7.5 8.3c-2 0-3.2 1.5-3.2 3.8s1.2 3.7 3.1 3.7c2 0 3.2-1.5 3.2-3.8 0-2.2-1.2-3.7-3.1-3.7Zm0 1.5c1 0 1.5.8 1.5 2.3 0 1.4-.6 2.2-1.5 2.2s-1.5-.8-1.5-2.2c0-1.5.5-2.3 1.5-2.3Z" />
    </svg>
  );
}

export function EmailLogo(props: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label="E-mail" fill="none" {...props}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" fill="#64748B" />
      <path d="m4.4 7 7.6 5.7L19.6 7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EmailProviderLogo({
  provider,
  ...props
}: LogoProps & { provider: EmailConnectorProvider }) {
  if (provider === 'gmail') return <GmailLogo {...props} />;
  if (provider === 'outlook') return <OutlookLogo {...props} />;
  return <EmailLogo {...props} />;
}
