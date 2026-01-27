import React, { useState } from 'react';
import { Twitter, Facebook, Linkedin, Link2, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface SocialShareProps {
  title: string;
  description: string;
  url?: string;
}

export const SocialShare: React.FC<SocialShareProps> = ({ 
  title, 
  description,
  url = typeof window !== 'undefined' ? window.location.href : ''
}) => {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const encodedDescription = encodeURIComponent(description.substring(0, 100));

  const shareLinks = [
    {
      name: 'Twitter',
      icon: Twitter,
      url: `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`,
      color: 'hover:text-[#1DA1F2]'
    },
    {
      name: 'Facebook',
      icon: Facebook,
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      color: 'hover:text-[#1877F2]'
    },
    {
      name: 'LinkedIn',
      icon: Linkedin,
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
      color: 'hover:text-[#0A66C2]'
    }
  ];

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({
        title: 'Link copied!',
        description: 'Event link has been copied to clipboard.',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({
        title: 'Failed to copy',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <section className="flex flex-col items-start gap-4 self-stretch relative">
      <div className="flex flex-col items-start gap-5 self-stretch relative">
        <hr className="h-px self-stretch relative bg-[#1A1A1A] border-0" />
        <h2 className="self-stretch text-[#1A1A1A] text-[11px] font-normal uppercase relative">
          SHARE EVENT
        </h2>
      </div>
      <div className="flex items-center gap-4">
        {shareLinks.map(({ name, icon: Icon, url, color }) => (
          <a
            key={name}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Share on ${name}`}
            className={`p-2 border border-[#1A1A1A] text-[#1A1A1A] transition-colors ${color} hover:border-current`}
          >
            <Icon size={18} strokeWidth={1.5} />
          </a>
        ))}
        <button
          onClick={copyToClipboard}
          aria-label="Copy link"
          className={`p-2 border border-[#1A1A1A] text-[#1A1A1A] transition-colors hover:text-emerald-600 hover:border-emerald-600 ${copied ? 'text-emerald-600 border-emerald-600' : ''}`}
        >
          {copied ? <Check size={18} strokeWidth={1.5} /> : <Link2 size={18} strokeWidth={1.5} />}
        </button>
      </div>
    </section>
  );
};
