import { Suspense } from "react";
import { SiteHeader } from "../components/site-header";
import "./globals.css";


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<div className="h-14 border-b border-neutral-200" />}>
          <SiteHeader />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
