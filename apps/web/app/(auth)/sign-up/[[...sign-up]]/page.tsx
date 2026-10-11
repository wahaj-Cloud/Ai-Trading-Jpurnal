import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Create account" };

export default function SignUpPage() {
  return <SignUp fallbackRedirectUrl="/dashboard" signInUrl="/sign-in" />;
}
