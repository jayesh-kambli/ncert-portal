"use client";

import { useEffect, useState } from "react";

interface Credits {
  creditTotal: number | null;
  remaining: number | null;
  spent: number;
  since: string;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

// OpenAI credit balance for the dashboard header. Renders nothing until the
// numbers load, and nothing at all if /api/credits isn't configured.
export function CreditsBadge() {
  const [credits, setCredits] = useState<Credits | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    fetch("/api/credits")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setCredits(data))
      .catch(() => {});
  }, []);

  if (!credits) return null;

  const hasBalance = credits.remaining !== null && credits.creditTotal !== null;
  const isLow = hasBalance && credits.remaining! < credits.creditTotal! * 0.2;

  return (
    <div className="relative mt-1.5 flex items-center gap-1.5 text-xs text-foreground/55">
      <span>
        OpenAI credits:{" "}
        {hasBalance ? (
          <>
            <span className={`font-medium ${isLow ? "text-red-500" : "text-foreground"}`}>
              {usd(credits.remaining!)}
            </span>{" "}
            left of {usd(credits.creditTotal!)} · {usd(credits.spent)} used
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">{usd(credits.spent)}</span> used this month
          </>
        )}
      </span>
      <button
        type="button"
        onClick={() => setShowInfo((v) => !v)}
        onBlur={() => setShowInfo(false)}
        aria-label="About this balance"
        aria-expanded={showInfo}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-foreground/30 text-[10px] leading-none font-semibold text-foreground/55 hover:border-foreground/60 hover:text-foreground"
      >
        i
      </button>
      {showInfo && (
        <div
          role="tooltip"
          className="absolute top-full left-0 z-10 mt-1.5 w-64 rounded-xl border border-surface-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground/80 shadow-sm"
        >
          Usage can take up to 1 day to show here, so the real balance may be lower than shown — use
          carefully.
          {hasBalance && <> Counted from {credits.since}.</>}
        </div>
      )}
    </div>
  );
}
