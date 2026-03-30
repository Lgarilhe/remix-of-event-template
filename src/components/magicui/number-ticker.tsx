import { useEffect, useRef, useState } from "react";
import { useInView, useMotionValue, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";

interface NumberTickerProps {
  value: number;
  startValue?: number;
  direction?: "up" | "down";
  delay?: number;
  decimalPlaces?: number;
  className?: string;
}

/**
 * Animated number counter that smoothly transitions to a target value.
 * Adapted from Magic UI (MIT) — https://magicui.design/docs/components/number-ticker
 */
export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  decimalPlaces = 0,
  className,
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(direction === "down" ? value : startValue);
  const springValue = useSpring(motionValue, {
    damping: 60,
    stiffness: 100,
  });
  const isInView = useInView(ref, { once: true, margin: "0px" });
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    if (isInView && !hasAnimated) {
      setTimeout(() => {
        motionValue.set(direction === "down" ? startValue : value);
        setHasAnimated(true);
      }, delay * 1000);
    }
  }, [motionValue, isInView, delay, value, direction, startValue, hasAnimated]);

  useEffect(() => {
    if (hasAnimated) {
      motionValue.set(direction === "down" ? startValue : value);
    }
  }, [value, motionValue, direction, startValue, hasAnimated]);

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) {
          ref.current.textContent = Intl.NumberFormat("fr-FR", {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces,
          }).format(Number(latest.toFixed(decimalPlaces)));
        }
      }),
    [springValue, decimalPlaces]
  );

  return (
    <span
      ref={ref}
      className={cn(
        "inline-block tabular-nums tracking-wider",
        className
      )}
    >
      {startValue}
    </span>
  );
}
