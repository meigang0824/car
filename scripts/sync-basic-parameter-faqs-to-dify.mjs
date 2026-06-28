import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import catalog from "../data/catalog.json" with { type: "json" };
import config from "../data/dify-workflows.json" with { type: "json" };

const root = resolve(import.meta.dirname, "..");
const backupDir = join(root, "data/backups");
const generatedDir = join(root, "data/faqs/basic-parameters");
const now = new Date();
const nowSql = now.toISOString().replace("T", " ").replace("Z", "");
const timestamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const batch = `codex_basic_parameter_faq_${timestamp}`;

const psql = (args, input = "") => {
  const result = spawnSync(
    "docker",
    ["exec", "-i", "docker-db_postgres-1", "psql", "-U", "postgres", "-d", "dify", ...args],
    { input, encoding: "utf8", maxBuffer: 100_000_000 },
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

const scenesFor = (vehicle) => {
  if (vehicle.id === "q7") return "乡镇道路、高频代步、偶尔轻载和日常接送";
  if (vehicle.id === "a8") return "看重外观质感、坐乘舒适和门店利润款推荐";
  if (vehicle.id === "t5") return "老人代步、社区短途、买菜和小区周边出行";
  if (vehicle.id === "k3") return "活动引流、价格敏感客户和短途基础代步";
  return "家庭代步、接送孩子、买菜和带老人短途出行";
};

const qa = (question, answer, aliases = []) =>
  [
    `Q：${question}`,
    aliases.length ? `同义问法：${aliases.join("；")}` : "",
    `A：${answer}`,
  ].filter(Boolean).join("\n");

const basicSegments = (vehicle) => [
  qa(
    `${vehicle.name}电机多少瓦？`,
    `${vehicle.name}电机是${spec(vehicle, "电机")}。给经销商讲时，先报准确参数，再补一句客户能听懂的话：它影响起步、带人和日常代步的底气，建议让客户现场试一下起步和平顺感。`,
    [`${vehicle.name}电机多大？`, `${vehicle.name}电机是什么配置？`, `${vehicle.name}功率多少？`, `${vehicle.name}多少W？`],
  ),
  qa(
    `${vehicle.name}电压是多少？`,
    `${vehicle.name}电压是${spec(vehicle, "电压")}。可以告诉经销商，电压是整车动力平台的一部分，要和控制器、电机一起看，不要单独夸大。`,
    [`${vehicle.name}多少伏？`, `${vehicle.name}电瓶电压多少？`],
  ),
  qa(
    `${vehicle.name}控制器是什么配置？`,
    `${vehicle.name}控制器是${spec(vehicle, "控制器")}。门店讲法可以落到骑行稳定性和动力输出上，不用讲太深的技术词。`,
    [`${vehicle.name}控制器几管？`, `${vehicle.name}电控什么配置？`],
  ),
  qa(
    `${vehicle.name}减震怎么样？`,
    `${vehicle.name}减震是${spec(vehicle, "减震")}。可以让客户坐上去感受一下，重点讲少颠、坐着稳，日常接送、买菜和短途骑行更舒服。`,
    [`${vehicle.name}避震怎么样？`, `${vehicle.name}颠不颠？`, `${vehicle.name}悬挂怎么样？`],
  ),
  qa(
    `${vehicle.name}轮胎是什么规格？`,
    `${vehicle.name}轮胎是${spec(vehicle, "轮胎")}。跟客户讲时可以结合抓地、稳定和日常路况，不要只报规格。`,
    [`${vehicle.name}轮子多大？`, `${vehicle.name}真空胎吗？`, `${vehicle.name}胎是什么规格？`],
  ),
  qa(
    `${vehicle.name}速度多少？`,
    `${vehicle.name}速度参数是${spec(vehicle, "速度")}。门店讲法要稳一点，告诉经销商按合规、安全和实际路况来介绍，不要鼓励客户追求速度。`,
    [`${vehicle.name}最快多少？`, `${vehicle.name}时速多少？`, `${vehicle.name}跑多快？`],
  ),
  qa(
    `${vehicle.name}尺寸是多少？`,
    `${vehicle.name}整车尺寸是${spec(vehicle, "尺寸")}。可以结合停车、转弯、进出小区和家里存放空间来讲，让客户判断是否合适。`,
    [`${vehicle.name}长宽高多少？`, `${vehicle.name}车身多大？`, `${vehicle.name}大小是多少？`],
  ),
  qa(
    `${vehicle.name}轴距是多少？`,
    `${vehicle.name}轴距是${spec(vehicle, "轴距")}。导购可以把它和车身稳定、坐姿空间联系起来讲，不用让客户硬记参数。`,
    [`${vehicle.name}前后轮距离多少？`],
  ),
  qa(
    `${vehicle.name}轮距是多少？`,
    `${vehicle.name}轮距是${spec(vehicle, "轮距")}。可以结合车身宽度、骑行稳定感和日常通过性来解释。`,
    [`${vehicle.name}车宽多少？`, `${vehicle.name}左右轮距离多少？`],
  ),
  qa(
    `${vehicle.name}仪表是什么配置？`,
    `${vehicle.name}仪表是${spec(vehicle, "仪表")}。可以讲客户日常看电量、速度和状态更直观，用车更省心。`,
    [`${vehicle.name}显示屏是什么？`, `${vehicle.name}仪表盘怎么样？`],
  ),
  qa(
    `${vehicle.name}大灯是什么配置？`,
    `${vehicle.name}大灯是${spec(vehicle, "大灯")}。门店话术可以说晚上看得更清楚，接孩子、买菜或傍晚骑行更安心。`,
    [`${vehicle.name}灯光怎么样？`, `${vehicle.name}照明怎么样？`, `${vehicle.name}有没有LED灯？`],
  ),
  qa(
    `${vehicle.name}载重多少？`,
    `${vehicle.name}载重参数是${spec(vehicle, "重量")}。涉及带人、载物和长期高负荷使用时，要提醒经销商按合理载重和厂家口径讲。`,
    [`${vehicle.name}承重多少？`, `${vehicle.name}能拉多重？`, `${vehicle.name}重量多少？`],
  ),
  qa(
    `${vehicle.name}多少钱？`,
    `${vehicle.dealerPolicy} 价格问题要按门店政策和厂家最新口径确认，不要随口承诺额外优惠。`,
    [`${vehicle.name}价格多少？`, `${vehicle.name}怎么卖？`, `${vehicle.name}成交价多少？`, `${vehicle.name}活动价多少？`],
  ),
  qa(
    `${vehicle.name}核心配置有哪些？`,
    `${vehicle.name}核心配置可以抓${spec(vehicle, "电机")}、${spec(vehicle, "控制器")}、${spec(vehicle, "减震")}、${spec(vehicle, "轮胎")}、${spec(vehicle, "大灯")}来讲。主推场景是${scenesFor(vehicle)}。`,
    [`${vehicle.name}主要配置？`, `${vehicle.name}配置怎么讲？`, `${vehicle.name}有什么卖点？`],
  ),
];

const keywordsFor = (vehicle, content) => {
  const words = new Set([
    vehicle.name,
    "基础参数FAQ",
    "FAQ",
    "电机",
    "多少瓦",
    "多少W",
    "功率",
    "价格",
    "多少钱",
    "电压",
    "控制器",
    "减震",
    "轮胎",
    "速度",
    "尺寸",
    "轴距",
    "轮距",
    "仪表",
    "大灯",
    "载重",
    "核心配置",
  ]);
  for (const [key, value] of vehicle.specs) {
    words.add(key);
    words.add(value);
  }
  for (const match of content.matchAll(/[A-Za-z0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?(?:W|V|mm|kg|km\/h)?/g)) {
    if (match[0].length >= 2) words.add(match[0]);
  }
  return [...words].slice(0, 60);
};

await mkdir(backupDir, { recursive: true });
await mkdir(generatedDir, { recursive: true });

const datasetIds = Object.values(config.bindings).map((binding) => binding.vehicleDatasetId);
const datasetIdsSql = datasetIds.map(sqlString).join(",");

for (const table of ["documents", "document_segments", "dataset_keyword_tables"]) {
  const where = table === "dataset_keyword_tables"
    ? `dataset_id in (${datasetIdsSql})`
    : table === "document_segments"
      ? `dataset_id in (${datasetIdsSql}) and document_id in (select id from documents where dataset_id in (${datasetIdsSql}) and data_source_info::text like '%codex-basic-parameter-faq%')`
      : `dataset_id in (${datasetIdsSql}) and data_source_info::text like '%codex-basic-parameter-faq%'`;
  const csv = psql(["-c", `copy (select * from ${table} where ${where}) to stdout with csv header`]);
  await writeFile(join(backupDir, `dify-basic-parameter-faq-sync-${timestamp}-${table}.csv`), csv, "utf8");
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
WITH docs AS (
  SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql}) AND data_source_info::text LIKE '%codex-basic-parameter-faq%'
), segments AS (
  SELECT id FROM document_segments WHERE document_id IN (SELECT id FROM docs)
)
DELETE FROM document_segment_summaries
WHERE document_id IN (SELECT id FROM docs)
   OR chunk_id IN (SELECT id FROM segments);
`);

statements.push(`
WITH docs AS (
  SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql}) AND data_source_info::text LIKE '%codex-basic-parameter-faq%'
), segments AS (
  SELECT id FROM document_segments WHERE document_id IN (SELECT id FROM docs)
)
DELETE FROM segment_attachment_bindings
WHERE document_id IN (SELECT id FROM docs)
   OR segment_id IN (SELECT id FROM segments);
`);

statements.push(`
WITH docs AS (
  SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql}) AND data_source_info::text LIKE '%codex-basic-parameter-faq%'
)
DELETE FROM document_pipeline_execution_logs
WHERE document_id IN (SELECT id FROM docs);
`);

statements.push(`
WITH docs AS (
  SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql}) AND data_source_info::text LIKE '%codex-basic-parameter-faq%'
)
DELETE FROM document_segments
WHERE document_id IN (SELECT id FROM docs);
`);

statements.push(`
DELETE FROM documents
WHERE dataset_id IN (${datasetIdsSql})
  AND data_source_info::text LIKE '%codex-basic-parameter-faq%';
`);

let insertedSegments = 0;

for (const [vehicleId, binding] of Object.entries(config.bindings)) {
  const vehicle = catalog.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) throw new Error(`vehicle missing: ${vehicleId}`);
  const meta = datasetMeta.get(binding.vehicleDatasetId);
  if (!meta) throw new Error(`dataset missing: ${binding.vehicleDatasetId}`);

  const segments = basicSegments(vehicle);
  const docId = randomUUID();
  const docName = `${vehicle.name}_基础参数FAQ.txt`;
  const fullText = segments.join("\n\n");
  await writeFile(join(generatedDir, docName), `${fullText}\n`, "utf8");

  statements.push(`
INSERT INTO documents (
  id, tenant_id, dataset_id, position, data_source_type, data_source_info, batch, name,
  created_from, created_by, created_at, processing_started_at, word_count,
  parsing_completed_at, cleaning_completed_at, splitting_completed_at, tokens,
  indexing_latency, completed_at, is_paused, indexing_status, enabled, archived,
  updated_at, doc_form, doc_language, need_summary
) VALUES (
  ${sqlString(docId)}, ${sqlString(meta.tenantId)}, ${sqlString(binding.vehicleDatasetId)}, 2,
  'upload_file', '{"source":"codex-basic-parameter-faq","generated_at":${JSON.stringify(now.toISOString())}}',
  ${sqlString(batch)}, ${sqlString(docName)}, 'web', ${sqlString(meta.createdBy)}, ${sqlString(nowSql)}, ${sqlString(nowSql)},
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
    insertedSegments += 1;
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
  if (!Array.isArray(keywords)) {
    keywords = Object.keys(keywords ?? {});
  }
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

console.log(`syncedBasicParameterFaqs=${Object.keys(config.bindings).length}`);
console.log(`segments=${insertedSegments}`);
console.log(`batch=${batch}`);
