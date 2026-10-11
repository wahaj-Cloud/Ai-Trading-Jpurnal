import "server-only";
import type { MeResponse } from "@atc/shared";
import { cache } from "react";
import { apiFetch } from "./api";

/** Deduplicated per request: layout and page share one API call. */
export const getMe = cache(() => apiFetch<MeResponse>("/v1/me"));
