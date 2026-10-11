import type { UserJSON } from "@clerk/backend";
import { describe, expect, it } from "vitest";
import { profileFromClerkJson } from "./provider-profile.js";

const base = {
  id: "user_1",
  primary_email_address_id: "e2",
  email_addresses: [
    { id: "e1", email_address: "old@example.com" },
    { id: "e2", email_address: "Primary@Example.com" },
  ],
  first_name: "Wahaj",
  last_name: null,
  image_url: "",
} as unknown as UserJSON;

describe("profileFromClerkJson", () => {
  it("uses the primary email, lower-cased", () => {
    expect(profileFromClerkJson(base)?.email).toBe("primary@example.com");
  });
  it("builds a name from available parts and nulls empty images", () => {
    expect(profileFromClerkJson(base)).toMatchObject({ name: "Wahaj", imageUrl: null });
  });
  it("returns null when there is no primary email", () => {
    expect(
      profileFromClerkJson({ ...base, primary_email_address_id: null } as unknown as UserJSON),
    ).toBeNull();
  });
});
