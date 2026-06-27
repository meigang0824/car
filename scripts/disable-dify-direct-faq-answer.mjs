import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const backupDir = join(root, "data/backups");
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

const DISABLED_PARSE_CODE = `
def main(results, query) -> dict:
    return {
        "can_direct": "false",
        "direct_answer": "",
        "score": 0,
    }
`.trim();

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
let disabledNodes = 0;

for (const line of rows) {
  const [workflowId, appId, appName, version, graphText] = line.split("\t");
  const graph = JSON.parse(graphText);
  let changed = false;

  backups.push({ workflowId, appId, appName, version, graph });

  for (const node of graph.nodes ?? []) {
    if (node.id !== "parse_faq" || node.data?.type !== "code") continue;
    node.data.code = DISABLED_PARSE_CODE;
    node.data.desc = "已关闭FAQ直接抢答，所有问题统一进入产品检索与LLM回答。";
    disabledNodes += 1;
    changed = true;
  }

  if (changed) updates.push({ workflowId, graph });
}

const backupName = `dify-workflows-before-disable-direct-faq-${timestamp}.json`;
await writeFile(join(backupDir, backupName), `${JSON.stringify(backups, null, 2)}\n`, "utf8");

const sql = [
  "BEGIN;",
  ...updates.map(({ workflowId, graph }) =>
    `UPDATE workflows SET graph = ${sqlString(JSON.stringify(graph))}, updated_at = CURRENT_TIMESTAMP WHERE id = ${sqlString(workflowId)};`,
  ),
  "COMMIT;",
].join("\n");

psql(["-v", "ON_ERROR_STOP=1"], sql);

console.log(`updatedWorkflows=${updates.length}`);
console.log(`disabledParseFaqNodes=${disabledNodes}`);
console.log(`backup=${backupName}`);
