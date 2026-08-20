"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    adsbygoogle?: Record<string, unknown>[];
  }
}

export function AdSlot({
  client,
  slot,
  className = "",
}: {
  client: string | null;
  slot: string | null;
  className?: string;
}) {
  const enabled = Boolean(client && slot);

  useEffect(() => {
    if (!enabled) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Ad blockers and unapproved sites can prevent AdSense from initializing.
    }
  }, [enabled, slot]);

  if (!enabled) return null;

  return (
    <aside className={`dn-ad-shell ${className}`.trim()} aria-label="Advertisement">
      <span className="dn-ad-label">Advertisement</span>
      <ins
        className="adsbygoogle block min-h-[90px] w-full"
        style={{ display: "block" }}
        data-ad-client={client ?? undefined}
        data-ad-slot={slot ?? undefined}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
