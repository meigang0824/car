import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const backupDir = join(root, "data/backups");
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

const FALLBACK_RULES = `---

# 工作流兜底规则

* 无论知识库是否检索到内容，都必须进入 LLM 节点生成回答。
* 如果知识库检索结果为空，优先根据用户问题里携带的“当前车型资料”回答。
* 如果当前车型资料也没有对应字段，不要输出范围回复、知识库未命中或无法回答。
* 遇到资料缺失时，用保守门店口径回答：这项配置当前资料里没有明确标注，建议按厂家最新配置单、实车铭牌或门店政策确认。
* 同时给经销商一句自然话术，方便他跟客户解释，不要让回答停在“没有资料”。
* 价格、售后、上牌、保修、批次差异等问题，必须提醒以门店政策、厂家最新配置单和实车为准。
* 参数类问题先给准确参数，再补一句保守讲法；不要编造资料里没有的参数、承诺或效果。
* 资料没有明确写的功能，不能补充“预留接口、支持加装、门店可改装、额外收费、可以选配”等说法；只能说当前资料未标注，建议以厂家最新配置单、实车和门店政策确认为准。`;

const ALWAYS_RELEVANT_CODE = `
def main(results, query) -> dict:
    return {
        "is_relevant": "true",
        "score": 1,
    }
`.trim();

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
let llmNodes = 0;
let promptItems = 0;
let relevanceNodes = 0;
let parseNodes = 0;
let fixedAnswers = 0;

for (const line of rows) {
  const [workflowId, appId, appName, version, graphText] = line.split("\t");
  const graph = JSON.parse(graphText);
  let changed = false;

  backups.push({ workflowId, appId, appName, version, graph });

  for (const node of graph.nodes ?? []) {
    if (node.id === "check_relevance" && node.data?.type === "code") {
      node.data.code = ALWAYS_RELEVANT_CODE;
      node.data.desc = "已关闭范围拦截，知识库未命中也继续进入LLM回答。";
      relevanceNodes += 1;
      changed = true;
    }

    if (node.id === "parse_faq" && node.data?.type === "code") {
      node.data.code = DISABLED_PARSE_CODE;
      node.data.desc = "已关闭FAQ直接抢答，统一进入产品检索与LLM回答。";
      parseNodes += 1;
      changed = true;
    }

    if (node.id === "fixed_scope_answer" && node.data?.type === "answer") {
      node.data.title = "备用兜底提示";
      node.data.answer = "正在交由智能导购根据当前车型资料继续回答。";
      fixedAnswers += 1;
      changed = true;
    }

    if (node.data?.type === "llm" && Array.isArray(node.data.prompt_template)) {
      llmNodes += 1;
      node.data.prompt_template = node.data.prompt_template.map((item) => {
        if (typeof item?.text !== "string") return item;
        promptItems += 1;
        const base = item.text.replace(/\n---\n\n# 工作流兜底规则[\s\S]*$/u, "").trimEnd();
        return { ...item, text: `${base}\n\n${FALLBACK_RULES}` };
      });
      node.data.desc = "知识库命中或未命中都由模型结合当前车型资料生成回答。";
      changed = true;
    }
  }

  if (changed) updates.push({ workflowId, graph });
}

const backupName = `dify-workflows-before-llm-fallback-optimize-${timestamp}.json`;
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
console.log(`llmNodes=${llmNodes}`);
console.log(`promptItems=${promptItems}`);
console.log(`relevanceNodes=${relevanceNodes}`);
console.log(`parseNodes=${parseNodes}`);
console.log(`fixedAnswers=${fixedAnswers}`);
console.log(`backup=${backupName}`);
