import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const catalog = JSON.parse(await readFile(join(root, "data/catalog.json"), "utf8"));
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
const specMap = (vehicle) => Object.fromEntries(vehicle.specs);
const specLines = (vehicle) => vehicle.specs.map(([key, value]) => `- ${key}：${value}`).join("\n");

const parseFaqCode = `
import re

def _extract_score(item):
    try:
        return float(item.get("metadata", {}).get("score", 0) or 0)
    except Exception:
        return 0.0

def _extract_answer(content, query):
    if not content:
        return ""
    blocks = re.split(r"\\n(?=(?:问[:：]|Q\\d+[:：]))", content)
    best = ""
    best_hits = -1
    query_chars = set(re.sub(r"\\s+", "", query))
    for block in blocks:
        if not re.search(r"(?:答[:：]|A\\d+[:：])", block):
            continue
        q_part = re.split(r"(?:答[:：]|A\\d+[:：])", block, maxsplit=1)[0]
        hits = len(query_chars & set(q_part))
        exact_bonus = 20 if query.strip("？?") in q_part else 0
        score = hits + exact_bonus
        if score > best_hits:
            best_hits = score
            best = block
    if not best:
        return ""
    answer = re.split(r"(?:答[:：]|A\\d+[:：])", best, maxsplit=1)[-1].strip()
    answer = re.split(r"\\n(?:问[:：]|Q\\d+[:：])", answer, maxsplit=1)[0].strip()
    return answer

def main(results, query) -> dict:
    if not results:
        results = []

    best_answer = ""
    best_score = 0.0
    for item in results:
        score = _extract_score(item)
        title = item.get("title") or item.get("metadata", {}).get("document_name", "")
        content = item.get("content", "")
        is_faq = "FAQ" in title or "问：" in content or "问:" in content or re.search(r"Q\\d+[:：]", content)
        answer = _extract_answer(content, query)
        if is_faq and answer and score >= 0.12 and score >= best_score:
            best_answer = answer
            best_score = score

    return {
        "can_direct": "true" if best_answer else "false",
        "direct_answer": best_answer,
        "score": best_score,
    }
`.trim();

const promptFor = (vehicle) => {
  const specs = specMap(vehicle);
  return `你是${vehicle.name}专属智能客服，服务对象是门店老板、经销商和销售人员。只回答${vehicle.name}相关问题，必须基于【知识库检索结果】和下方后台配置口径说话。

车型定位：${vehicle.series}
主推口径：${vehicle.slogan}
价格口径：${vehicle.dealerPolicy}

后台配置参数：
${specLines(vehicle)}

回答要求：
1. 像真实门店导购助手一样回答，直接、自然、口语化。
2. 不要写成报告，不要固定输出“结论/卖点/提醒”标题。
3. 用户问参数时，先给后台配置里的准确参数，再补一句怎么给客户解释。
4. 用户问“怎么跟客户说、怎么推、话术、卖点、异议处理”时，直接给一段能照着讲的话。
5. 用户问价格时，按价格口径回答；不要编造额外优惠。
6. 不要编造后台配置没有的参数，包括峰值功率、车架厚度、刹车结构、烤漆工艺、玻璃厚度、电池容量、续航里程、保修时长。
7. 涉及下单、合同、批次配置和售后政策时，说按厂家最新配置单和门店实际政策确认。
8. 回答控制在120个中文字左右，除非用户要求详细对比或完整话术。

【知识库检索结果】
{{#context#}}`;
};

await mkdir(backupDir, { recursive: true });
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

for (const line of rows) {
  const [appId, appName, workflowId, graphText] = line.split("\t");
  const graph = JSON.parse(graphText);
  const vehicle = catalog.vehicles.find((item) => appName.startsWith(item.name));
  if (!vehicle) throw new Error(`vehicle not found for app ${appName}`);

  backup.push({ appId, appName, workflowId, graph });

  for (const node of graph.nodes ?? []) {
    if (node.id === "parse_faq" && node.data?.type === "code") {
      node.data.code = parseFaqCode;
      node.data.desc = "解析FAQ检索结果，支持Q/A与问/答格式，命中后直接返回知识库答案。";
    }
    if (node.id === "llm" && node.data?.type === "llm" && Array.isArray(node.data.prompt_template)) {
      node.data.prompt_template = node.data.prompt_template.map((item, index) =>
        index === 0 && item.role === "system"
          ? { ...item, text: promptFor(vehicle) }
          : item,
      );
      node.data.title = `${vehicle.name}智能客服回答`;
    }
  }

  updates.push({ workflowId, graph });
}

await writeFile(
  join(backupDir, `dify-current-workflow-graphs-before-faq-prompt-fix-${timestamp}.json`),
  `${JSON.stringify(backup, null, 2)}\n`,
  "utf8",
);

const sql = [
  "BEGIN;",
  ...updates.map(({ workflowId, graph }) =>
    `UPDATE workflows SET graph = ${sqlString(JSON.stringify(graph))}::json, updated_at = CURRENT_TIMESTAMP WHERE id = ${sqlString(workflowId)};`,
  ),
  "COMMIT;",
].join("\n");

psql(["-v", "ON_ERROR_STOP=1"], sql);

console.log(`updatedWorkflows=${updates.length}`);
console.log(`backup=dify-current-workflow-graphs-before-faq-prompt-fix-${timestamp}.json`);
