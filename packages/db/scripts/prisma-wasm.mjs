// Offline migration tooling built on Prisma's own WebAssembly schema engine, for environments where
// Prisma's native engine binary cannot be downloaded. CI still runs the official `prisma migrate diff`.
//
//   node scripts/prisma-wasm.mjs between <old.prisma> <new.prisma> <empty-db-url>   -> migration SQL
//   node scripts/prisma-wasm.mjs full <schema.prisma> <empty-db-url>               -> full CREATE SQL
//
// The engine needs a database connection even for offline diffs; point it at any empty database.
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { bindMigrationAwareSqlAdapterFactory } from "@prisma/driver-adapter-utils";
import { SchemaEngine } from "@prisma/schema-engine-wasm";

const [command, ...args] = process.argv.slice(2);
const file = (path) => ({ path, content: readFileSync(path, "utf8") });

let from;
let to;
let url;
if (command === "between") {
  const [oldPath, newPath, dbUrl] = args;
  from = { tag: "schemaDatamodel", files: [file(oldPath)] };
  to = { tag: "schemaDatamodel", files: [file(newPath)] };
  url = dbUrl;
} else if (command === "full") {
  const [schemaPath, dbUrl] = args;
  from = { tag: "empty" };
  to = { tag: "schemaDatamodel", files: [file(schemaPath)] };
  url = dbUrl;
} else {
  console.error("Usage: prisma-wasm.mjs between <old> <new> <db-url> | full <schema> <db-url>");
  process.exit(64);
}

const adapter = bindMigrationAwareSqlAdapterFactory(new PrismaPg({ connectionString: url }));
const target = to.files[0];
const engine = await SchemaEngine.new(
  { datamodels: [[target.path, target.content]] },
  () => {},
  adapter,
);
const result = await engine.diff({
  from,
  to,
  script: true,
  exitCode: null,
  shadowDatabaseUrl: null,
  filters: { externalTables: [], externalEnums: [] },
});
process.stdout.write(result.stdout);
process.exit(0);
