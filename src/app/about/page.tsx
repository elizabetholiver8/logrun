import Link from "next/link";
import { SITE } from "../../lib/site";
import { BrandLink } from "@/components/brand-link";

export const metadata = { title: "About me" };

export default function AboutPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-6 md:p-10">
      <header className="flex items-center justify-between gap-4">
        <BrandLink />
        <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">Dashboard</Link>
      </header>
      <h1 className="text-3xl font-semibold">{SITE.name}</h1>
      {SITE.about.map((p) => (
        <p key={p} className="max-w-xl text-neutral-700">{p}</p>
      ))}
      <div className="flex gap-3">
        <a href={SITE.linkedin} target="_blank" rel="noreferrer" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">LinkedIn</a>
        <a href={SITE.github} target="_blank" rel="noreferrer" className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100">GitHub</a>
      </div>
    </main>
  );
}