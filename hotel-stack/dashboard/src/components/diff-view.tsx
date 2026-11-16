import { diffCounts, diffLines } from "@/lib/diff";

const CONTEXT = 3;

/** Unified diff of one file with +/- counts; long unchanged runs are folded to CONTEXT lines around changes. */
export function DiffView({ path, before, after, open = true }: { path: string; before: string; after: string; open?: boolean }) {
  const lines = diffLines(before, after);
  const { added, removed } = diffCounts(lines);
  const near = lines.map((_, i) => lines.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((l) => l.kind !== "same"));
  return (
    <details open={open} className="overflow-hidden rounded-lg border border-neutral-200 bg-white text-xs">
      <summary className="flex cursor-pointer items-center gap-2 bg-neutral-50 px-3 py-1.5 font-mono">
        <span className="flex-1 truncate">{path}</span>
        <span className="text-green-700">+{added}</span>
        <span className="text-red-700">-{removed}</span>
      </summary>
      <pre className="max-h-96 overflow-auto font-mono leading-5">
        {lines.map((l, i) => {
          if (!near[i]) return i > 0 && near[i - 1] ? <div key={i} className="px-3 text-neutral-400">⋯</div> : null;
          const tone = l.kind === "add" ? "bg-green-50 text-green-900" : l.kind === "del" ? "bg-red-50 text-red-900" : "text-neutral-600";
          return <div key={i} className={`px-3 whitespace-pre-wrap ${tone}`}>{l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}{l.text}</div>;
        })}
      </pre>
    </details>
  );
}
