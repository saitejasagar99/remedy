"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { FindingExperience } from "@/app/components/finding-experience";

/**
 * The main product surface: one finding, told end to end.
 *
 * The structure is deliberately ordered — summary, evidence, root cause,
 * memory, recommendation, why, approval, verification, outcome, memory update
 * — because that is the order a compliance engineer has to defend the decision
 * in, not the order the code happens to run in.
 */
export default function FindingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  if (!id) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500">
        Finding id missing from the route.
      </div>
    );
  }

  return (
    <div className="remedy-rise">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4">
        <div className="min-w-0">
          <Link
            href="/findings"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800"
          >
            ← All findings
          </Link>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Investigation record
          </p>
          <h1 className="mt-0.5 break-words text-xl font-semibold tracking-tight text-zinc-900">
            <span className="font-mono text-sm text-zinc-500">{id}</span>
          </h1>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/memory"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
          >
            Memory inspector
          </Link>
          <Link
            href="/investigate"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
          >
            Investigate
          </Link>
        </div>
      </div>

      <FindingExperience findingId={id} />
    </div>
  );
}
