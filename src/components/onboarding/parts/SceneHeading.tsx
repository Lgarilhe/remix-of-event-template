import React from 'react';

interface Props {
  title: string;
  /** Phrase d'appui sous le titre. */
  children?: React.ReactNode;
  id?: string;
}

/** En-tête d'une scène : un titre, une phrase d'appui. Rien ne bouge. */
export const SceneHeading: React.FC<Props> = ({ title, children, id }) => (
  <header className="space-y-2">
    <h1 id={id} className="text-2xl font-semibold tracking-tight text-foreground">
      {title}
    </h1>
    {children && <div className="max-w-lg text-sm text-foreground-secondary">{children}</div>}
  </header>
);
