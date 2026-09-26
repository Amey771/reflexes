// Small inline SVG icons (stroke = currentColor), used instead of emoji so the UI reads as a product.

type P = { className?: string; size?: number };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

export function IconLLM({ className, size = 20 }: P) {
  // a chip: slow, general-purpose thinking
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
      <path d="M10 10h4v4h-4z" />
    </svg>
  );
}

export function IconReflex({ className, size = 20 }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" fillOpacity={0.15} />
    </svg>
  );
}

export function IconHandedBack({ className, size = 20 }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

export function IconRewrite({ className, size = 20 }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

export function IconMemory({ className, size = 20 }: P) {
  return (
    <svg {...base(size)} className={className} aria-hidden>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  );
}

export const STATE_ICON = {
  llm: IconLLM,
  reflex: IconReflex,
  handedBack: IconHandedBack,
  rewriting: IconRewrite,
} as const;
