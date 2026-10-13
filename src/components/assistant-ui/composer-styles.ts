/** Classes du composer de l'assistant, partagées sans changer son rendu. */
export const ASSISTANT_COMPOSER_CLASS = 'relative flex flex-col rounded-xl border border-input bg-background p-2 transition-colors focus-within:border-brand';
export const ASSISTANT_COMPOSER_INPUT_CLASS = 'w-full resize-none bg-transparent px-3 py-2.5 text-md leading-relaxed text-foreground placeholder:text-muted-foreground outline-none max-h-40 min-h-[24px]';
export const ASSISTANT_COMPOSER_TOOLBAR_CLASS = 'flex items-center gap-1 pl-1 pr-0.5 pt-1';
export const ASSISTANT_SEND_CLASS = [
  'ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors max-md:h-11 max-md:w-11',
  'bg-foreground text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
].join(' ');
