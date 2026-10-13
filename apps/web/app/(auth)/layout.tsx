import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10">
      <Link href="/" className="mb-10" aria-label="WickMentor home">
        <Wordmark />
      </Link>
      <main className="flex w-full flex-1 justify-center">{children}</main>
    </div>
  );
}
