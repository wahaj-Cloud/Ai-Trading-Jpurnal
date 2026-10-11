import type { Request } from "express";

export interface AuthenticatedUser {
  id: string;
  authProviderId: string;
  role: "USER" | "ADMIN";
}

export interface AppRequest extends Request {
  requestId: string;
  user?: AuthenticatedUser;
}

export function requestMeta(req: AppRequest): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.get("user-agent")?.slice(0, 512) ?? null };
}
