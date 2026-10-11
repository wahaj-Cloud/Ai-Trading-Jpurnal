import type { User, UserJSON } from "@clerk/backend";

/** Identity-provider-agnostic profile. Keeps Clerk types out of our domain logic. */
export interface ProviderProfile {
  authProviderId: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  /** The primary email address has been verified by the identity provider. */
  emailVerified: boolean;
  /** When the provider last changed this profile (orders webhook deliveries). */
  updatedAt: Date | null;
}

export function profileFromClerkUser(user: User): ProviderProfile | null {
  const primary = user.primaryEmailAddress;
  const email = primary?.emailAddress;
  if (!email) return null;
  return {
    authProviderId: user.id,
    email: email.toLowerCase(),
    name: user.fullName?.trim() || null,
    imageUrl: user.imageUrl || null,
    emailVerified: primary?.verification?.status === "verified",
    updatedAt: user.updatedAt ? new Date(user.updatedAt) : null,
  };
}

export function profileFromClerkJson(data: UserJSON): ProviderProfile | null {
  const primary = data.email_addresses.find((e) => e.id === data.primary_email_address_id);
  const email = primary?.email_address;
  if (!email) return null;
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  return {
    authProviderId: data.id,
    email: email.toLowerCase(),
    name: name || null,
    imageUrl: data.image_url || null,
    emailVerified: primary?.verification?.status === "verified",
    updatedAt: data.updated_at ? new Date(data.updated_at) : null,
  };
}
