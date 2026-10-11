import { MAX_SCREENSHOTS } from "@atc/shared";

const text = (form: FormData, name: string) => {
  const v = String(form.get(name) ?? "").trim();
  return v === "" ? null : v;
};

/** FormData -> the API's journal shape. Validation happens once, in the shared schema. */
export function journalFromForm(form: FormData) {
  const rating = text(form, "rating");
  return {
    setup: text(form, "setup"),
    tags: String(form.get("tags") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    emotions: form.getAll("emotions").map(String),
    mistakes: form.getAll("mistakes").map(String),
    rating: rating === null ? null : Number(rating),
    notes: text(form, "notes"),
    stopPrice: text(form, "stopPrice"),
    targetPrice: text(form, "targetPrice"),
    screenshotUrls: String(form.get("screenshotUrls") ?? "")
      .split(/\s+/)
      .map((u) => u.trim())
      .filter(Boolean)
      .slice(0, MAX_SCREENSHOTS + 1), // one over the limit so the schema reports it
  };
}
