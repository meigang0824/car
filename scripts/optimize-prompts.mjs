import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const backupDir = join(root, "data/backups");
const now = new Date();
const timestamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

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

// The optimized prompt
const newPrompt = `# 角色
你是10年经验的金牌导购培训师，擅长将参数转化为“听得懂、愿意买单”的成交话术。你的目标是帮导购快速成交。

# 写作逻辑
引导 → 配置 → 优势 → 价值 → 场景 → 成交。
重点讲价值（例：800W电机 → 两人爬坡不用推车）。多用“您看/摸/试/坐”引导体验。

# 输出格式
## 卖点名称
### 导购怎么讲 (100-150字，纯口语化短句，禁止AI腔)
### 核心配置 (3-5条)
### 用户价值 (安全/省心/耐用/省钱等)
### 使用场景 (接娃/买菜/赶集/夜骑等)
### 成交话术 (一句自然促成)

# 规则
1. 严禁AI腔/营销词（如本产品、赋能、极致体验）。
2. 资料缺失时严禁编造参数。统一回复：“该配置资料未标注，建议以实车/最新配置单/门店为准”，并补充一句给导购的解释话术。
3. 必须输出完整回答，绝不说“未检索到/无法回答”。`;

await mkdir(backupDir, { recursive: true });

// Fetch all workflows
console.log("Fetching workflows from database...");
const rows = psql([
  "-t",
  "-A",
  "-F",
  "\t",
  "-c",
  "select a.id,a.name,a.workflow_id,w.graph::text from apps a join workflows w on w.id=a.workflow_id where a.name like '%导购工作流%' order by a.name",
]).trim().split("\n").filter(Boolean);

const backup = [];
const updates = [];
let totalNodesUpdated = 0;

for (const line of rows) {
  const [appId, appName, workflowId, graphText] = line.split("\t");
  const graph = JSON.parse(graphText);
  
  backup.push({ appId, appName, workflowId, graph });

  let appUpdatedCount = 0;
  for (const node of graph.nodes ?? []) {
    // Check if it is an LLM node
    if (node.data?.type === "llm" && Array.isArray(node.data.prompt_template)) {
      // Check if it matches the old prompt pattern (the long one)
      const firstPrompt = node.data.prompt_template[0];
      if (firstPrompt?.text?.startsWith("# 角色\n\n你是一名拥有10年以上门店销售经验的金牌导购培训师")) {
        node.data.prompt_template[0].text = newPrompt;
        appUpdatedCount++;
      }
    }
  }

  if (appUpdatedCount > 0) {
    updates.push({ workflowId, graph });
    totalNodesUpdated += appUpdatedCount;
    console.log(`- ${appName}: updated ${appUpdatedCount} nodes`);
  }
}

if (updates.length > 0) {
  const backupFile = join(backupDir, `dify-workflows-before-prompt-opt-${timestamp}.json`);
  await writeFile(backupFile, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
  console.log(`\nBackup saved to ${backupFile}`);

  console.log("Updating database...");
  const sql = [
    "BEGIN;",
    ...updates.map(({ workflowId, graph }) =>
      `UPDATE workflows SET graph = ${sqlString(JSON.stringify(graph))}::json, updated_at = CURRENT_TIMESTAMP WHERE id = ${sqlString(workflowId)};`,
    ),
    "COMMIT;",
  ].join("\n");

  psql(["-v", "ON_ERROR_STOP=1"], sql);
  console.log(`\nSuccessfully updated database. Total LLM nodes updated: ${totalNodesUpdated}`);
} else {
  console.log("No matching prompts found to update.");
}
