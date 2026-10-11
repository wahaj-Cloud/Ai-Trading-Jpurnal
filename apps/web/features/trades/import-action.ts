"use server";

import { IMPORT_CHUNK, type ImportResult, parseImportCsv } from "@atc/shared";
import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";

const MAX_BYTES = 1_000_000;

export interface ImportState {
  status: "idle" | "error" | "done";
  message?: string;
  errors?: { line: number; message: string }[];
  result?: ImportResult;
}

/**
 * All or nothing: if any row is invalid, nothing is imported and every problem is listed with its
 * line number, so the user fixes the file and uploads it again (re-uploading never duplicates).
 */
export async function importCsvAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { status: "error", message: "Choose a CSV file to upload." };
  if (file.size > MAX_BYTES)
    return {
      status: "error",
      message: "Files can be up to 1 MB (about 5,000 trades). Split larger files.",
    };

  const { rows, errors } = parseImportCsv(await file.text());
  if (errors.length > 0) {
    return {
      status: "error",
      message: `Nothing was imported. Fix ${errors.length === 1 ? "this row" : `these ${errors.length} rows`} and upload the file again.`,
      errors: errors.slice(0, 50),
    };
  }
  if (rows.length === 0)
    return { status: "error", message: "The file has no trades below the header row." };

  const total: ImportResult = { imported: 0, updated: 0, skippedAlreadySynced: 0 };
  try {
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
      const res = await apiFetch<ImportResult>("/v1/imports/positions", {
        method: "POST",
        body: JSON.stringify({ rows: rows.slice(i, i + IMPORT_CHUNK) }),
      });
      total.imported += res.imported;
      total.updated += res.updated;
      total.skippedAlreadySynced += res.skippedAlreadySynced;
    }
  } catch (err) {
    const done = total.imported + total.updated;
    return {
      status: "error",
      message: `${err instanceof ApiError && err.body?.message ? err.body.message : "The import stopped."} ${done} trades were saved; upload the same file again to finish (nothing is duplicated).`,
    };
  }
  revalidatePath("/trades");
  return { status: "done", result: total };
}
