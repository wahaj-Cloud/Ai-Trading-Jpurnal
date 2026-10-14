import type { ReactNode } from "react";

/** Each auth page renders its own split screen (AuthShell), so the layout adds nothing. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
