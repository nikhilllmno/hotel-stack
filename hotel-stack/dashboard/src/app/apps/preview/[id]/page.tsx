import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { core, type ChangeDetail } from "@/lib/api";
import { Loading } from "@/components/ui";
import { AppFrame } from "../../[slug]/app-frame";

/** Try a proposed mini app before approving: live data, buttons off; public pages see only public data. */
async function Content(props: PageProps<"/apps/preview/[id]">) {
  const { id } = await props.params;
  const change = await core.get<ChangeDetail & { proposal: { title: string; for_guests: boolean } }>(`/api/changes/${Number(id)}`);
  const html = change.files[0]?.after ?? "";
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link href={`/changes?id=${change.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Change #{change.id}</Link>
        <h1 className="text-lg font-semibold">Preview: {change.proposal.title}</h1>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
          {change.proposal.for_guests ? "public page preview: public data only" : "preview: live data, buttons off until approved"}
        </span>
      </div>
      <AppFrame html={html} title={`Preview ${change.proposal.title}`} mode={change.proposal.for_guests ? "public-preview" : "preview"} />
    </>
  );
}

export default function Page(props: PageProps<"/apps/preview/[id]">) {
  return <Suspense fallback={<Loading />}><Content {...props} /></Suspense>;
}
