import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import config from "../data/dify-workflows.json" with { type: "json" };

const root = resolve(import.meta.dirname, "..");
const backupDir = join(root, "data/backups");
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

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

const datasetIds = Object.values(config.bindings).map((binding) => binding.vehicleDatasetId);
const datasetIdsSql = datasetIds.map(sqlString).join(",");

const importantTerms = [
  "电机", "电机功率", "额定电压", "控制器", "管数", "电池", "可选规格", "充电时间", "充电电压",
  "续航", "最高时速", "速度表", "爬坡", "最大爬坡", "载重", "最大载重", "座位配置",
  "刹车", "前刹车", "后刹车", "减震", "前减震", "后减震", "轮胎", "轮胎规格", "前轮规格", "后轮规格",
  "灯光", "前大灯", "尾灯", "转向灯", "车身", "颜色", "漆面", "尺寸", "整车长度", "整车宽度", "整车高度",
  "轴距", "轮距", "特色功能", "USB", "防盗", "钥匙", "雨刮器", "暖风", "倒车影像", "中控锁", "天窗",
  "防水", "雨天", "涉水", "仪表", "液晶", "保修", "售后", "合规", "新国标", "合格证", "上牌", "驾照",
  "适用场景", "目标人群", "参考价格", "蓝牙", "音箱", "太阳能", "喇叭",
];

const addTerm = (set, term) => {
  const value = String(term ?? "").trim().replace(/^[-*#>\s]+/, "").replace(/\s+/g, "");
  if (value.length >= 2 && value.length <= 40) set.add(value);
};

const extractKeywords = (content) => {
  const set = new Set();
  for (const term of importantTerms) {
    if (content.includes(term)) addTerm(set, term);
  }

  for (const match of content.matchAll(/[A-Za-z0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?(?:W|V|Ah|mm|kg|km\/h)?/g)) {
    addTerm(set, match[0]);
  }

  for (const line of content.split(/\r?\n/)) {
    const cleaned = line
      .replace(/[*#>`_]/g, "")
      .replace(/\*\*/g, "")
      .replace(/^\s*[-•]\s*/, "")
      .trim();
    if (!cleaned) continue;

    const labelMatch = cleaned.match(/^([^:：]{2,20})[:：]\s*(.+)$/);
    if (labelMatch) {
      addTerm(set, labelMatch[1]);
      for (const part of labelMatch[2].split(/[，。；;、,()（）\[\]'"\s]+/)) addTerm(set, part);
      addTerm(set, labelMatch[2].slice(0, 30));
    }

    for (const part of cleaned.split(/[，。；;、,()（）\[\]'"\s]+/)) {
      addTerm(set, part);
    }
  }

  for (const match of content.matchAll(/[\u4e00-\u9fa5A-Za-z0-9]+/g)) {
    const token = match[0];
    addTerm(set, token);
    if (/[\u4e00-\u9fa5]/.test(token) && token.length >= 4) {
      for (let size of [2, 3, 4, 5, 6]) {
        for (let i = 0; i <= token.length - size; i += size <= 3 ? 1 : 2) {
          addTerm(set, token.slice(i, i + size));
          if (set.size >= 180) break;
        }
        if (set.size >= 180) break;
      }
    }
    if (set.size >= 180) break;
  }

  return [...set].slice(0, 180);
};

await mkdir(backupDir, { recursive: true });

const backupCsv = psql(["-c", `copy (select id,dataset_id,keywords from document_segments where dataset_id in (${datasetIdsSql})) to stdout with csv header`]);
await writeFile(join(backupDir, `dify-segment-keywords-before-rebuild-${timestamp}.csv`), backupCsv, "utf8");

const rowsJson = psql([
  "-t",
  "-A",
  "-c",
  `
select coalesce(json_agg(row_to_json(t)), '[]'::json)
from (
  select dataset_id,id,index_node_id,content
  from document_segments
  where dataset_id in (${datasetIdsSql}) and enabled=true and status='completed'
  order by dataset_id,document_id,position
) t
`,
]).trim();
const rows = JSON.parse(rowsJson || "[]");

const tables = new Map(datasetIds.map((id) => [id, {}]));
const updates = ["BEGIN;"];
let segmentCount = 0;
let keywordCount = 0;

for (const row of rows) {
  const { dataset_id: datasetId, id: segmentId, index_node_id: indexNodeId, content } = row;
  const keywords = extractKeywords(content);
  keywordCount += keywords.length;
  segmentCount += 1;
  updates.push(`UPDATE document_segments SET keywords=${sqlString(JSON.stringify(keywords))}::json WHERE id=${sqlString(segmentId)};`);
  const table = tables.get(datasetId) ?? {};
  for (const keyword of keywords) {
    table[keyword] ??= [];
    if (!table[keyword].includes(indexNodeId)) table[keyword].push(indexNodeId);
  }
  tables.set(datasetId, table);
}

for (const datasetId of datasetIds) {
  const payload = {
    __type__: "keyword_table",
    __data__: {
      index_id: datasetId,
      summary: null,
      table: tables.get(datasetId) ?? {},
    },
  };
  updates.push(`
INSERT INTO dataset_keyword_tables (id, dataset_id, keyword_table, data_source_type)
VALUES (${sqlString(randomUUID())}, ${sqlString(datasetId)}, ${sqlString(JSON.stringify(payload))}, 'database')
ON CONFLICT (dataset_id) DO UPDATE SET keyword_table = EXCLUDED.keyword_table;
`);
}

updates.push("COMMIT;");
psql(["-v", "ON_ERROR_STOP=1"], updates.join("\n"));

console.log(`datasets=${datasetIds.length}`);
console.log(`segments=${segmentCount}`);
console.log(`keywords=${keywordCount}`);
console.log(`backup=dify-segment-keywords-before-rebuild-${timestamp}.csv`);
