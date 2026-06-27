import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const vaultRoot = "/Users/letwx/Documents/Obsidian Vault/宝鸽电动车";
const productDir = join(vaultRoot, "产品参数");
const faqDir = join(vaultRoot, "导购话术");
const backupDir = join(root, "data/backups");
const generatedDir = join(root, "data/obsidian-sync");
const config = JSON.parse(await readFile(join(root, "data/dify-workflows.json"), "utf8"));
const catalogPath = join(root, "data/catalog.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

const now = new Date();
const nowSql = now.toISOString().replace("T", " ").replace("Z", "");
const timestamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const batch = `obsidian_product_faq_${timestamp}`;

const vehicles = [
  {
    id: "tiger",
    name: "星瑞Plus",
    productFile: "星瑞plus_产品参数.md",
    faqFile: "星瑞plus_导购FAQ话术.md",
  },
  { id: "q7", name: "陆尚", productFile: "陆尚_产品参数.md", faqFile: "陆尚_导购FAQ话术.md" },
  { id: "a8", name: "CL9", productFile: "CL9_产品参数.md", faqFile: "CL9_导购FAQ话术.md" },
  { id: "t5", name: "H6", productFile: "H6_产品参数.md", faqFile: "H6_导购FAQ话术.md" },
  { id: "k3", name: "乐萌", productFile: "乐萌_产品参数.md", faqFile: "乐萌_导购FAQ话术.md" },
];

const psql = (args, input = "") => {
  const result = spawnSync(
    "docker",
    ["exec", "-i", "docker-db_postgres-1", "psql", "-U", "postgres", "-d", "dify", ...args],
    { input, encoding: "utf8", maxBuffer: 300_000_000 },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};

const sqlString = (value) => {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
};

const parseBullets = (content) => {
  const values = {};
  for (const match of content.matchAll(/^\* \*\*(.+?)\*\*: (.+)$/gm)) {
    values[match[1].trim()] = match[2].trim();
  }
  return values;
};

const splitProductSections = (content) => {
  const chunks = [];
  const intro = content.split(/\n## /)[0]?.trim();
  if (intro) chunks.push(intro);

  const matches = [...content.matchAll(/^## .+$(?:\n(?!## ).*)*/gm)];
  for (const match of matches) {
    const section = match[0].trim();
    if (section) chunks.push(section);
  }
  return chunks;
};

const splitFaqSections = (content) => {
  const matches = [...content.matchAll(/^### Q\d+:.+$(?:\n(?!### Q\d+:).*)*/gm)];
  const chunks = matches.map((match) => match[0].trim()).filter(Boolean);
  if (chunks.length !== 500) {
    throw new Error(`${basename(content)} expected 500 FAQ sections, got ${chunks.length}`);
  }
  return chunks;
};

const keywordsFor = (vehicleName, content, type) => {
  const words = new Set([
    vehicleName,
    type,
    "宝鸽",
    "BAOGE",
    "产品参数",
    "导购",
    "FAQ",
    "话术",
    "电机",
    "功率",
    "多少瓦",
    "电压",
    "控制器",
    "管数",
    "电池",
    "续航",
    "最高时速",
    "速度",
    "爬坡",
    "载重",
    "刹车",
    "减震",
    "轮胎",
    "灯光",
    "尺寸",
    "价格",
  ]);
  for (const match of content.matchAll(/[A-Za-z0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?(?:W|V|Ah|mm|kg|km\/h)?/g)) {
    if (match[0].length >= 2) words.add(match[0]);
  }
  for (const match of content.matchAll(/^#+\s*(.+)$/gm)) {
    for (const word of match[1].split(/[，。？?、\s:：()（）]+/).filter(Boolean)) {
      if (word.length >= 2) words.add(word.slice(0, 30));
    }
  }
  return [...words].slice(0, 80);
};

const uploadFileSql = ({ uploadFileId, tenantId, name, size, createdBy }) => {
  const extension = name.split(".").pop() || "md";
  const storageFileId = randomUUID();
  const key = `upload_files/${tenantId}/${storageFileId}.${extension}`;
  const hash = createHash("sha256").update(`${uploadFileId}:${name}:${size}`).digest("hex");
  return `
INSERT INTO upload_files (
  id, tenant_id, storage_type, key, name, size, extension, mime_type,
  created_by, created_at, used, used_by, used_at, hash, created_by_role, source_url
) VALUES (
  ${sqlString(uploadFileId)}, ${sqlString(tenantId)}, 'opendal', ${sqlString(key)}, ${sqlString(name)},
  ${size}, ${sqlString(extension)}, 'text/markdown', ${sqlString(createdBy)}, ${sqlString(nowSql)},
  true, ${sqlString(createdBy)}, ${sqlString(nowSql)}, ${sqlString(hash)}, 'account', ''
);
`;
};

const insertDocumentSql = ({
  documentId,
  tenantId,
  datasetId,
  uploadFileId,
  position,
  name,
  createdBy,
  fullText,
}) => `
INSERT INTO documents (
  id, tenant_id, dataset_id, position, data_source_type, data_source_info, batch, name,
  created_from, created_by, created_at, processing_started_at, word_count,
  parsing_completed_at, cleaning_completed_at, splitting_completed_at, tokens,
  indexing_latency, completed_at, is_paused, indexing_status, enabled, archived,
  updated_at, doc_form, doc_language, need_summary, file_id
) VALUES (
  ${sqlString(documentId)}, ${sqlString(tenantId)}, ${sqlString(datasetId)}, ${position},
  'upload_file',
  ${sqlString(JSON.stringify({
    source: "obsidian-baoge",
    generated_at: now.toISOString(),
    upload_file_id: uploadFileId,
  }))},
  ${sqlString(batch)}, ${sqlString(name)}, 'web', ${sqlString(createdBy)}, ${sqlString(nowSql)}, ${sqlString(nowSql)},
  ${fullText.length}, ${sqlString(nowSql)}, ${sqlString(nowSql)}, ${sqlString(nowSql)}, ${Math.ceil(fullText.length * 1.35)},
  0, ${sqlString(nowSql)}, false, 'completed', true, false, ${sqlString(nowSql)},
  'text_model', 'Chinese', false, ${sqlString(uploadFileId)}
);
`;

const compactSpec = (values, key) => values[key] ?? "";
const updateCatalogVehicle = (vehicle, productContent) => {
  const values = parseBullets(productContent);
  const length = compactSpec(values, "整车长度");
  const width = compactSpec(values, "整车宽度");
  const height = compactSpec(values, "整车高度");
  const voltage = compactSpec(values, "额定电压");
  const motorPower = compactSpec(values, "电机功率");
  const motorType = compactSpec(values, "电机类型");
  const controllerType = compactSpec(values, "控制器类型");
  const controllerTubes = compactSpec(values, "管数");
  const frontTire = compactSpec(values, "前轮规格");
  const rearTire = compactSpec(values, "后轮规格");
  const tire = compactSpec(values, "轮胎规格") || (frontTire && rearTire && frontTire === rearTire ? frontTire : [frontTire, rearTire].filter(Boolean).join(" / "));
  const maxSpeed = compactSpec(values, "最高时速");
  const maxLoad = compactSpec(values, "最大载重");
  const price = productContent.match(/## 参考价格\s*\n+([^\n]+)/)?.[1]?.trim() ?? vehicle.price;
  const intro = productContent.match(/^>\s*(.+)$/m)?.[1]?.trim() ?? vehicle.series;

  vehicle.series = intro;
  vehicle.price = price;
  vehicle.slogan = [voltage, motorPower ? `${motorPower}${motorType ? motorType.replace(/电机$/, "电机") : "电机"}` : "", maxSpeed, intro]
    .filter(Boolean)
    .join(" | ");
  vehicle.dealerPolicy = `参考价格：${price}。具体成交价按门店配置、电池规格和当地政策确认。`;
  vehicle.specs = [
    ["电压", voltage],
    ["控制器", [voltage, controllerTubes, controllerType].filter(Boolean).join(" ")],
    ["减震", [compactSpec(values, "前减震"), compactSpec(values, "后减震")].filter(Boolean).join(" / ") || compactSpec(values, "减震效果")],
    ["轮距", compactSpec(values, "轮距")],
    ["电机", [voltage, motorPower, motorType].filter(Boolean).join("")],
    ["轮胎", tire],
    ["速度", maxSpeed],
    ["轴距", compactSpec(values, "轴距")],
    ["仪表", compactSpec(values, "仪表类型") || compactSpec(values, "速度表")],
    ["大灯", compactSpec(values, "前大灯")],
    ["重量", maxLoad ? `${maxLoad}最大载重` : ""],
    ["尺寸", [length, width, height].filter(Boolean).join("*")],
  ];
};

await mkdir(backupDir, { recursive: true });
await mkdir(generatedDir, { recursive: true });

const datasetIds = vehicles.map((vehicle) => config.bindings[vehicle.id]?.vehicleDatasetId).filter(Boolean);
const datasetIdsSql = datasetIds.map(sqlString).join(",");

for (const table of [
  "documents",
  "document_segments",
  "document_segment_summaries",
  "segment_attachment_bindings",
  "document_pipeline_execution_logs",
  "dataset_keyword_tables",
]) {
  const where = table === "dataset_keyword_tables"
    ? `dataset_id in (${datasetIdsSql})`
    : table === "documents"
      ? `dataset_id in (${datasetIdsSql})`
      : table === "document_segments"
        ? `dataset_id in (${datasetIdsSql})`
        : `document_id in (select id from documents where dataset_id in (${datasetIdsSql}))`;
  const csv = psql(["-c", `copy (select * from ${table} where ${where}) to stdout with csv header`]);
  await writeFile(join(backupDir, `dify-before-obsidian-sync-${timestamp}-${table}.csv`), csv, "utf8");
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
WITH docs AS (SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql})),
segments AS (SELECT id FROM document_segments WHERE document_id IN (SELECT id FROM docs))
DELETE FROM document_segment_summaries
WHERE document_id IN (SELECT id FROM docs)
   OR chunk_id IN (SELECT id FROM segments);
`);
statements.push(`
WITH docs AS (SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql})),
segments AS (SELECT id FROM document_segments WHERE document_id IN (SELECT id FROM docs))
DELETE FROM segment_attachment_bindings
WHERE document_id IN (SELECT id FROM docs)
   OR segment_id IN (SELECT id FROM segments);
`);
statements.push(`
WITH docs AS (SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql}))
DELETE FROM document_pipeline_execution_logs
WHERE document_id IN (SELECT id FROM docs);
`);
statements.push(`
WITH docs AS (SELECT id FROM documents WHERE dataset_id IN (${datasetIdsSql}))
DELETE FROM document_segments
WHERE document_id IN (SELECT id FROM docs);
`);
statements.push(`DELETE FROM documents WHERE dataset_id IN (${datasetIdsSql});`);

let documentCount = 0;
let segmentCount = 0;

for (const vehicle of vehicles) {
  const binding = config.bindings[vehicle.id];
  if (!binding) throw new Error(`missing Dify binding for ${vehicle.id}`);
  const meta = datasetMeta.get(binding.vehicleDatasetId);
  if (!meta) throw new Error(`missing dataset for ${vehicle.name}`);

  const productContent = await readFile(join(productDir, vehicle.productFile), "utf8");
  const faqContent = await readFile(join(faqDir, vehicle.faqFile), "utf8");
  await writeFile(join(generatedDir, vehicle.productFile), productContent, "utf8");
  await writeFile(join(generatedDir, vehicle.faqFile), faqContent, "utf8");
  updateCatalogVehicle(catalog.vehicles.find((item) => item.id === vehicle.id), productContent);

  const docs = [
    {
      name: vehicle.productFile,
      position: 1,
      chunks: splitProductSections(productContent),
      fullText: productContent,
      type: "产品参数",
    },
    {
      name: vehicle.faqFile,
      position: 2,
      chunks: splitFaqSections(faqContent),
      fullText: faqContent,
      type: "导购FAQ",
    },
  ];

  for (const doc of docs) {
    const documentId = randomUUID();
    const uploadFileId = randomUUID();
    statements.push(uploadFileSql({
      uploadFileId,
      tenantId: meta.tenantId,
      name: doc.name,
      size: Buffer.byteLength(doc.fullText, "utf8"),
      createdBy: meta.createdBy,
    }));
    statements.push(insertDocumentSql({
      documentId,
      tenantId: meta.tenantId,
      datasetId: binding.vehicleDatasetId,
      uploadFileId,
      position: doc.position,
      name: doc.name,
      createdBy: meta.createdBy,
      fullText: doc.fullText,
    }));
    documentCount += 1;

    doc.chunks.forEach((content, index) => {
      const segmentId = randomUUID();
      const indexNodeId = randomUUID();
      const hash = createHash("md5").update(content).digest("hex");
      const keywords = keywordsFor(vehicle.name, content, doc.type);
      statements.push(`
INSERT INTO document_segments (
  id, tenant_id, dataset_id, document_id, position, content, word_count, tokens,
  keywords, index_node_id, index_node_hash, hit_count, enabled, status, created_by,
  created_at, indexing_at, completed_at, updated_at
) VALUES (
  ${sqlString(segmentId)}, ${sqlString(meta.tenantId)}, ${sqlString(binding.vehicleDatasetId)}, ${sqlString(documentId)},
  ${index + 1}, ${sqlString(content)}, ${content.length}, ${Math.ceil(content.length * 1.35)},
  ${sqlString(JSON.stringify(keywords))}::json, ${sqlString(indexNodeId)}, ${sqlString(hash)}, 0,
  true, 'completed', ${sqlString(meta.createdBy)}, ${sqlString(nowSql)}, ${sqlString(nowSql)}, ${sqlString(nowSql)}, ${sqlString(nowSql)}
);
`);
      segmentCount += 1;
    });
  }
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

catalog.updatedAt = now.toISOString();
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

console.log(`syncedVehicles=${vehicles.length}`);
console.log(`documents=${documentCount}`);
console.log(`segments=${segmentCount}`);
console.log(`batch=${batch}`);
