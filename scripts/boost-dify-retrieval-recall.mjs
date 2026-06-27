import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const backupDir = join(root, "data/backups");
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const faqTopK = 8;
const productTopK = 12;

const psql = (args, input = "") => {
  const result = spawnSync(
    "docker",
    ["exec", "-i", "docker-db_postgres-1", "psql", "-U", "postgres", "-d", "dify", ...args],
    { input, encoding: "utf8", maxBuffer: 100_000_000 },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

await mkdir(backupDir, { recursive: true });

const rows = psql([
  "-t",
  "-A",
  "-F",
  "\t",
  "-c",
  `
    select w.id, a.id, a.name, w.version, w.graph
    from workflows w
    join apps a on a.id = w.app_id
    where a.name like '%导购工作流%'
    order by a.name, w.created_at
  `,
])
  .trim()
  .split("\n")
  .filter(Boolean);

const backups = [];
const updates = [];
let retrievalNodes = 0;
let faqNodes = 0;
let productNodes = 0;

for (const line of rows) {
  const [workflowId, appId, appName, version, graphText] = line.split("\t");
  const graph = JSON.parse(graphText);
  let changed = false;
  backups.push({ workflowId, appId, appName, version, graph });

  for (const node of graph.nodes ?? []) {
    if (node.data?.type !== "knowledge-retrieval") continue;
    retrievalNodes += 1;
    node.data.retrieval_mode = "multiple";
    node.data.multiple_retrieval_config ??= {};
    node.data.multiple_retrieval_config.score_threshold = null;
    node.data.multiple_retrieval_config.reranking_enable = false;

    if (node.id === "faq_retrieval") {
      node.data.multiple_retrieval_config.top_k = faqTopK;
      node.data.title = "高召回检索FAQ库";
      node.data.desc = "提高FAQ召回，命中后仍交给LLM组织回答。";
      faqNodes += 1;
    } else if (node.id === "product_retrieval") {
      node.data.multiple_retrieval_config.top_k = productTopK;
      node.data.title = "高召回检索产品参数与FAQ";
      node.data.desc = "扩大产品参数和FAQ召回，知识库未命中也继续LLM兜底。";
      productNodes += 1;
    } else {
      node.data.multiple_retrieval_config.top_k = Math.max(Number(node.data.multiple_retrieval_config.top_k) || 0, 8);
    }
    changed = true;
  }

  if (changed) updates.push({ workflowId, graph });
}

const backupName = `dify-workflows-before-retrieval-recall-boost-${timestamp}.json`;
await writeFile(join(backupDir, backupName), `${JSON.stringify(backups, null, 2)}\n`, "utf8");

if (updates.length) {
  const sql = [
    "BEGIN;",
    ...updates.map(({ workflowId, graph }) =>
      `UPDATE workflows SET graph = ${sqlString(JSON.stringify(graph))}, updated_at = CURRENT_TIMESTAMP WHERE id = ${sqlString(workflowId)};`,
    ),
    "COMMIT;",
  ].join("\n");
  psql(["-v", "ON_ERROR_STOP=1"], sql);
}

console.log(`totalWorkflows=${rows.length}`);
console.log(`updatedWorkflows=${updates.length}`);
console.log(`retrievalNodes=${retrievalNodes}`);
console.log(`faqNodes=${faqNodes}`);
console.log(`productNodes=${productNodes}`);
console.log(`faqTopK=${faqTopK}`);
console.log(`productTopK=${productTopK}`);
console.log(`backup=${backupName}`);
