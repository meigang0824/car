import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const configPath = join(root, "data/dify-workflows.json");
const faqDir = join(root, "data/faqs");
const backupDir = join(root, "data/backups");

const now = new Date();
const nowSql = now.toISOString().replace("T", " ").replace("Z", "");
const timestamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const batch = `codex_approved_faq_${timestamp}`;

const config = JSON.parse(await readFile(configPath, "utf8"));

const vehicleFileMap = {
  tiger: "tiger_星瑞Plus_FAQ.txt",
  q7: "q7_陆尚_FAQ.txt",
  a8: "a8_CL9_FAQ.txt",
  t5: "t5_H6_FAQ.txt",
  k3: "k3_乐萌_FAQ.txt",
};

const psql = (args, input = "") => {
  const result = spawnSync(
    "docker",
    ["exec", "-i", "docker-db_postgres-1", "psql", "-U", "postgres", "-d", "dify", ...args],
    { input, encoding: "utf8", maxBuffer: 80_000_000 },
  );
  if (result.status !== 0) {
    throw new Error(`${result.stderr || result.stdout}`);
  }
  return result.stdout;
};

const sqlString = (value) => {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
};

const splitFaqSegments = (content) => {
  const lines = content.split(/\r?\n/);
  const pairs = [];
  let current = [];
  for (const line of lines) {
    if (/^Q\d+：/.test(line)) {
      if (current.length) pairs.push(current.join("\n").trim());
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) pairs.push(current.join("\n").trim());
  if (pairs.length !== 100) {
    throw new Error(`expected 100 FAQ pairs, got ${pairs.length}`);
  }
  return pairs;
};

const keywordCandidates = (vehicleName, content) => {
  const base = [
    vehicleName,
    "FAQ",
    "导购",
    "话术",
    "客户",
    "配置",
    "价格",
    "售后",
    "对比",
    "动力",
    "续航",
    "减震",
    "轮胎",
    "大灯",
    "仪表",
    "尺寸",
    "载重",
    "成交",
  ];
  const found = new Set(base.filter((word) => content.includes(word)));
  for (const match of content.matchAll(/[A-Za-z0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?(?:W|V|mm|kg|km\/h)?/g)) {
    const word = match[0];
    if (word.length >= 2) found.add(word);
  }
  for (const word of ["多少钱", "贵", "优惠", "适合", "老人", "接孩子", "乡镇", "短途", "上下班", "保养", "维修", "试骑", "安全", "稳定", "舒适"]) {
    if (content.includes(word)) found.add(word);
  }
  for (const match of content.matchAll(/^Q\d+：(.+)$/gm)) {
    const question = match[1];
    for (const word of question.split(/[，。？?、\s]+/).filter(Boolean)) {
      if (word.length >= 2) found.add(word.slice(0, 20));
    }
    for (let i = 0; i < question.length - 1; i += 2) {
      const phrase = question.slice(i, i + 4).replace(/[，。？?、\s]/g, "");
      if (phrase.length >= 2) found.add(phrase);
    }
  }
  return [...found].slice(0, 40);
};

await mkdir(backupDir, { recursive: true });

const faqDocNames = Object.values(config.bindings).map((binding) => `${binding.vehicleName}_FAQ.txt`);
const docNamesSql = faqDocNames.map(sqlString).join(",");
const datasetIds = Object.values(config.bindings).map((binding) => binding.vehicleDatasetId);
const datasetIdsSql = datasetIds.map(sqlString).join(",");

const backupSql = (table, where) =>
  `copy (select * from ${table} where ${where}) to stdout with csv header`;

const backupTargets = [
  ["documents", `dataset_id in (${datasetIdsSql}) and (name in (${docNamesSql}) or data_source_info::text like '%codex-approved-faq%')`],
  ["document_segments", `dataset_id in (${datasetIdsSql}) and document_id in (select id from documents where dataset_id in (${datasetIdsSql}) and (name in (${docNamesSql}) or data_source_info::text like '%codex-approved-faq%'))`],
  ["document_segment_summaries", `document_id in (select id from documents where dataset_id in (${datasetIdsSql}) and (name in (${docNamesSql}) or data_source_info::text like '%codex-approved-faq%'))`],
  ["segment_attachment_bindings", `document_id in (select id from documents where dataset_id in (${datasetIdsSql}) and (name in (${docNamesSql}) or data_source_info::text like '%codex-approved-faq%'))`],
  ["document_pipeline_execution_logs", `document_id in (select id from documents where dataset_id in (${datasetIdsSql}) and (name in (${docNamesSql}) or data_source_info::text like '%codex-approved-faq%'))`],
  ["dataset_keyword_tables", `dataset_id in (${datasetIdsSql})`],
];

for (const [table, where] of backupTargets) {
  const csv = psql(["-c", backupSql(table, where)]);
  await writeFile(join(backupDir, `dify-faq-sync-${timestamp}-${table}.csv`), csv, "utf8");
}

const rows = psql([
  "-t",
  "-A",
  "-F",
  "\t",
  "-c",
  `select id, tenant_id, name, created_by from datasets where id in (${datasetIdsSql}) order by name`,
]).trim().split("\n").filter(Boolean).map((line) => {
  const [id, tenantId, name, createdBy] = line.split("\t");
  return { id, tenantId, name, createdBy };
});

const datasetMeta = new Map(rows.map((row) => [row.id, row]));

const statements = ["BEGIN;"];

statements.push(`
WITH faq_docs AS (
  SELECT id
  FROM documents
  WHERE dataset_id IN (${datasetIdsSql})
    AND (name IN (${docNamesSql}) OR data_source_info::text LIKE '%codex-approved-faq%')
), faq_segments AS (
  SELECT id
  FROM document_segments
  WHERE document_id IN (SELECT id FROM faq_docs)
)
DELETE FROM document_segment_summaries
WHERE document_id IN (SELECT id FROM faq_docs)
   OR chunk_id IN (SELECT id FROM faq_segments);
`);

statements.push(`
WITH faq_docs AS (
  SELECT id
  FROM documents
  WHERE dataset_id IN (${datasetIdsSql})
    AND (name IN (${docNamesSql}) OR data_source_info::text LIKE '%codex-approved-faq%')
), faq_segments AS (
  SELECT id
  FROM document_segments
  WHERE document_id IN (SELECT id FROM faq_docs)
)
DELETE FROM segment_attachment_bindings
WHERE document_id IN (SELECT id FROM faq_docs)
   OR segment_id IN (SELECT id FROM faq_segments);
`);

statements.push(`
WITH faq_docs AS (
  SELECT id
  FROM documents
  WHERE dataset_id IN (${datasetIdsSql})
    AND (name IN (${docNamesSql}) OR data_source_info::text LIKE '%codex-approved-faq%')
)
DELETE FROM document_pipeline_execution_logs
WHERE document_id IN (SELECT id FROM faq_docs);
`);

statements.push(`
WITH faq_docs AS (
  SELECT id
  FROM documents
  WHERE dataset_id IN (${datasetIdsSql})
    AND (name IN (${docNamesSql}) OR data_source_info::text LIKE '%codex-approved-faq%')
)
DELETE FROM document_segments
WHERE document_id IN (SELECT id FROM faq_docs);
`);

statements.push(`
DELETE FROM documents
WHERE dataset_id IN (${datasetIdsSql})
  AND (name IN (${docNamesSql}) OR data_source_info::text LIKE '%codex-approved-faq%');
`);

const inserted = [];

for (const [vehicleId, binding] of Object.entries(config.bindings)) {
  const datasetId = binding.vehicleDatasetId;
  const meta = datasetMeta.get(datasetId);
  if (!meta) throw new Error(`dataset not found: ${datasetId}`);

  const fileName = vehicleFileMap[vehicleId];
  const faqContent = await readFile(join(faqDir, fileName), "utf8");
  const chunks = splitFaqSegments(faqContent);
  const docId = randomUUID();
  const docName = `${binding.vehicleName}_FAQ.txt`;
  const wordCount = faqContent.length;
  const tokens = Math.ceil(faqContent.length * 1.35);

  statements.push(`
INSERT INTO documents (
  id, tenant_id, dataset_id, position, data_source_type, data_source_info, batch, name,
  created_from, created_by, created_at, processing_started_at, word_count,
  parsing_completed_at, cleaning_completed_at, splitting_completed_at, tokens,
  indexing_latency, completed_at, is_paused, indexing_status, enabled, archived,
  updated_at, doc_form, doc_language, need_summary
) VALUES (
  ${sqlString(docId)}, ${sqlString(meta.tenantId)}, ${sqlString(datasetId)}, 99,
  'upload_file', '{"source":"codex-approved-faq","generated_at":${JSON.stringify(now.toISOString())}}',
  ${sqlString(batch)}, ${sqlString(docName)}, 'web', ${sqlString(meta.createdBy)}, ${sqlString(nowSql)}, ${sqlString(nowSql)},
  ${wordCount}, ${sqlString(nowSql)}, ${sqlString(nowSql)}, ${sqlString(nowSql)}, ${tokens},
  0, ${sqlString(nowSql)}, false, 'completed', true, false, ${sqlString(nowSql)},
  'text_model', 'Chinese', false
);
`);

  chunks.forEach((chunk, index) => {
    const segmentId = randomUUID();
    const indexNodeId = randomUUID();
    const hash = createHash("md5").update(chunk).digest("hex");
    const keywords = keywordCandidates(binding.vehicleName, chunk);
    inserted.push({
      datasetId,
      documentId: docId,
      segmentId,
      indexNodeId,
      keywords,
    });
    statements.push(`
INSERT INTO document_segments (
  id, tenant_id, dataset_id, document_id, position, content, word_count, tokens,
  keywords, index_node_id, index_node_hash, hit_count, enabled, status, created_by,
  created_at, indexing_at, completed_at, updated_at
) VALUES (
  ${sqlString(segmentId)}, ${sqlString(meta.tenantId)}, ${sqlString(datasetId)}, ${sqlString(docId)},
  ${index + 1}, ${sqlString(chunk)}, ${chunk.length}, ${Math.ceil(chunk.length * 1.35)},
  ${sqlString(JSON.stringify(keywords))}::json, ${sqlString(indexNodeId)}, ${sqlString(hash)},
  0, true, 'completed', ${sqlString(meta.createdBy)}, ${sqlString(nowSql)}, ${sqlString(nowSql)},
  ${sqlString(nowSql)}, ${sqlString(nowSql)}
);
`);
  });
}

statements.push("COMMIT;");

psql(["-v", "ON_ERROR_STOP=1"], statements.join("\n"));

const segmentRows = psql([
  "-t",
  "-A",
  "-F",
  "\t",
  "-c",
  `select dataset_id, index_node_id, keywords::text from document_segments where dataset_id in (${datasetIdsSql}) and enabled=true and status='completed' order by dataset_id, position`,
]).trim().split("\n").filter(Boolean);

const tables = new Map(datasetIds.map((id) => [id, {}]));
for (const line of segmentRows) {
  const [datasetId, indexNodeId, keywordText] = line.split("\t");
  let keywords = [];
  try {
    keywords = JSON.parse(keywordText);
  } catch {}
  for (const keyword of keywords) {
    if (!keyword) continue;
    const table = tables.get(datasetId) ?? {};
    table[keyword] ??= [];
    if (!table[keyword].includes(indexNodeId)) table[keyword].push(indexNodeId);
    tables.set(datasetId, table);
  }
}

const keywordStatements = ["BEGIN;"];
for (const datasetId of datasetIds) {
  const payload = {
    __type__: "keyword_table",
    __data__: {
      index_id: datasetId,
      summary: null,
      table: tables.get(datasetId) ?? {},
    },
  };
  keywordStatements.push(`
INSERT INTO dataset_keyword_tables (id, dataset_id, keyword_table, data_source_type)
VALUES (${sqlString(randomUUID())}, ${sqlString(datasetId)}, ${sqlString(JSON.stringify(payload))}, 'database')
ON CONFLICT (dataset_id) DO UPDATE SET keyword_table = EXCLUDED.keyword_table;
`);
}
keywordStatements.push("COMMIT;");
psql(["-v", "ON_ERROR_STOP=1"], keywordStatements.join("\n"));

console.log(`synced=${Object.keys(config.bindings).length}`);
console.log(`documents=${Object.keys(config.bindings).length}`);
console.log(`segments=${inserted.length}`);
console.log(`batch=${batch}`);
