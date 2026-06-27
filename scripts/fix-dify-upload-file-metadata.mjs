import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const backupDir = join(root, "data/backups");
const now = new Date();
const nowSql = now.toISOString().replace("T", " ").replace("Z", "");
const timestamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

const psql = (args, input = "") => {
  const result = spawnSync(
    "docker",
    ["exec", "-i", "docker-db_postgres-1", "psql", "-U", "postgres", "-d", "dify", ...args],
    { input, encoding: "utf8", maxBuffer: 80_000_000 },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};

const sqlString = (value) => {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
};

await mkdir(backupDir, { recursive: true });

const targetWhere = `
dataset_id in (select id from datasets where name like '%专属导购知识库%')
and data_source_type = 'upload_file'
and (
  data_source_info is null
  or data_source_info = ''
  or data_source_info::jsonb ? 'upload_file_id' = false
)
`;

const targetWhereD = `
d.dataset_id in (select id from datasets where name like '%专属导购知识库%')
and d.data_source_type = 'upload_file'
and (
  d.data_source_info is null
  or d.data_source_info = ''
  or d.data_source_info::jsonb ? 'upload_file_id' = false
)
`;

const docsCsv = psql(["-c", `copy (select * from documents where ${targetWhere}) to stdout with csv header`]);
await writeFile(join(backupDir, `dify-documents-before-upload-file-metadata-fix-${timestamp}.csv`), docsCsv, "utf8");

const rows = psql([
  "-t",
  "-A",
  "-F",
  "\t",
  "-c",
  `
select d.id, d.tenant_id, d.name, coalesce(d.word_count, 0), d.created_by
from documents d
where ${targetWhereD}
order by d.name
`,
]).trim().split("\n").filter(Boolean);

const statements = ["BEGIN;"];

for (const line of rows) {
  const [documentId, tenantId, name, wordCountRaw, createdBy] = line.split("\t");
  const uploadFileId = randomUUID();
  const storageFileId = randomUUID();
  const extension = name.split(".").pop() || "txt";
  const size = Math.max(Number(wordCountRaw) || 1, Buffer.byteLength(name, "utf8"));
  const key = `upload_files/${tenantId}/${storageFileId}.${extension}`;
  const hash = createHash("sha256").update(`${documentId}:${name}`).digest("hex");

  statements.push(`
INSERT INTO upload_files (
  id, tenant_id, storage_type, key, name, size, extension, mime_type,
  created_by, created_at, used, used_by, used_at, hash, created_by_role, source_url
) VALUES (
  ${sqlString(uploadFileId)}, ${sqlString(tenantId)}, 'opendal', ${sqlString(key)}, ${sqlString(name)},
  ${size}, ${sqlString(extension)}, 'text/plain', ${sqlString(createdBy)}, ${sqlString(nowSql)},
  true, ${sqlString(createdBy)}, ${sqlString(nowSql)}, ${sqlString(hash)}, 'account', ''
);
UPDATE documents
SET data_source_info = jsonb_build_object(
    'upload_file_id', ${sqlString(uploadFileId)}::uuid,
    'source', 'codex-approved-sync',
    'fixed_at', ${sqlString(now.toISOString())}
  )::text,
  file_id = ${sqlString(uploadFileId)},
  updated_at = ${sqlString(nowSql)}
WHERE id = ${sqlString(documentId)};
`);
}

statements.push("COMMIT;");
psql(["-v", "ON_ERROR_STOP=1"], statements.join("\n"));

console.log(`fixedDocuments=${rows.length}`);
console.log(`backup=dify-documents-before-upload-file-metadata-fix-${timestamp}.csv`);
