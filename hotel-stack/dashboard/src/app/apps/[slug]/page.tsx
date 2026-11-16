import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { core, type MiniApp } from "@/lib/api";
import { Loading } from "@/components/ui";
import { AppFrame } from "./app-frame";

async function Content(props: PageProps<"/apps/[slug]">) {
  const { slug } = await props.params;
  const app = await core.get<MiniApp>(`/api/apps/${encodeURIComponent(slug)}`);
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/apps" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Apps</Link>
          <h1 className="text-lg font-semibold">{app.title}</h1>
          <span className="text-xs text-muted-foreground">v{app.version}</span>
        </div>
        {app.public_url && <a href={app.public_url} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">Public link</a>}
      </div>
      <AppFrame html={app.html} title={app.title} />
    </>
  );
}

export default function Page(props: PageProps<"/apps/[slug]">) {
  return <Suspense fallback={<Loading />}><Content {...props} /></Suspense>;
}
