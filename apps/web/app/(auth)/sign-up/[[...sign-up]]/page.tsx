import { LIST_PRICE_USD } from "@atc/shared";
import { SignUp } from "@clerk/nextjs";
import { Sparkles } from "lucide-react";
import { AuthShell } from "@/features/auth/auth-shell";
import { authAppearance } from "@/features/auth/clerk-appearance";

export const metadata = { title: "Create your free account" };

const PAID = {
  pro: { code: "PRO", name: "Pro" },
  premium: { code: "PREMIUM", name: "Premium" },
} as const;

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  const picked = plan === "pro" || plan === "premium" ? PAID[plan] : null;
  return (
    <AuthShell
      mode="sign-up"
      planNote={
        picked && (
          <p className="flex w-full gap-2.5 rounded-xl border border-coach/30 bg-coach/10 px-4 py-3 text-sm">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-coach" aria-hidden="true" />
            <span>
              You picked <span className="font-semibold">{picked.name}</span> ($
              {LIST_PRICE_USD[picked.code]}/month). Create your free account first; next you will
              see the plan ready to check out. Nothing is charged until you confirm.
            </span>
          </p>
        )
      }
    >
      <SignUp
        appearance={authAppearance}
        fallbackRedirectUrl={picked ? `/billing?plan=${picked.code}` : "/dashboard"}
        signInUrl="/sign-in"
      />
    </AuthShell>
  );
}
