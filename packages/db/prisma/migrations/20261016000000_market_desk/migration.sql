-- Plan limit: Market Context Desk. Pro and Premium see every desk market; Free keeps Bitcoin.
-- Only fills the key when missing, so a value an admin already set is kept.
UPDATE "plans" SET "limits" = jsonb_build_object('marketDesk', 0) || "limits"::jsonb WHERE "code" = 'FREE';
UPDATE "plans" SET "limits" = jsonb_build_object('marketDesk', 1) || "limits"::jsonb WHERE "code" IN ('PRO', 'PREMIUM', 'ENTERPRISE');
