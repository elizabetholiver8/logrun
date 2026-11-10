import { SITE } from "../../lib/site";

export const metadata = { title: "About · logrun" };

/** Static page: the longer story behind the welcome page's one-line bio. */
export default function AboutPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6 md:p-10">
      <h1 className="text-3xl font-semibold">{SITE.name}</h1>
      {SITE.about.map((p) => (
        <p key={p} className="text-neutral-700">{p}</p>
      ))}
      <div className="preserve-breaks">
        <h1 className="max-w-xl text-neutral-700">{SITE.email}</h1>
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        <a href={SITE.linkedin} target="_blank" rel="noreferrer" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">LinkedIn</a>
        <a href={SITE.repo} target="_blank" rel="noreferrer" className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100">GitHub</a>
      </div>
    </main>
  );
}
