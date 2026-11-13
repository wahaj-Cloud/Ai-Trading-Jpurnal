"use client";

// Catches errors in the app's own layout too (e.g. the service is offline while loading the
// signed-in shell), which the (app) segment's error page cannot.
export { ServiceError as default } from "@/components/shell/service-error";
