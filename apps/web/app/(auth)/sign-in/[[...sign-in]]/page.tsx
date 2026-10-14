import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/features/auth/auth-shell";
import { authAppearance } from "@/features/auth/clerk-appearance";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthShell mode="sign-in">
      <SignIn appearance={authAppearance} fallbackRedirectUrl="/dashboard" signUpUrl="/sign-up" />
    </AuthShell>
  );
}
