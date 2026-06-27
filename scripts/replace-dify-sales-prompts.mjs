import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const backupDir = join(root, "data/backups");
const now = new Date();
const timestamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

const SALES_PROMPT = `# 角色

你是一名拥有10年以上门店销售经验的金牌导购培训师，擅长将产品配置转化为消费者听得懂、愿意买单的销售话术。

你的任务不是介绍产品，而是帮助导购快速成交客户。

---

# 任务

根据输入的产品卖点、配置参数和产品优势，生成一份门店导购话术。

内容必须真实、自然、口语化，可直接用于门店销售。

---

# 写作原则

始终遵循以下逻辑：

**引导客户 → 产品配置 → 配置优势 → 用户价值 → 使用场景 → 成交话术**

重点不是介绍配置，而是告诉客户：

**这项配置能带来什么价值。**

例如：

❌ 1500W电机

✅ 坐两个人爬坡不用推车。

❌ IP67防水

✅ 下雨天不用担心进水。

❌ LED透镜大灯

✅ 晚上看得更远，接孩子更安全。

语言要有画面感，多使用：

> 您看……

> 您摸一下……

> 您试试看……

> 您坐进去感受一下……

让客户参与体验。

---

# 输出格式

## 卖点名称

### 导购怎么讲

100~150字，口语化，可直接讲给客户听。

### 核心配置

使用项目符号列出3~5条。

### 用户价值

说明配置带来的实际好处，例如：

* 更安全
* 更耐用
* 更舒适
* 更省钱
* 更省心

### 使用场景

结合真实生活，如：

接孩子、买菜、上下班、赶集、夜间骑行等。

### 成交话术

最后输出一句自然、有说服力的成交话术。

---

# 风格要求

* 像真实导购聊天，不像AI。
* 多用短句，每句话20字左右。
* 不堆参数，不写产品说明书。
* 不夸大宣传，不攻击竞品。
* 禁止使用："本产品"、"采用先进技术"、"赋能"、"行业领先"、"极致体验"等AI和营销腔。`;

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
let llmNodeCount = 0;
let promptItemCount = 0;

for (const line of rows) {
  const [workflowId, appId, appName, version, graphText] = line.split("\t");
  const graph = JSON.parse(graphText);
  let changed = false;

  backups.push({ workflowId, appId, appName, version, graph });

  for (const node of graph.nodes ?? []) {
    if (node.data?.type !== "llm") continue;
    llmNodeCount += 1;
    if (!Array.isArray(node.data.prompt_template)) continue;

    node.data.prompt_template = node.data.prompt_template.map((item) => {
      if (typeof item?.text !== "string") return item;
      promptItemCount += 1;
      changed = true;
      return { ...item, text: SALES_PROMPT };
    });
  }

  if (changed) updates.push({ workflowId, graph });
}

if (!updates.length) {
  console.log("updatedWorkflows=0");
  console.log(`totalWorkflows=${rows.length}`);
  console.log(`llmNodes=${llmNodeCount}`);
  console.log(`promptItems=${promptItemCount}`);
  process.exit(0);
}

const backupName = `dify-workflows-before-sales-prompt-replace-${timestamp}.json`;
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
console.log(`totalWorkflows=${rows.length}`);
console.log(`llmNodes=${llmNodeCount}`);
console.log(`promptItems=${promptItemCount}`);
console.log(`backup=${backupName}`);
