import Link from "next/link";

/** The site name as a bordered button that goes home. */
export function BrandLink() {
  return (
    <Link
      href="/"
      className="inline-block rounded border bg-blue-600 px-2 py-1 text-2xl text-white font-semibold hover:bg-blue-700"
    >
      logrun
    </Link>
  );
}