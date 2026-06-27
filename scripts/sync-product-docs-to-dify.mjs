import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(join(root, "data/dify-workflows.json"), "utf8"));
const catalog = JSON.parse(await readFile(join(root, "data/catalog.json"), "utf8"));
const backupDir = join(root, "data/backups");
const now = new Date();
const nowSql = now.toISOString().replace("T", " ").replace("Z", "");
const timestamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const batch = `codex_approved_product_${timestamp}`;

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

const specMap = (vehicle) => Object.fromEntries(vehicle.specs);
const spec = (vehicle, key) => specMap(vehicle)[key] ?? "";
const datasetIds = Object.values(config.bindings).map((binding) => binding.vehicleDatasetId);
const datasetIdsSql = datasetIds.map(sqlString).join(",");

const docNameFor = (vehicle) => {
  if (vehicle.id === "tiger") return "XR-PLUS_星瑞Plus_产品参数.txt";
  if (vehicle.id === "q7") return "LUSHANG_陆尚_产品参数.txt";
  if (vehicle.id === "a8") return "CL9_CL9_产品参数.txt";
  if (vehicle.id === "t5") return "H6_H6_产品参数.txt";
  if (vehicle.id === "k3") return "LEMENG_乐萌_产品参数.txt";
  return `${vehicle.name}_产品参数.txt`;
};

const scenesFor = (vehicle) => {
  if (vehicle.id === "q7") return "乡镇道路、高频代步、偶尔轻载和日常接送";
  if (vehicle.id === "a8") return "看重外观质感、坐乘舒适和门店利润款推荐";
  if (vehicle.id === "t5") return "老人代步、社区短途、买菜和小区周边出行";
  if (vehicle.id === "k3") return "活动引流、价格敏感客户和短途基础代步";
  return "家庭代步、接送孩子、买菜和带老人短途出行";
};

const productSegments = (vehicle) => [
  [
    `# ${vehicle.name} 产品参数与定位`,
    "",
    `车型：${vehicle.name}`,
    `系列：${vehicle.series}`,
    `主推口径：${vehicle.slogan}`,
    `适合场景：${scenesFor(vehicle)}`,
    `价格口径：${vehicle.dealerPolicy}`,
    "",
    "后台配置参数：",
    ...vehicle.specs.map(([key, value]) => `- ${key}：${value}`),
    "",
    "导购提醒：参数必须按后台配置讲，不要补充资料里没有的峰值功率、车架厚度、刹车结构、烤漆工艺、续航里程或保修时长。",
  ].join("\n"),
  [
    `# ${vehicle.name} 核心配置讲法`,
    "",
    `电压：${spec(vehicle, "电压")}`,
    `控制器：${spec(vehicle, "控制器")}`,
    `电机：${spec(vehicle, "电机")}`,
    `减震：${spec(vehicle, "减震")}`,
    `轮胎：${spec(vehicle, "轮胎")}`,
    `速度：${spec(vehicle, "速度")}`,
    `尺寸：${spec(vehicle, "尺寸")}`,
    `轴距：${spec(vehicle, "轴距")}`,
    `轮距：${spec(vehicle, "轮距")}`,
    `载重：${spec(vehicle, "重量")}`,
    `灯光：${spec(vehicle, "大灯")}`,
    `仪表：${spec(vehicle, "仪表")}`,
    "",
    "门店讲法：不要让经销商背参数，要把配置翻译成使用价值。电机讲起步和带人的底气；减震讲少颠、坐着稳；轮胎讲抓地和省心；大灯讲晚上看得清；尺寸讲停车、转弯和上下车是否合适。",
  ].join("\n"),
  [
    `# ${vehicle.name} 常用导购问答`,
    "",
    `问：${vehicle.name}一句话怎么介绍？`,
    `答：${vehicle.name}是${vehicle.series}，主推${vehicle.slogan}，适合${scenesFor(vehicle)}。`,
    "",
    `问：${vehicle.name}多少钱？`,
    `答：${vehicle.dealerPolicy}`,
    "",
    `问：${vehicle.name}减震怎么样？`,
    `答：${vehicle.name}减震是${spec(vehicle, "减震")}。可以让客户坐上去试一下，重点讲少颠、坐着稳，日常接送和买菜更舒服。`,
    "",
    `问：${vehicle.name}电机是什么配置？`,
    `答：${vehicle.name}电机是${spec(vehicle, "电机")}。跟客户讲起步、带人和日常代步是否够用，不要延伸资料里没有的额外功率参数。`,
    "",
    `问：客户拿${vehicle.name}和别家比怎么办？`,
    `答：先问客户用途，再围绕${spec(vehicle, "电机")}、${spec(vehicle, "减震")}、${spec(vehicle, "轮胎")}、价格和门店服务做对比，不攻击竞品。`,
  ].join("\n"),
];

const keywordsFor = (vehicle, content) => {
  const words = new Set([
    vehicle.name,
    "产品参数",
    "导购",
    "配置",
    "价格",
    "电机",
    "控制器",
    "减震",
    "轮胎",
    "尺寸",
    "轴距",
    "轮距",
    "载重",
    "大灯",
    "仪表",
    "适合",
    "客户",
  ]);
  for (const [key, value] of vehicle.specs) {
    words.add(key);
    words.add(value);
  }
  for (const match of content.matchAll(/[A-Za-z0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?(?:W|V|mm|kg|km\/h)?/g)) {
    if (match[0].length >= 2) words.add(match[0]);
  }
  return [...words].slice(0, 40);
};

await mkdir(backupDir, { recursive: true });

const backupTargets = [
  ["documents", `dataset_id in (${datasetIdsSql}) and name not like '%FAQ%'`],
  ["document_segments", `dataset_id in (${datasetIdsSql}) and document_id in (select id from documents where dataset_id in (${datasetIdsSql}) and name not like '%FAQ%')`],
  ["dataset_keyword_tables", `dataset_id in (${datasetIdsSql})`],
];

for (const [table, where] of backupTargets) {
  const csv = psql(["-c", `copy (select * from ${table} where ${where}) to stdout with csv header`]);
  await writeFile(join(backupDir, `dify-product-sync-${timestamp}-${table}.csv`), csv, "utf8");
}

const datasetRows = psql([
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
const datasetMeta = new Map(datasetRows.map((row) => [row.id, row]));

const statements = ["BEGIN;"];

statements.push(`
WITH product_docs AS (
  SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql}) AND name NOT LIKE '%FAQ%'
), product_segments AS (
  SELECT id FROM document_segments WHERE document_id IN (SELECT id FROM product_docs)
)
DELETE FROM document_segment_summaries
WHERE document_id IN (SELECT id FROM product_docs)
   OR chunk_id IN (SELECT id FROM product_segments);
`);
statements.push(`
WITH product_docs AS (
  SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql}) AND name NOT LIKE '%FAQ%'
), product_segments AS (
  SELECT id FROM document_segments WHERE document_id IN (SELECT id FROM product_docs)
)
DELETE FROM segment_attachment_bindings
WHERE document_id IN (SELECT id FROM product_docs)
   OR segment_id IN (SELECT id FROM product_segments);
`);
statements.push(`
WITH product_docs AS (
  SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql}) AND name NOT LIKE '%FAQ%'
)
DELETE FROM document_pipeline_execution_logs
WHERE document_id IN (SELECT id FROM product_docs);
`);
statements.push(`
WITH product_docs AS (
  SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql}) AND name NOT LIKE '%FAQ%'
)
DELETE FROM document_segments
WHERE document_id IN (SELECT id FROM product_docs);
`);
statements.push(`DELETE FROM documents WHERE dataset_id IN (${datasetIdsSql}) AND name NOT LIKE '%FAQ%';`);

for (const [vehicleId, binding] of Object.entries(config.bindings)) {
  const vehicle = catalog.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) throw new Error(`vehicle missing: ${vehicleId}`);
  const meta = datasetMeta.get(binding.vehicleDatasetId);
  if (!meta) throw new Error(`dataset missing: ${binding.vehicleDatasetId}`);
  const segments = productSegments(vehicle);
  const docId = randomUUID();
  const fullText = segments.join("\n\n");
  statements.push(`
INSERT INTO documents (
  id, tenant_id, dataset_id, position, data_source_type, data_source_info, batch, name,
  created_from, created_by, created_at, processing_started_at, word_count,
  parsing_completed_at, cleaning_completed_at, splitting_completed_at, tokens,
  indexing_latency, completed_at, is_paused, indexing_status, enabled, archived,
  updated_at, doc_form, doc_language, need_summary
) VALUES (
  ${sqlString(docId)}, ${sqlString(meta.tenantId)}, ${sqlString(binding.vehicleDatasetId)}, 1,
  'upload_file', '{"source":"codex-approved-product","generated_at":${JSON.stringify(now.toISOString())}}',
  ${sqlString(batch)}, ${sqlString(docNameFor(vehicle))}, 'web', ${sqlString(meta.createdBy)}, ${sqlString(nowSql)}, ${sqlString(nowSql)},
  ${fullText.length}, ${sqlString(nowSql)}, ${sqlString(nowSql)}, ${sqlString(nowSql)}, ${Math.ceil(fullText.length * 1.35)},
  0, ${sqlString(nowSql)}, false, 'completed', true, false, ${sqlString(nowSql)}, 'text_model', 'Chinese', false
);
`);
  segments.forEach((content, index) => {
    const segmentId = randomUUID();
    const indexNodeId = randomUUID();
    const hash = createHash("md5").update(content).digest("hex");
    const keywords = keywordsFor(vehicle, content);
    statements.push(`
INSERT INTO document_segments (
  id, tenant_id, dataset_id, document_id, position, content, word_count, tokens,
  keywords, index_node_id, index_node_hash, hit_count, enabled, status, created_by,
  created_at, indexing_at, completed_at, updated_at
) VALUES (
  ${sqlString(segmentId)}, ${sqlString(meta.tenantId)}, ${sqlString(binding.vehicleDatasetId)}, ${sqlString(docId)},
  ${index + 1}, ${sqlString(content)}, ${content.length}, ${Math.ceil(content.length * 1.35)},
  ${sqlString(JSON.stringify(keywords))}::json, ${sqlString(indexNodeId)}, ${sqlString(hash)}, 0,
  true, 'completed', ${sqlString(meta.createdBy)}, ${sqlString(nowSql)}, ${sqlString(nowSql)}, ${sqlString(nowSql)}, ${sqlString(nowSql)}
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
DELETE FROM dataset_keyword_tables WHERE dataset_id = ${sqlString(datasetId)};
INSERT INTO dataset_keyword_tables (id, dataset_id, keyword_table, data_source_type)
VALUES (${sqlString(randomUUID())}, ${sqlString(datasetId)}, ${sqlString(JSON.stringify(payload))}, 'database');
`);
}
keywordStatements.push("COMMIT;");
psql(["-v", "ON_ERROR_STOP=1"], keywordStatements.join("\n"));

console.log(`syncedProducts=${Object.keys(config.bindings).length}`);
console.log(`segments=${Object.keys(config.bindings).length * 3}`);
console.log(`batch=${batch}`);
