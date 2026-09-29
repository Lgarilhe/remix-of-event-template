import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/** Texte qui s'écrit : un caractère toutes les `speed` ms. Figé tout de suite avec le mouvement réduit. */
export function useTypewriter(text: string, opts: { speed?: number; start?: boolean; delay?: number } = {}): { shown: string; done: boolean } {
  const { speed = 22, start = true, delay = 0 } = opts;
  const reduced = useReducedMotion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!start) {
      setCount(0);
      return;
    }
    if (reduced) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let i = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const startTimer = setTimeout(() => {
      timer = setInterval(() => {
        i += 1;
        setCount(i);
        if (i >= text.length && timer) clearInterval(timer);
      }, speed);
    }, delay * 1000);
    return () => {
      clearTimeout(startTimer);
      if (timer) clearInterval(timer);
    };
  }, [text, start, speed, delay, reduced]);

  return { shown: text.slice(0, count), done: count >= text.length };
}
