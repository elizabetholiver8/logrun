import { SyncButton } from "./sync-button";

export function AccountControls({ name, backfillComplete, demo = false }: { name: string; backfillComplete: boolean; demo?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <span className="text-neutral-600">
        Signed in as <strong className="text-neutral-900">{name}</strong>
      </span>
      {demo ? (
        <button type="button" disabled title="Syncing is off in the demo" className="rounded border border-neutral-300 px-3 py-1 opacity-50">
          Sync new runs
        </button>
      ) : (
        <SyncButton backfillComplete={backfillComplete} />
      )}
      <form action="/auth/logout" method="post">
        <button type="submit" className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100">
          {demo ? "Leave demo" : "Log out"}
        </button>
      </form>
    </div>
  );
}
