import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const backupDir = join(root, "data/backups");
const config = JSON.parse(await readFile(join(root, "data/dify-workflows.json"), "utf8"));
const catalog = JSON.parse(await readFile(join(root, "data/catalog.json"), "utf8"));
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

const appIds = Object.values(config.bindings ?? {})
  .map((binding) => binding.appId)
  .filter(Boolean);

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

const productFactFiles = {
  tiger: "星瑞plus_产品参数.md",
  q7: "陆尚_产品参数.md",
  a8: "CL9_产品参数.md",
  t5: "H6_产品参数.md",
  k3: "乐萌_产品参数.md",
};

const specValue = (vehicle, label) =>
  (Array.isArray(vehicle?.specs) ? vehicle.specs : []).find(([name]) => name === label)?.[1] ?? "";

const sectionFacts = async (vehicleId, sectionName) => {
  const fileName = productFactFiles[vehicleId];
  if (!fileName) return [];
  try {
    const raw = await readFile(join(root, "data/obsidian-sync", fileName), "utf8");
    const lines = raw.split(/\r?\n/);
    const facts = [];
    let active = false;
    for (const line of lines) {
      const heading = line.match(/^##\s+(.+)$/);
      if (heading) {
        active = heading[1].trim() === sectionName;
        continue;
      }
      if (!active) continue;
      const keyValue = line.match(/^\*\s+\*\*(.+?)\*\*:\s*(.+)$/);
      if (keyValue) facts.push(`${keyValue[1].trim()}：${keyValue[2].trim().replace(/[\[\]']/g, "").replace(/,\s*/g, "、")}`);
      const bullet = line.match(/^\*\s+(.+)$/);
      if (bullet && !keyValue) facts.push(bullet[1].trim());
    }
    return facts;
  } catch {
    return [];
  }
};

const sceneText = (vehicle) => {
  if (vehicle.id === "q7") return "年轻妈妈、通勤族、接送老人；适合年轻妈妈接送孩子、日常通勤代步、周末郊游、接送老人。";
  if (vehicle.id === "a8") return "预算有限、老年人、第一次买电动车的客户；适合小区代步、门口买菜、乡镇出行。";
  if (vehicle.id === "t5") return "既要坐人又要带点货的客户；适合门店经营、小摊采购、农村短途载物和家庭代步。";
  if (vehicle.id === "k3") return "年轻女性、老年人、新手，也适合价格敏感、短途基础代步客户；适合小区内短途代步、门口买菜、接送孩子。";
  return "看重空间、舒适性和配置感的家庭客户；适合接送孩子、老人短途出行、夫妻日常代步。";
};

const factSentence = (facts, emptyText = "当前资料未标注") =>
  facts.filter(Boolean).slice(0, 5).join("；") || emptyText;

const compareAnswers = (vehicle) =>
  Object.fromEntries(catalog.vehicles
    .filter((other) => other.id !== vehicle.id)
    .map((other) => [
      other.name,
      `如果客户在${vehicle.name}和${other.name}之间选，可以先看预算和用途。${vehicle.name}定位是${vehicle.series}，价格口径${vehicle.price}，电机${specValue(vehicle, "电机")}，载重${specValue(vehicle, "重量")}，更适合${sceneText(vehicle).replace(/。$/, "")}；${other.name}定位是${other.series}，价格口径${other.price}，电机${specValue(other, "电机")}，载重${specValue(other, "重量")}。门店讲法可以说：先按客户每天跑多远、坐几个人、要不要更高配置来选，预算有限先看${vehicle.name}，想要更高配置再对比${other.name}。`,
    ]));

const buildBasicAnswers = async (vehicle) => {
  const rangeFacts = await sectionFacts(vehicle.id, "续航能力");
  const batteryFacts = await sectionFacts(vehicle.id, "电池系统");
  const shockFacts = await sectionFacts(vehicle.id, "减震系统");
  const speedFacts = await sectionFacts(vehicle.id, "速度性能");
  const tireFacts = await sectionFacts(vehicle.id, "轮胎配置");
  const featureFacts = await sectionFacts(vehicle.id, "特色功能");
  const afterSaleFacts = await sectionFacts(vehicle.id, "售后保修");
  const complianceFacts = await sectionFacts(vehicle.id, "合规认证");
  const priceAnswer = `${vehicle.name}的价格口径是：${vehicle.dealerPolicy || `参考价格：${vehicle.price}`} 具体成交价要按门店配置、电池规格和当地政策确认。`
    .replace(/(确认。)\s+具体成交价要按门店配置、电池规格和当地政策确认。$/, "$1");
  return {
    price: priceAnswer,
    motor: `${vehicle.name}的电机配置是${specValue(vehicle, "电机")}。控制器是${specValue(vehicle, "控制器")}。整车电压是${specValue(vehicle, "电压")}。门店讲法可以说：这套动力主要适合日常代步、接送孩子和买菜，参数以实车和最新配置单为准。`,
    range: `${vehicle.name}的续航要看电池规格。${[...rangeFacts.slice(0, 5), ...batteryFacts.slice(0, 3)].join("；") || "当前资料未标注完整续航参数"}。实际能跑多远会受载重、路况、天气和骑行习惯影响，按客户日常里程来配电池更稳。`,
    audience: `${vehicle.name}适合${sceneText(vehicle)}导购可以先问客户每天跑多远、坐几个人、路况怎么样，再对应推荐。`,
    shock: `${vehicle.name}的减震配置是${specValue(vehicle, "减震")}。${shockFacts.length ? `资料里还标注：${shockFacts.slice(0, 4).join("；")}。` : ""}门店讲法可以说：让客户现场坐一下、过个小坎感受，舒适性比单纯讲参数更直观。`,
    speed: `${vehicle.name}的最高时速是${specValue(vehicle, "速度") || factSentence(speedFacts)}。门店讲法可以说：这个速度主要是日常代步、接送孩子和买菜用，跑得稳比一味求快更重要，具体以实车和当地合规要求为准。`,
    tire: `${vehicle.name}的轮胎资料是：${factSentence(tireFacts, specValue(vehicle, "轮胎") || "当前资料未标注轮胎配置")}。如果客户问轮胎品牌，只能按资料里明确写的讲；资料没有标品牌时，不要承诺具体品牌，建议以实车和厂家最新配置单为准。`,
    charging_cost: `${vehicle.name}充一次电多少钱，要看客户选择的电池容量和当地电价。当前资料标注：${factSentence(batteryFacts, `电压${specValue(vehicle, "电压")}`)}。门店不要直接报固定金额，可以按实车电池规格现场估算，给客户讲日常用电成本比较低，具体以当地电价为准。`,
    aftersale: `${vehicle.name}的售后口径是：${factSentence(afterSaleFacts)}。门店讲法可以说：先按厂家和门店最新保修政策说明，电池、核心部件和整车保修范围要以购车凭证和配置单为准。`,
    compliance: `${vehicle.name}的合规资料是：${factSentence(complianceFacts)}。门店讲法可以说：上牌、驾照和当地管理要求要看当地政策，建议按门店实车合格证和当地车管要求确认。`,
    features: `${vehicle.name}的功能配置资料是：${factSentence(featureFacts)}。客户问某个功能时，资料里写了就按资料讲；资料未标注的功能，不要承诺有，建议以实车配置单为准。`,
    compare: compareAnswers(vehicle),
  };
};

const directFaqCode = (basicAnswers) => `
import re

BASIC_ANSWERS = ${JSON.stringify(basicAnswers)}

def _score(item):
    meta = item.get("metadata", {}) or {}
    try:
        return float(meta.get("score", 0) or 0)
    except Exception:
        return 0.0

def _norm(value):
    return re.sub(r"\\s+", "", (value or "").lower())

def _question(content):
    text = content or ""
    for pat in [
        r"question[:：]\\s*(.*?)\\s*\\nanswer[:：]",
        r"问题[:：]\\s*(.*?)\\s*\\n答案[:：]",
        r"问[:：]\\s*(.*?)\\s*\\n答[:：]",
        r"Q\\d*[:：]\\s*(.*?)\\s*\\nA\\d*[:：]",
    ]:
        m = re.search(pat, text, re.S | re.I)
        if m:
            return m.group(1).strip()
    return text[:160]

def _answer(content):
    text = (content or "").strip()
    for pat in [
        r"answer[:：]\\s*(.*?)(?=\\n\\s*(?:question|问题|问|Q\\d*)[:：]|\\Z)",
        r"答案[:：]\\s*(.*?)(?=\\n\\s*(?:question|问题|问|Q\\d*)[:：]|\\Z)",
        r"答[:：]\\s*(.*?)(?=\\n\\s*(?:question|问题|问|Q\\d*)[:：]|\\Z)",
        r"A\\d*[:：]\\s*(.*?)(?=\\n\\s*Q\\d*[:：]|\\Z)",
        r"####\\s*导购怎么讲\\s*\\n(.*?)(?=\\n####\\s|\\n---\\s*$|\\Z)",
    ]:
        m = re.search(pat, text, re.S | re.I)
        if m:
            return m.group(1).strip()
    return ""

def _is_vehicle_price_query(text):
    raw = text or ""
    asks_price = any(word in raw for word in ["多少钱", "价格", "报价", "标价", "成交价", "活动价", "怎么卖", "车价", "售价"])
    running_cost = any(word in raw for word in ["充电", "电费", "几度电", "一度电", "充一次", "上牌", "保险", "保养", "维修", "换电池"])
    explicit_vehicle = any(word in raw for word in ["整车", "这车", "车辆", "车价", "售价", "报价", "标价", "成交价", "活动价", "怎么卖", "买"])
    return asks_price and (not running_cost or explicit_vehicle)

def _is_running_cost_content(text):
    raw = text or ""
    return any(word in raw for word in ["充电", "充满", "电费", "几度电", "一度电", "充一次", "上牌", "保险", "保养", "维修", "换电池"])

def main(results, query) -> dict:
    best_answer = ""
    best_rank = -1.0
    raw_query = query or ""
    q = _norm(raw_query)
    vehicle_price_query = _is_vehicle_price_query(raw_query)
    if vehicle_price_query and BASIC_ANSWERS.get("price"):
        return {
            "can_direct": "true",
            "direct_answer": BASIC_ANSWERS.get("price"),
            "score": 9,
        }
    if any(word in raw_query for word in ["电机", "多少瓦", "几瓦", "功率", "动力", "控制器"]) and BASIC_ANSWERS.get("motor"):
        return {"can_direct": "true", "direct_answer": BASIC_ANSWERS.get("motor"), "score": 8}
    if any(word in raw_query for word in ["续航", "跑多远", "能跑", "多少公里", "电池"]) and BASIC_ANSWERS.get("range"):
        return {"can_direct": "true", "direct_answer": BASIC_ANSWERS.get("range"), "score": 8}
    if any(word in raw_query for word in ["适合", "人群", "场景", "推荐", "谁买", "什么客户", "哪类客户", "哪些客户", "目标客户"]) and BASIC_ANSWERS.get("audience"):
        return {"can_direct": "true", "direct_answer": BASIC_ANSWERS.get("audience"), "score": 8}
    if any(word in raw_query for word in ["减震", "避震", "悬挂", "颠", "舒适"]) and BASIC_ANSWERS.get("shock"):
        return {"can_direct": "true", "direct_answer": BASIC_ANSWERS.get("shock"), "score": 8}
    if any(word in raw_query for word in ["速度", "时速", "最高", "最快", "跑多快"]) and BASIC_ANSWERS.get("speed"):
        return {"can_direct": "true", "direct_answer": BASIC_ANSWERS.get("speed"), "score": 8}
    if any(word in raw_query for word in ["轮胎", "胎", "真空胎", "轮子"]) and BASIC_ANSWERS.get("tire"):
        return {"can_direct": "true", "direct_answer": BASIC_ANSWERS.get("tire"), "score": 8}
    if any(word in raw_query for word in ["充电多少钱", "充一次", "电费", "几度电", "一度电", "用车成本"]) and BASIC_ANSWERS.get("charging_cost"):
        return {"can_direct": "true", "direct_answer": BASIC_ANSWERS.get("charging_cost"), "score": 8}
    if any(word in raw_query for word in ["保修", "售后", "维修", "质保"]) and BASIC_ANSWERS.get("aftersale"):
        return {"can_direct": "true", "direct_answer": BASIC_ANSWERS.get("aftersale"), "score": 8}
    if any(word in raw_query for word in ["上牌", "驾照", "合规", "国标", "合格证"]) and BASIC_ANSWERS.get("compliance"):
        return {"can_direct": "true", "direct_answer": BASIC_ANSWERS.get("compliance"), "score": 8}
    if any(word in raw_query for word in ["暖风", "倒车", "影像", "雷达", "蓝牙", "音箱", "USB", "防盗", "中控锁", "雨刮", "天窗"]) and BASIC_ANSWERS.get("features"):
        return {"can_direct": "true", "direct_answer": BASIC_ANSWERS.get("features"), "score": 8}
    if any(word in raw_query for word in ["对比", "比", "怎么选", "哪个好", "区别"]):
        compare_map = BASIC_ANSWERS.get("compare") or {}
        for name, answer in compare_map.items():
            if name and name in raw_query:
                return {"can_direct": "true", "direct_answer": answer, "score": 8}
        if compare_map:
            answer = list(compare_map.values())[0]
            return {"can_direct": "true", "direct_answer": answer, "score": 7}
    for item in (results or []):
        content = item.get("content", "") or ""
        answer = _answer(content)
        if not answer:
            continue
        if vehicle_price_query and _is_running_cost_content(content):
            continue
        rank = _score(item)
        question = _norm(_question(content))
        if question:
            overlap = len(set(q) & set(question))
            rank += min(overlap / 80.0, 0.4)
        if vehicle_price_query and any(word in content for word in ["门店标价", "参考价格", "建议成交价", "价格口径"]):
            rank += 0.8
        if rank > best_rank:
            best_rank = rank
            best_answer = answer

    # Dify retriever scores above ~0.25 have been reliable for these curated FAQ datasets.
    # Prefer the FAQ answer so common parameter questions avoid the slow LLM branch.
    can_direct = bool(best_answer and best_rank >= 0.25)
    return {
        "can_direct": "true" if can_direct else "false",
        "direct_answer": best_answer if can_direct else "",
        "score": best_rank if best_rank > 0 else 0,
    }
`.trim();

const ALWAYS_RELEVANT_CODE = `
def main(results, query) -> dict:
    return {
        "is_relevant": "true",
        "score": 1,
    }
`.trim();

await mkdir(backupDir, { recursive: true });

const rows = psql([
  "-t",
  "-A",
  "-F",
  "\t",
  "-c",
  `
    select w.id, a.id, a.name, w.version, w.graph::text
    from apps a
    join workflows w on w.id = a.workflow_id
    where a.id in (${appIds.map(sqlString).join(",")})
    order by a.name
  `,
])
  .trim()
  .split("\n")
  .filter(Boolean);

const backups = [];
const updates = [];
let parseNodes = 0;
let relevanceNodes = 0;
let fixedAnswers = 0;
let retrievalNodes = 0;

for (const line of rows) {
  const [workflowId, appId, appName, version, graphText] = line.split("\t");
  const graph = JSON.parse(graphText);
  const vehicle = catalog.vehicles.find((item) => config.bindings?.[item.id]?.appId === appId);
  const basicAnswers = vehicle ? await buildBasicAnswers(vehicle) : {};
  let changed = false;
  backups.push({ workflowId, appId, appName, version, graph });

  for (const node of graph.nodes ?? []) {
    if (node.id === "parse_faq" && node.data?.type === "code") {
      node.data.code = directFaqCode(basicAnswers);
      node.data.desc = "FAQ命中时直接返回答案，避免常见参数问题进入慢LLM分支。";
      parseNodes += 1;
      changed = true;
    }

    if (node.id === "check_relevance" && node.data?.type === "code") {
      node.data.code = ALWAYS_RELEVANT_CODE;
      node.data.desc = "关闭过严范围拦截，知识库未命中也继续由模型结合当前资料回答。";
      relevanceNodes += 1;
      changed = true;
    }

    if (node.id === "fixed_scope_answer" && node.data?.type === "answer") {
      node.data.title = "备用兜底提示";
      node.data.answer = "正在根据当前车型资料继续整理回答。";
      fixedAnswers += 1;
      changed = true;
    }

    if (node.data?.type === "knowledge-retrieval") {
      node.data.retrieval_mode = "multiple";
      node.data.multiple_retrieval_config ??= {};
      node.data.multiple_retrieval_config.score_threshold = null;
      node.data.multiple_retrieval_config.reranking_enable = false;
      node.data.multiple_retrieval_config.top_k = Math.max(Number(node.data.multiple_retrieval_config.top_k) || 0, 8);
      retrievalNodes += 1;
      changed = true;
    }
  }

  if (changed) updates.push({ workflowId, graph });
}

const backupName = `dify-workflows-before-quick-workflow-repair-${timestamp}.json`;
await writeFile(join(backupDir, backupName), `${JSON.stringify(backups, null, 2)}\n`, "utf8");

if (updates.length) {
  const sql = [
    "BEGIN;",
    ...updates.map(({ workflowId, graph }) =>
      `UPDATE workflows SET graph = ${sqlString(JSON.stringify(graph))}::json, updated_at = CURRENT_TIMESTAMP WHERE id = ${sqlString(workflowId)};`,
    ),
    "COMMIT;",
  ].join("\n");
  psql(["-v", "ON_ERROR_STOP=1"], sql);
}

console.log(`targetApps=${appIds.length}`);
console.log(`updatedWorkflows=${updates.length}`);
console.log(`parseNodes=${parseNodes}`);
console.log(`relevanceNodes=${relevanceNodes}`);
console.log(`fixedAnswers=${fixedAnswers}`);
console.log(`retrievalNodes=${retrievalNodes}`);
console.log(`backup=${backupName}`);
