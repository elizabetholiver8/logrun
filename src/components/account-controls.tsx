import { SyncButton } from "./sync-button";

export function AccountControls({ name, backfillComplete }: { name: string; backfillComplete: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <span className="text-neutral-600">
        Signed in as <strong className="text-neutral-900">{name}</strong>
      </span>
      <SyncButton backfillComplete={backfillComplete} />
      <form action="/auth/logout" method="post">
        <button type="submit" className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100">
          Log out
        </button>
      </form>
    </div>
  );
}
