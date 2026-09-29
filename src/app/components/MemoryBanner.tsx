"use client";

import { useEffect, useState } from "react";

import { api } from "@/app/lib/api";
import { countLabel } from "@/app/lib/format";
import type { HindsightStatusDto } from "@/app/types";
import { Badge } from "./ui";

interface StatusResponse {
  status: HindsightStatusDto;
  localFindings: number;
}

/**
 * Persistent health readout for the memory layer.
 *
 * When Hindsight is down this says so plainly instead of hiding it — the
 * recommendation panel then explains that it fell back to a stateless answer.
 */
export function MemoryBanner({ tick }: { tick: number }) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Subscribes to an external system (the status API). The fetch resolves in a
  // callback, so setState never runs synchronously inside the effect body, and
  // `cancelled` guards against updates after unmount. `tick` is bumped by the
  // page after any action that could change memory state.
  useEffect(() => {
    let cancelled = false;

    api
      .get<StatusResponse>("/api/hindsight/status")
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Status check failed");
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  const status = data?.status;
  const reachable = status?.reachable ?? false;
  // Until the first response lands the state is *unknown*, not *down*: showing
  // a red "unavailable" during that window is the interface inventing a
  // condition nobody has observed yet.
  const checked = data !== null || error !== null;
  const dot = !checked ? "bg-zinc-400" : reachable ? "bg-emerald-500" : "bg-red-500";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        <span className="font-medium">
          {!checked
            ? "Checking memory layer…"
            : reachable
              ? "Hindsight connected"
              : "Hindsight unavailable"}
        </span>
      </span>

      {checked && reachable && (
        <>
          <span className="text-zinc-500 dark:text-zinc-400">{status?.baseUrl}</span>
          <Badge tone="info" mono>bank: {status?.bankId}</Badge>
          <Badge mono>v{status?.version}</Badge>
        </>
      )}

      {checked && !reachable && (
        <span className="text-zinc-500 dark:text-zinc-400" title={error ?? undefined}>
          {status?.reason ?? "The memory service did not answer."} Recommendations will run
          without history until it is back.
        </span>
      )}

      {data && (
        <Badge tone="neutral">{countLabel(data.localFindings, "finding")} on record</Badge>
      )}
    </div>
  );
}
