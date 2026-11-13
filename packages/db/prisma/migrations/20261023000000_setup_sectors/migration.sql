-- Setups can watch whole sectors (e.g. "AI & data"): the scanner adds each sector's most traded coins.
ALTER TABLE "setups" ADD COLUMN "sectors" TEXT[] DEFAULT ARRAY[]::TEXT[];
