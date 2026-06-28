import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { defaultCatalog } from "./defaultCatalog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(__dirname, "../data/catalog.json");
const difyWorkflowsPath = resolve(__dirname, "../data/dify-workflows.json");
const chatHistoryPath = resolve(__dirname, "../data/chat-history.json");
const obsidianSyncPath = resolve(__dirname, "../data/obsidian-sync");
const staticRoot = resolve(__dirname, "../dist");
const envPath = resolve(__dirname, "../.env");
const port = Number(process.env.API_PORT ?? 4174);
const host = process.env.HOST ?? "127.0.0.1";

const loadEnvFile = async () => {
  try {
    const raw = await readFile(envPath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separator = trimmed.indexOf("=");
      if (separator === -1) return;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
  } catch {
    // .env is optional for local demos.
  }
};

await loadEnvFile();

const difyTimeoutMs = Number(process.env.DIFY_TIMEOUT_MS ?? 60000);

const jsonHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

const streamHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

const send = (response, status, body) => {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
};

const sendStream = (response, event, data) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
};

const staticMimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

const serveStatic = async (request, response, pathname) => {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (!existsSync(staticRoot)) return false;

  const decodedPath = decodeURIComponent(pathname);
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const candidatePath = resolve(staticRoot, `.${requestedPath}`);
  const safeRoot = `${staticRoot}/`;
  const targetPath = candidatePath === staticRoot || candidatePath.startsWith(safeRoot)
    ? candidatePath
    : resolve(staticRoot, "index.html");
  const filePath = existsSync(targetPath) ? targetPath : resolve(staticRoot, "index.html");

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": staticMimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    });
    if (request.method === "HEAD") response.end();
    else response.end(content);
    return true;
  } catch {
    return false;
  }
};

const normalizeWorkflowName = (name, fallback = "专属智能客服工作流") =>
  String(name || fallback)
    .replace(/产品知识工作流/g, "智能客服工作流")
    .replace(/产品助手工作流/g, "智能客服工作流")
    .replace(/导购工作流/g, "产品知识工作流")
    .replace(/产品知识工作流/g, "智能客服工作流")
    .replace(/导购/g, "智能客服")
    .replace(/产品助手/g, "智能客服");

const normalizeKnowledgeName = (name, fallback = "专属知识库") =>
  String(name || fallback)
    .replace(/产品知识库/g, "客服知识库")
    .replace(/导购知识库/g, "产品知识库")
    .replace(/产品知识库/g, "客服知识库")
    .replace(/导购/g, "客服");

const ttsProviders = [
  { id: "siliconflow", label: "硅基流动 TTS", streaming: true },
  { id: "doubao", label: "豆包（方舟）", streaming: true },
  { id: "openai", label: "OpenAI TTS", streaming: true },
];

const ttsVoices = {
  siliconflow: [
    { id: "FunAudioLLM/CosyVoice2-0.5B:claire", label: "Claire（温柔女声）" },
    { id: "FunAudioLLM/CosyVoice2-0.5B:anna", label: "Anna（沉稳女声）" },
    { id: "FunAudioLLM/CosyVoice2-0.5B:diana", label: "Diana（欢快女声）" },
    { id: "FunAudioLLM/CosyVoice2-0.5B:alex", label: "Alex（沉稳男声）" },
    { id: "FunAudioLLM/CosyVoice2-0.5B:benjamin", label: "Benjamin（低沉男声）" },
    { id: "FunAudioLLM/CosyVoice2-0.5B:charles", label: "Charles（磁性男声）" },
    { id: "FunAudioLLM/CosyVoice2-0.5B:david", label: "David（欢快男声）" },
    { id: "fnlp/MOSS-TTSD-v0.5:claire", label: "MOSS Claire（温柔女声）" },
    { id: "fnlp/MOSS-TTSD-v0.5:alex", label: "MOSS Alex（沉稳男声）" },
  ],
  doubao: [
    { id: "zh_female_kefunvsheng_uranus_bigtts", label: "暖阳女声 2.0（专业女声）" },
    { id: "zh_female_xiaohe_uranus_bigtts", label: "小何 2.0（女声，通用）" },
    { id: "zh_female_vv_uranus_bigtts", label: "Vivi 2.0（女声，通用）" },
    { id: "zh_female_shuangkuaisisi_uranus_bigtts", label: "爽快思思 2.0（女声，活泼）" },
    { id: "zh_female_tianmeixiaoyuan_uranus_bigtts", label: "甜美小源 2.0（女声）" },
    { id: "zh_male_m191_uranus_bigtts", label: "云舟 2.0（男声，通用）" },
    { id: "zh_male_taocheng_uranus_bigtts", label: "小天 2.0（男声，通用）" },
  ],
  openai: [
    { id: "nova", label: "Nova（女声，自然）" },
    { id: "shimmer", label: "Shimmer（女声，轻柔）" },
    { id: "alloy", label: "Alloy（中性）" },
    { id: "echo", label: "Echo（男声）" },
    { id: "fable", label: "Fable（男声，叙事）" },
    { id: "onyx", label: "Onyx（男声，低沉）" },
  ],
};

const readJsonBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const readCatalog = async () => {
  try {
    const raw = await readFile(dataPath, "utf8");
    return JSON.parse(raw);
  } catch {
    await writeCatalog(defaultCatalog);
    return defaultCatalog;
  }
};

const writeCatalog = async (catalog) => {
  await mkdir(dirname(dataPath), { recursive: true });
  await writeFile(dataPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
};

const emptyDifyWorkflowConfig = () => ({
  updatedAt: new Date().toISOString(),
  apiBaseUrl: process.env.DIFY_API_BASE_URL ?? "http://127.0.0.1/v1",
  appType: process.env.DIFY_APP_TYPE ?? "chatflow",
  bindings: {},
});

const readDifyWorkflows = async () => {
  try {
    const raw = await readFile(difyWorkflowsPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...emptyDifyWorkflowConfig(),
      ...parsed,
      bindings: parsed.bindings ?? {},
    };
  } catch {
    return emptyDifyWorkflowConfig();
  }
};

const writeDifyWorkflows = async (config) => {
  await mkdir(dirname(difyWorkflowsPath), { recursive: true });
  await writeFile(difyWorkflowsPath, `${JSON.stringify({
    ...config,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
};

const sanitizeDifyWorkflows = (config) => ({
  ...config,
  bindings: Object.fromEntries(Object.entries(config.bindings ?? {}).map(([vehicleId, binding]) => [
    vehicleId,
    {
      ...binding,
      apiKey: undefined,
      configured: Boolean(binding.apiKey),
      tokenPreview: binding.apiKey ? `${binding.apiKey.slice(0, 10)}...${binding.apiKey.slice(-4)}` : "",
    },
  ])),
});

const readChatHistory = async () => {
  try {
    const raw = await readFile(chatHistoryPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      vehicles: parsed.vehicles ?? {},
    };
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      vehicles: {},
    };
  }
};

const writeChatHistory = async (history) => {
  await mkdir(dirname(chatHistoryPath), { recursive: true });
  await writeFile(chatHistoryPath, `${JSON.stringify({
    ...history,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
};

const obsoleteChatAnswer = (text = "") =>
  /智能客服暂时没有响应|智能客服调用失败|Dify工作流没有返回内容/.test(String(text));

const normalizeChatMessages = (messages) => {
  const normalized = Array.isArray(messages)
    ? messages
        .filter((message) => message && (message.role === "user" || message.role === "ai") && typeof message.text === "string")
        .filter((message) => message.role !== "ai" || !obsoleteChatAnswer(message.text))
        .slice(-80)
        .map((message) => ({
          role: message.role,
          text: message.text,
          time: message.time ? String(message.time) : undefined,
          trace: Array.isArray(message.trace) ? message.trace.slice(0, 8) : undefined,
        }))
    : [];

  while (normalized.at(-1)?.role === "user") normalized.pop();
  return normalized;
};

const normalizeCatalog = (body) => {
  const vehicles = Array.isArray(body) ? body : body.vehicles;
  if (!Array.isArray(vehicles) || vehicles.length === 0) {
    throw new Error("vehicles must be a non-empty array");
  }
  return {
    updatedAt: new Date().toISOString(),
    vehicles,
  };
};

const normalizeBaseUrl = (value) => String(value || "http://127.0.0.1/v1").replace(/\/$/, "");

const difyBaseUrl = (binding = {}) => {
  const bindingUrl = normalizeBaseUrl(binding.apiBaseUrl);
  const envUrl = process.env.DIFY_API_BASE_URL ? normalizeBaseUrl(process.env.DIFY_API_BASE_URL) : "";
  if (envUrl && /\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(bindingUrl)) return envUrl;
  return bindingUrl || envUrl || "http://127.0.0.1/v1";
};

const difyConfig = (binding = {}) => ({
  apiKey: binding.apiKey ?? process.env.DIFY_API_KEY ?? "",
  apiBaseUrl: difyBaseUrl(binding),
  appType: (binding.appType ?? process.env.DIFY_APP_TYPE ?? "chatflow").toLowerCase(),
  workflowId: binding.workflowId ?? process.env.DIFY_WORKFLOW_ID ?? "",
  user: binding.user ?? process.env.DIFY_USER ?? "dealer-demo",
});

const fetchDify = async (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Dify request timeout after ${difyTimeoutMs}ms`)), difyTimeoutMs);
  timer.unref?.();
  return fetch(url, {
    ...options,
    signal: controller.signal,
  });
};

const guideInputs = (question, vehicle = {}) => ({
  question,
  vehicle_name: vehicle?.name ?? "",
  vehicle_series: vehicle?.series ?? "",
  vehicle_price: vehicle?.price ?? "",
  vehicle_inventory: String(vehicle?.inventory ?? ""),
  vehicle_slogan: vehicle?.slogan ?? "",
  vehicle_policy: vehicle?.dealerPolicy ?? "",
  vehicle_specs: JSON.stringify(vehicle?.specs ?? []),
  vehicle_context: JSON.stringify(vehicle ?? {}),
});

const specAliasMap = {
  电压: ["多少伏", "电池电压", "电瓶"],
  控制器: ["电控", "几管", "控制器几管"],
  减震: ["避震", "悬挂", "悬架", "震动", "颠不颠", "舒适"],
  轮距: ["轮距", "宽不宽"],
  电机: ["动力", "多少瓦", "功率", "爬坡"],
  轮胎: ["胎", "真空胎", "轮子"],
  速度: ["时速", "跑多快", "最快"],
  轴距: ["轴距"],
  仪表: ["仪表盘", "显示屏"],
  大灯: ["灯", "灯光", "照明"],
  重量: ["载重", "承重", "拉多重", "多重"],
  尺寸: ["长宽高", "车身尺寸", "多大", "大小"],
};

const productFactFiles = {
  tiger: "星瑞plus_产品参数.md",
  q7: "陆尚_产品参数.md",
  a8: "CL9_产品参数.md",
  t5: "H6_产品参数.md",
  k3: "乐萌_产品参数.md",
};

const parseProductFacts = (content) => {
  const facts = [];
  let section = "";
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }

    const keyValue = line.match(/^\*\s+\*\*(.+?)\*\*:\s*(.+)$/);
    if (keyValue) {
      facts.push({
        section,
        key: keyValue[1].trim(),
        value: keyValue[2].trim(),
        text: `${section}·${keyValue[1].trim()}=${keyValue[2].trim()}`,
      });
      continue;
    }

    const bullet = line.match(/^\*\s+(.+)$/);
    if (bullet) {
      facts.push({
        section,
        key: section,
        value: bullet[1].trim(),
        text: `${section}=${bullet[1].trim()}`,
      });
      continue;
    }

    if (section === "参考价格" && line.trim() && !line.startsWith("---")) {
      facts.push({
        section,
        key: "参考价格",
        value: line.trim(),
        text: `参考价格=${line.trim()}`,
      });
    }
  }
  return facts;
};

const loadProductFacts = () => {
  const entries = {};
  for (const [vehicleId, fileName] of Object.entries(productFactFiles)) {
    const filePath = resolve(obsidianSyncPath, fileName);
    if (!existsSync(filePath)) continue;
    entries[vehicleId] = parseProductFacts(readFileSync(filePath, "utf8"));
  }
  return entries;
};

const productFactsByVehicle = loadProductFacts();

const retrievalHintRules = [
  [/电机|多少瓦|几瓦|功率|动力/, ["电机系统", "电机功率", "电机类型", "控制器", "爬坡能力"]],
  [/速度|时速|最高|最快|跑多快/, ["速度性能", "最高时速", "速度表", "新国标限速"]],
  [/续航|跑多远|能跑|电池|多少公里/, ["续航能力", "电池系统", "可选规格", "充电时间"]],
  [/充电|充多久|太阳能/, ["电池系统", "充电时间", "充电电压", "售后保修"]],
  [/轮胎|轮子|胎|真空胎/, ["轮胎配置", "轮胎规格", "轮胎类型", "前轮规格", "后轮规格"]],
  [/刹车|制动|碟刹|鼓刹/, ["刹车系统", "前刹车", "后刹车", "刹车特点"]],
  [/减震|避震|悬挂|颠|舒适/, ["减震系统", "前减震", "后减震", "减震效果"]],
  [/尺寸|长宽高|多大|大小|长度|宽度|高度/, ["尺寸参数", "整车长度", "整车宽度", "整车高度", "轴距", "轮距"]],
  [/载重|承重|拉多重|能载|载人/, ["载重能力", "最大载重", "座位配置", "载人能力"]],
  [/灯|大灯|照明|夜间|尾灯|转向灯/, ["灯光系统", "前大灯", "尾灯", "转向灯", "夜间照明"]],
  [/雨|防水|涉水|淋雨/, ["防水性能", "整车防水等级", "雨天行驶", "线路防水"]],
  [/仪表|显示|屏幕|液晶/, ["仪表显示", "仪表类型", "显示内容", "速度表"]],
  [/颜色|外观|漆|造型/, ["车身结构", "外观特点", "颜色选项", "漆面工艺"]],
  [/保修|售后|维修|质保/, ["售后保修", "整车保修", "电池保修", "售后服务"]],
  [/上牌|驾照|合规|认证|国标/, ["合规认证", "新国标", "合格证", "上牌", "驾照要求"]],
  [/价格|多少钱|报价|标价|成交价|活动价|费用|怎么卖/, ["参考价格", "价格口径", "门店政策"]],
  [/蓝牙|音箱|音乐|喇叭|USB|防盗|钥匙|雨刮|暖风|天窗|倒车/, ["特色功能", "仪表显示", "车身结构"]],
  [/适合|场景|人群|老人|孩子|买菜|通勤|代步/, ["适用场景", "目标人群", "门店导购FAQ话术"]],
];

const factHintRules = [
  [/电机|多少瓦|几瓦|功率|动力|爬坡/, ["电机系统", "控制器", "爬坡能力"]],
  [/速度|时速|最高|最快|跑多快/, ["速度性能"]],
  [/续航|跑多远|能跑|电池|多少公里|充电/, ["电池系统", "续航能力"]],
  [/轮胎|轮子|胎|真空胎/, ["轮胎配置"]],
  [/刹车|制动|碟刹|鼓刹|刹得住/, ["刹车系统"]],
  [/减震|避震|悬挂|颠|舒适/, ["减震系统"]],
  [/尺寸|长宽高|多大|大小|长度|宽度|高度|轴距|轮距/, ["尺寸参数"]],
  [/载重|承重|拉多重|能载|载人|坐几个人/, ["载重能力"]],
  [/灯|大灯|照明|夜间|尾灯|转向灯/, ["灯光系统"]],
  [/雨|防水|涉水|淋雨|雨刮|挡风/, ["防水性能", "特色功能", "车身结构"]],
  [/仪表|显示|屏幕|液晶/, ["仪表显示"]],
  [/颜色|外观|漆|造型|车身/, ["车身结构"]],
  [/保修|售后|维修|质保/, ["售后保修"]],
  [/上牌|驾照|合规|认证|国标|合格证/, ["合规认证"]],
  [/价格|多少钱|报价|标价|成交价|活动价|费用|怎么卖/, ["参考价格"]],
  [/蓝牙|音箱|音乐|喇叭|USB|防盗|钥匙|暖风|天窗|倒车|一键启动|中控锁/, ["特色功能"]],
  [/适合|场景|人群|老人|孩子|买菜|通勤|代步|推荐/, ["适用场景", "目标人群"]],
  [/核心|配置|参数|有哪些|卖点/, ["电机系统", "电池系统", "速度性能", "刹车系统", "减震系统", "载重能力", "特色功能"]],
];

const isVehiclePriceQuestion = (question = "") => {
  const raw = String(question ?? "");
  const asksPrice = /(整车|这车|车辆|车价|售价|价格|多少钱|报价|标价|成交价|活动价|怎么卖|落地价|裸车)/.test(raw);
  if (!asksPrice) return false;
  const asksRunningCost = /(充电|电费|几度电|一度电|充一次|保养|维修|换电池)/.test(raw);
  const explicitlyVehicle = /(整车|这车|车辆|车价|售价|报价|标价|成交价|活动价|怎么卖|落地价|裸车|买)/.test(raw);
  return !asksRunningCost || explicitlyVehicle;
};

const isChargingCostQuestion = (question = "") => {
  const raw = String(question ?? "");
  return /(充电|电费|几度电|一度电|充一次)/.test(raw) && /(多少钱|费用|成本|价格|贵不贵|多少)/.test(raw);
};

const retrievalHints = (question, vehicle = {}) => {
  const raw = String(question ?? "");
  const hints = new Set([vehicle?.name, vehicle?.series].filter(Boolean));
  for (const [pattern, words] of retrievalHintRules) {
    if (pattern.test(raw)) words.forEach((word) => hints.add(word));
  }
  if (isVehiclePriceQuestion(raw)) {
    ["整车价格", "车辆售价", "门店报价", "参考价格", "价格口径", "成交价", "活动价"].forEach((word) => hints.add(word));
  }
  for (const [label, value] of Array.isArray(vehicle?.specs) ? vehicle.specs : []) {
    const terms = [label, ...(specAliasMap[label] ?? [])].filter(Boolean);
    if (terms.some((term) => raw.includes(term))) {
      hints.add(label);
      if (value) hints.add(value);
    }
  }
  return [...hints].filter(Boolean).slice(0, 30);
};

const addUniqueFact = (facts, fact) => {
  const value = String(fact ?? "").trim();
  if (value && !facts.includes(value)) facts.push(value);
};

const relevantProductFacts = (question, vehicle = {}) => {
  const raw = String(question ?? "");
  const facts = productFactsByVehicle[vehicle?.id] ?? [];
  if (!facts.length) return [];

  const sections = new Set();
  for (const [pattern, names] of factHintRules) {
    if (pattern.test(raw)) names.forEach((name) => sections.add(name));
  }

  const rawTerms = raw
    .split(/[，。？！?、\s:：()（）,./]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  const matched = facts.filter((fact) => {
    if (sections.has(fact.section)) return true;
    const text = `${fact.section}${fact.key}${fact.value}`;
    return rawTerms.some((term) => text.includes(term));
  });

  const selected = matched.length ? matched : facts.slice(0, 28);
  return selected.map((fact) => fact.text).slice(0, 55);
};

const relevantVehicleFacts = (question, vehicle = {}) => {
  const raw = String(question ?? "");
  const specs = Array.isArray(vehicle?.specs) ? vehicle.specs : [];
  const facts = [];

  if (isVehiclePriceQuestion(raw)) {
    addUniqueFact(facts, "问题意图=整车售价/门店报价，不是充电费用、用车成本或电机配置");
    addUniqueFact(facts, vehicle?.dealerPolicy);
    addUniqueFact(facts, vehicle?.price ? `展示价=${vehicle.price}` : "");
  } else if (isChargingCostQuestion(raw)) {
    addUniqueFact(facts, "问题意图=充电费用/用车成本，不是整车售价、电机功率或控制器配置");
    addUniqueFact(facts, "当前后台资料未配置电池容量和当地电价，不能直接计算固定充电费用");
    const voltage = specs.find(([label]) => label === "电压")?.[1];
    addUniqueFact(facts, voltage ? `电压=${voltage}` : "");
  }

  if (/(库存|现货|有货|多少台)/.test(raw)) {
    addUniqueFact(facts, vehicle?.inventory !== undefined ? `库存=${vehicle.inventory}台` : "");
  }

  if (/(定位|适合|卖点|推荐|怎么推|怎么介绍|核心|配置|参数|有哪些)/.test(raw)) {
    addUniqueFact(facts, vehicle?.slogan ? `定位卖点=${vehicle.slogan}` : "");
    specs.slice(0, 12).forEach(([label, value]) => addUniqueFact(facts, `${label}=${value}`));
  } else {
    specs.forEach(([label, value]) => {
      const terms = [label, ...(specAliasMap[label] ?? [])].filter(Boolean);
      if (terms.some((term) => raw.includes(term))) addUniqueFact(facts, `${label}=${value}`);
    });
  }

  for (const fact of relevantProductFacts(raw, vehicle)) addUniqueFact(facts, fact);

  if (!facts.length) {
    addUniqueFact(facts, vehicle?.slogan ? `定位卖点=${vehicle.slogan}` : "");
    addUniqueFact(facts, vehicle?.dealerPolicy ? `价格口径=${vehicle.dealerPolicy}` : "");
    specs.slice(0, 12).forEach(([label, value]) => addUniqueFact(facts, `${label}=${value}`));
  }
  return `\n当前车型资料：${facts.join("；")}。\n请直接回答经销商的问题，口吻自然，不要输出思考过程，不要改答其他销售话术。参数类问题必须先给准确参数，再补一句保守的门店讲法。只能使用这里给出的后台配置和检索资料，资料里没有的峰值功率、扭矩、散热、爬坡能力、电池容量、续航、售后承诺、国家标准、合规判断、防扎耐用、绝对够用、预留接口、支持加装、门店可改装、额外收费等判断不要补充。资料没有明确写的功能，只能说当前资料未标注，建议以厂家最新配置单、实车和门店政策确认为准。`;
};

const buildDifyQuestion = (question, vehicle = {}) => {
  const raw = String(question ?? "").trim();
  const vehicleName = String(vehicle?.name ?? "").trim();
  const scopedQuestion = !vehicleName || raw.includes(vehicleName) ? raw : `${vehicleName} ${raw}`;
  const hints = retrievalHints(raw, vehicle);
  const hintText = hints.length ? `\n检索关键词：${hints.join("、")}` : "";
  const intentText = isVehiclePriceQuestion(raw)
    ? "\n回答约束：这是整车售价/门店报价问题。必须优先回答参考价格、展示价或门店价格口径；不要回答电机、电池、充电费用、续航或配置卖点，除非价格说完后作为一句补充。"
    : "";
  return `${scopedQuestion}${intentText}${hintText}${relevantVehicleFacts(raw, vehicle)}`.trim();
};

const buildDifyQuery = (question, vehicle = {}) => {
  const raw = String(question ?? "").trim();
  const vehicleName = String(vehicle?.name ?? "").trim();
  return !vehicleName || raw.includes(vehicleName) ? raw : `${vehicleName} ${raw}`;
};

const parseDifyBody = (text) => {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { answer: text };
  }
};

const findWorkflowText = (payload) => {
  const outputs = payload?.data?.outputs ?? payload?.outputs ?? {};
  const preferredKeys = ["answer", "text", "reply", "response", "result", "content", "output"];

  for (const key of preferredKeys) {
    if (typeof outputs[key] === "string" && outputs[key].trim()) return outputs[key];
  }

  for (const value of Object.values(outputs)) {
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value)) {
      const text = value.find((item) => typeof item === "string" && item.trim());
      if (text) return text;
    }
  }

  if (typeof payload?.answer === "string") return payload.answer;
  if (typeof payload?.data?.text === "string") return payload.data.text;
  return "";
};

const stripMarkdownForSpeech = (text = "") =>
  String(text)
    .replace(/\*\*/g, "")
    .replace(/[#>`*_~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const resolveDoubaoResourceId = (voiceId, resourceId) => {
  if (resourceId) return resourceId;
  if (/_moon_bigtts$/.test(voiceId) || /^BV\d+(_24k)?_streaming$/.test(voiceId)) return "seed-tts-1.0";
  return "seed-tts-2.0";
};

const webStreamToNode = (webStream) => Readable.fromWeb(webStream);

const decodeDoubaoLine = (transform, rawLine) => {
  const line = rawLine.trim().replace(/^data:\s*/, "");
  if (!line || line === "[DONE]") return;
  if (!line.startsWith("{")) return;
  const data = JSON.parse(line);
  const statusCode = Number(data.code ?? data.status_code ?? data.StatusCode ?? 0);
  if (statusCode > 0 && statusCode !== 20000000) {
    throw new Error(`豆包 TTS 流错误 (${statusCode}): ${data.message || data.status_text || "未知错误"}`);
  }
  if (data.data) transform.push(Buffer.from(data.data, "base64"));
};

const decodeDoubaoStream = (webStream) => {
  let pending = "";
  const nodeStream = webStreamToNode(webStream);
  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      pending += chunk.toString("utf8");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      try {
        lines.forEach((line) => decodeDoubaoLine(this, line));
        callback();
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        if (pending.trim()) decodeDoubaoLine(this, pending);
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
  nodeStream.on("error", (error) => transform.destroy(error));
  nodeStream.pipe(transform);
  return transform;
};

const getTtsConfig = () => {
  const provider = (process.env.TTS_PROVIDER || (process.env.SILICONFLOW_API_KEY ? "siliconflow" : process.env.DOUBAO_ACCESS_KEY || process.env.DOUBAO_API_KEY ? "doubao" : process.env.OPENAI_API_KEY ? "openai" : "siliconflow")).toLowerCase();
  const voiceId = process.env.TTS_VOICE_ID || (provider === "openai" ? "nova" : provider === "doubao" ? "zh_female_kefunvsheng_uranus_bigtts" : "FunAudioLLM/CosyVoice2-0.5B:claire");
  const configured = provider === "doubao"
    ? Boolean(process.env.DOUBAO_ACCESS_KEY || process.env.DOUBAO_API_KEY)
    : provider === "openai"
      ? Boolean(process.env.OPENAI_API_KEY)
      : provider === "siliconflow"
        ? Boolean(process.env.SILICONFLOW_API_KEY)
        : false;
  return {
    provider,
    voiceId,
    configured,
    providers: ttsProviders,
    voices: ttsVoices,
  };
};

const streamSiliconFlowTts = async ({ text, voiceId, apiKey, baseURL, model }) => {
  if (!apiKey) throw new Error("硅基流动 TTS 未配置 API Key");
  const selectedVoice = voiceId || "FunAudioLLM/CosyVoice2-0.5B:claire";
  const selectedModel = model || selectedVoice.split(":")[0] || "FunAudioLLM/CosyVoice2-0.5B";
  const response = await fetch(`${(baseURL || "https://api.siliconflow.cn").replace(/\/$/, "")}/v1/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: selectedModel,
      input: text,
      voice: selectedVoice,
      response_format: "mp3",
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`硅基流动 TTS 失败 (${response.status}): ${error.slice(0, 240)}`);
  }

  return webStreamToNode(response.body);
};

const streamDoubaoTts = async ({ text, voiceId, accessKey, apiKey, appId, resourceId }) => {
  const token = accessKey || apiKey;
  if (!token) throw new Error("豆包 TTS 未配置 Access Key 或 API Key");
  const speaker = voiceId || "zh_female_kefunvsheng_uranus_bigtts";
  const resolvedResourceId = resolveDoubaoResourceId(speaker, resourceId);
  const headers = {
    "X-Api-Resource-Id": resolvedResourceId,
    "X-Api-Request-Id": `evguide_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    "Content-Type": "application/json",
  };
  if (appId) headers["X-Api-App-Id"] = appId;
  if (accessKey) headers["X-Api-Access-Key"] = accessKey;
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const response = await fetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
    method: "POST",
    headers,
    body: JSON.stringify({
      user: { uid: "ev-trike-guide" },
      req_params: {
        text,
        speaker,
        audio_params: { format: "mp3", sample_rate: 24000 },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`豆包 TTS 失败 (${response.status}): ${error.slice(0, 240)}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("audio/")) return webStreamToNode(response.body);
  return decodeDoubaoStream(response.body);
};

const streamOpenAITts = async ({ text, voiceId, apiKey, baseURL }) => {
  if (!apiKey) throw new Error("OpenAI TTS 未配置 API Key");
  const response = await fetch(`${(baseURL || "https://api.openai.com").replace(/\/$/, "")}/v1/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "tts-1",
      input: text,
      voice: voiceId || "nova",
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI TTS 失败 (${response.status}): ${error.slice(0, 240)}`);
  }

  return webStreamToNode(response.body);
};

const streamModelTts = async ({ text, provider, voiceId }) => {
  const selectedProvider = provider || getTtsConfig().provider;
  if (selectedProvider === "siliconflow") {
    return streamSiliconFlowTts({
      text,
      voiceId,
      apiKey: process.env.SILICONFLOW_API_KEY,
      baseURL: process.env.SILICONFLOW_BASE_URL,
      model: process.env.SILICONFLOW_TTS_MODEL,
    });
  }
  if (selectedProvider === "doubao") {
    return streamDoubaoTts({
      text,
      voiceId,
      accessKey: process.env.DOUBAO_ACCESS_KEY,
      apiKey: process.env.DOUBAO_API_KEY,
      appId: process.env.DOUBAO_APP_ID,
      resourceId: process.env.DOUBAO_RESOURCE_ID,
    });
  }
  if (selectedProvider === "openai") {
    return streamOpenAITts({
      text,
      voiceId,
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }
  throw new Error(`未知 TTS 服务商: ${selectedProvider}`);
};

const compactText = (value, maxLength = 180) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const buildTrace = ({ question, vehicle = {}, binding = {}, provider = "dify-chatflow", payload = {}, configured = false }) => {
  const resources = payload?.metadata?.retriever_resources ?? payload?.retriever_resources ?? [];
  const usage = payload?.metadata?.usage ?? {};
  const knowledgeBases = Array.isArray(binding.knowledgeBases) ? binding.knowledgeBases : [];
  const trace = [
    {
      title: "接收问题",
      detail: compactText(question, 80),
      status: "done",
    },
    {
      title: "定位车型",
      detail: `${vehicle?.name ?? "当前车型"} · ${vehicle?.series ?? "未配置系列"}`,
      status: "done",
    },
    {
      title: configured ? "调用Dify智能客服工作流" : "Dify工作流未配置",
      detail: configured ? `${normalizeWorkflowName(binding.appName)} · ${provider}` : "当前车型未配置 API Key",
      status: "done",
    },
  ];

  if (knowledgeBases.length) {
    trace.push({
      title: "选择知识库",
      detail: knowledgeBases.map((item) => normalizeKnowledgeName(item.datasetName)).filter(Boolean).join("、"),
      status: "done",
    });
  }

  if (resources.length) {
    trace.push({
      title: "检索命中资料",
      detail: `命中 ${resources.length} 条资料，优先使用 ${normalizeKnowledgeName(resources[0]?.dataset_name ?? resources[0]?.datasetName ?? resources[0]?.metadata?.dataset_name)}`,
      status: "done",
      resources: resources.slice(0, 3).map((resource) => ({
        datasetName: normalizeKnowledgeName(resource.dataset_name ?? resource.datasetName ?? resource.metadata?.dataset_name, ""),
        documentName: resource.document_name ?? resource.documentName ?? resource.metadata?.document_name ?? resource.title ?? "",
        score: typeof resource.score === "number" ? Number(resource.score.toFixed(3)) : typeof resource.metadata?.score === "number" ? Number(resource.metadata.score.toFixed(3)) : undefined,
        snippet: compactText(resource.content, 160),
      })),
    });
  }

  trace.push({
    title: "生成产品回答",
    detail: usage.latency ? `已生成回答，用时约 ${Number(usage.latency).toFixed(1)} 秒` : "已根据当前车型资料生成回答",
    status: "done",
  });

  return trace;
};

const buildPendingTrace = ({ question, vehicle = {}, binding = {}, provider = "dify-chatflow", configured = false }) => {
  const knowledgeBases = Array.isArray(binding.knowledgeBases) ? binding.knowledgeBases : [];
  const trace = [
    {
      title: "接收问题",
      detail: compactText(question, 80),
      status: "active",
    },
    {
      title: "定位车型",
      detail: `${vehicle?.name ?? "当前车型"} · ${vehicle?.series ?? "未配置系列"}`,
      status: "active",
    },
    {
      title: configured ? "调用Dify智能客服工作流" : "Dify工作流未配置",
      detail: configured ? `${normalizeWorkflowName(binding.appName)} · ${provider}` : "当前车型未配置 API Key",
      status: "active",
    },
  ];

  if (knowledgeBases.length) {
    trace.push({
      title: "选择知识库",
      detail: knowledgeBases.map((item) => normalizeKnowledgeName(item.datasetName)).filter(Boolean).join("、"),
      status: "active",
    });
  }

  return trace;
};

const runDifyWorkflow = async ({ question, vehicle }, config) => {
  const difyQuestion = buildDifyQuestion(question, vehicle);
  const endpoint = config.workflowId
    ? `${config.apiBaseUrl}/workflows/${config.workflowId}/run`
    : `${config.apiBaseUrl}/workflows/run`;
  const payload = {
    inputs: {
      ...guideInputs(difyQuestion, vehicle),
      original_question: question,
    },
    response_mode: "blocking",
    user: config.user,
  };

  const difyResponse = await fetchDify(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = parseDifyBody(await difyResponse.text());

  if (!difyResponse.ok) {
    throw new Error(body.message || body.error || `Dify request failed: ${difyResponse.status}`);
  }

  return {
    answer: findWorkflowText(body),
    provider: "dify-workflow",
    taskId: body.task_id ?? body.taskId,
    workflowRunId: body.workflow_run_id ?? body.data?.id,
    raw: body,
    configured: true,
  };
};

const runDifyChatflow = async ({ question, vehicle, conversationId = "" }, config) => {
  const difyQuestion = buildDifyQuestion(question, vehicle);
  const difyQuery = buildDifyQuery(question, vehicle);
  const payload = {
    inputs: {
      ...guideInputs(difyQuestion, vehicle),
      original_question: question,
    },
    query: difyQuery,
    response_mode: "blocking",
    conversation_id: conversationId,
    user: config.user,
  };

  const difyResponse = await fetchDify(`${config.apiBaseUrl}/chat-messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = parseDifyBody(await difyResponse.text());

  if (!difyResponse.ok) {
    throw new Error(body.message || body.error || `Dify request failed: ${difyResponse.status}`);
  }

  return {
    answer: body.answer || findWorkflowText(body),
    provider: "dify-chatflow",
    conversationId: body.conversation_id ?? conversationId,
    messageId: body.message_id,
    raw: body,
    configured: true,
  };
};

const runDifyGuide = async ({ question, vehicle, conversationId }) => {
  const workflowConfig = await readDifyWorkflows();
  const binding = workflowConfig.bindings?.[vehicle?.id] ?? {};
  const config = difyConfig(binding);
  if (!config.apiKey) {
    throw new Error("当前车型未配置Dify工作流 API Key");
  }

  if (config.appType === "workflow") {
    const result = await runDifyWorkflow({ question, vehicle }, config);
    if (!result.answer) throw new Error("Dify工作流没有返回内容");
    return {
      ...result,
      bindingName: normalizeWorkflowName(binding.appName, ""),
      appId: binding.appId ?? "",
      trace: buildTrace({ question, vehicle, binding, provider: result.provider, payload: result.raw, configured: true }),
    };
  }

  const result = await runDifyChatflow({ question, vehicle, conversationId }, config);
  if (!result.answer) throw new Error("Dify工作流没有返回内容");
  return {
    ...result,
    bindingName: normalizeWorkflowName(binding.appName, ""),
    appId: binding.appId ?? "",
    trace: buildTrace({ question, vehicle, binding, provider: result.provider, payload: result.raw, configured: true }),
  };
};

const readSsePayloads = async (body, onPayload) => {
  const decoder = new TextDecoder();
  const readBlock = async (block) => {
    const lines = block.split(/\r?\n/);
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, ""))
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    try {
      await onPayload(JSON.parse(data));
    } catch {
      await onPayload({ answer: data });
    }
  };

  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) await readBlock(block);
  }
  buffer += decoder.decode();
  if (buffer.trim()) await readBlock(buffer);
};

const streamText = async (response, text) => {
  const value = String(text ?? "");
  for (let index = 0; index < value.length; index += 8) {
    sendStream(response, "delta", { text: value.slice(index, index + 8) });
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
};

const createGuideDeltaWriter = (response) => {
  let streamed = "";

  const writeText = (text) => {
    if (!text) return;
    streamed += text;
    sendStream(response, "delta", { text });
  };

  const push = (delta) => {
    const text = String(delta ?? "");
    if (!text) return;
    writeText(text);
  };

  const flush = () => {
    return streamed.trim();
  };

  return { push, flush, getStreamed: () => streamed.trim() };
};

const collectResources = (payload, resources) => {
  const direct = payload?.metadata?.retriever_resources ?? payload?.retriever_resources ?? [];
  if (Array.isArray(direct)) resources.push(...direct);
  const nodeResults = payload?.data?.outputs?.result;
  if (Array.isArray(nodeResults)) {
    resources.push(...nodeResults.filter((item) => item?.content || item?.metadata));
  }
};

const extractStreamDelta = (payload) => {
  if (typeof payload?.answer === "string") return payload.answer;
  if (typeof payload?.text === "string") return payload.text;
  if (typeof payload?.data?.text === "string") return payload.data.text;
  if (typeof payload?.data?.answer === "string") return payload.data.answer;
  if (typeof payload?.data?.outputs?.answer === "string") return payload.data.outputs.answer;
  return "";
};

const extractWorkflowOutput = (payload) => findWorkflowText(payload) || payload?.data?.outputs?.answer || payload?.data?.outputs?.text || "";

const runDifyWorkflowStream = async ({ question, vehicle }, config, binding, response) => {
  const difyQuestion = buildDifyQuestion(question, vehicle);
  const endpoint = config.workflowId
    ? `${config.apiBaseUrl}/workflows/${config.workflowId}/run`
    : `${config.apiBaseUrl}/workflows/run`;
  const payload = {
    inputs: {
      ...guideInputs(difyQuestion, vehicle),
      original_question: question,
    },
    response_mode: "streaming",
    user: config.user,
  };

  const difyResponse = await fetchDify(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!difyResponse.ok) {
    const body = parseDifyBody(await difyResponse.text());
    throw new Error(body.message || body.error || `Dify request failed: ${difyResponse.status}`);
  }

  let answer = "";
  const deltaWriter = createGuideDeltaWriter(response);
  const holdDeltas = isVehiclePriceQuestion(question);
  let finalPayload = {};
  let workflowRunId = "";
  const resources = [];

  await readSsePayloads(difyResponse.body, async (payloadChunk) => {
    collectResources(payloadChunk, resources);
    workflowRunId = payloadChunk.workflow_run_id ?? payloadChunk.data?.id ?? workflowRunId;

    const delta = extractStreamDelta(payloadChunk);
    if ((payloadChunk.event === "text_chunk" || payloadChunk.event === "message" || payloadChunk.event === "agent_message") && delta) {
      answer += delta;
      if (!holdDeltas) deltaWriter.push(delta);
    }

    if (payloadChunk.event === "workflow_finished") {
      finalPayload = payloadChunk;
      const output = extractWorkflowOutput(payloadChunk);
      if (output && !answer) {
        answer = output;
        if (!holdDeltas) deltaWriter.push(output);
      }
    }
  });

  const streamedAnswer = deltaWriter.flush();
  answer = (answer.trim() || streamedAnswer).trim();

  if (!answer) {
    throw new Error("Dify工作流没有返回内容");
  }
  if (holdDeltas) await streamText(response, answer);

  const payloadForTrace = {
    ...finalPayload,
    metadata: {
      ...(finalPayload.metadata ?? {}),
      retriever_resources: finalPayload.metadata?.retriever_resources?.length ? finalPayload.metadata.retriever_resources : resources,
    },
  };
  const trace = buildTrace({
    question,
    vehicle,
    binding,
    provider: "dify-workflow",
    payload: payloadForTrace,
    configured: true,
  });
  sendStream(response, "trace", { trace });
  sendStream(response, "done", {
    answer,
    workflowRunId,
    trace,
  });
};

const runDifyChatflowStream = async ({ question, vehicle, conversationId = "" }, config, binding, response) => {
  const difyQuestion = buildDifyQuestion(question, vehicle);
  const difyQuery = buildDifyQuery(question, vehicle);
  const payload = {
    inputs: {
      ...guideInputs(difyQuestion, vehicle),
      original_question: question,
    },
    query: difyQuery,
    response_mode: "streaming",
    conversation_id: conversationId,
    user: config.user,
  };

  const difyResponse = await fetchDify(`${config.apiBaseUrl}/chat-messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!difyResponse.ok) {
    const body = parseDifyBody(await difyResponse.text());
    throw new Error(body.message || body.error || `Dify request failed: ${difyResponse.status}`);
  }

  let answer = "";
  const deltaWriter = createGuideDeltaWriter(response);
  const holdDeltas = isVehiclePriceQuestion(question);
  let finalPayload = {};
  let nextConversationId = conversationId;
  let messageId = "";
  const resources = [];

  await readSsePayloads(difyResponse.body, async (payloadChunk) => {
    collectResources(payloadChunk, resources);
    nextConversationId = payloadChunk.conversation_id ?? nextConversationId;
    messageId = payloadChunk.message_id ?? messageId;

    const delta = extractStreamDelta(payloadChunk);
    const isAnswerNode = payloadChunk.event === "node_finished" && payloadChunk.data?.node_type === "answer";
    if ((payloadChunk.event === "message" || payloadChunk.event === "agent_message" || isAnswerNode) && delta) {
      const duplicateDelta = answer && (answer.includes(delta) || delta.includes(answer));
      if (!duplicateDelta) {
        answer += delta;
        if (!holdDeltas) deltaWriter.push(delta);
      }
    }

    if (payloadChunk.event === "message_end" || payloadChunk.event === "workflow_finished") {
      finalPayload = payloadChunk;
    }
  });

  const streamedAnswer = deltaWriter.flush();
  answer = (answer.trim() || streamedAnswer).trim();

  if (!answer) {
    throw new Error("Dify工作流没有返回内容");
  }
  if (holdDeltas) await streamText(response, answer);

  const payloadForTrace = {
    ...finalPayload,
    metadata: {
      ...(finalPayload.metadata ?? {}),
      retriever_resources: finalPayload.metadata?.retriever_resources?.length ? finalPayload.metadata.retriever_resources : resources,
    },
  };
  const trace = buildTrace({
    question,
    vehicle,
    binding,
    provider: "dify-chatflow",
    payload: payloadForTrace,
    configured: true,
  });
  sendStream(response, "trace", { trace });
  sendStream(response, "done", {
    answer,
    conversationId: nextConversationId,
    messageId,
    trace,
  });
};

const streamDifyGuide = async ({ question, vehicle, conversationId }, response) => {
  response.writeHead(200, streamHeaders);
  const workflowConfig = await readDifyWorkflows();
  const binding = workflowConfig.bindings?.[vehicle?.id] ?? {};
  const config = difyConfig(binding);

  try {
    sendStream(response, "trace", {
      trace: buildPendingTrace({ question, vehicle, binding, provider: config.appType === "workflow" ? "dify-workflow" : "dify-chatflow", configured: Boolean(config.apiKey) }),
    });

    if (!config.apiKey) {
      throw new Error("当前车型未配置Dify工作流 API Key");
    }

    if (config.appType === "workflow") {
      await runDifyWorkflowStream({ question, vehicle }, config, binding, response);
      response.end();
      return;
    }

    await runDifyChatflowStream({ question, vehicle, conversationId }, config, binding, response);
    response.end();
  } catch (error) {
    const trace = buildTrace({
      question,
      vehicle,
      binding,
      provider: config.appType === "workflow" ? "dify-workflow" : "dify-chatflow",
      configured: Boolean(config.apiKey),
    });
    trace[trace.length - 1] = {
      title: "工作流调用失败",
      detail: compactText(error.message, 120),
      status: "error",
    };
    sendStream(response, "trace", { trace });
    sendStream(response, "error", { message: error.message });
    response.end();
  }
};

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, jsonHeaders);
    response.end();
    return;
  }

  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      send(response, 200, { ok: true, service: "ev-trike-config-api" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/catalog") {
      send(response, 200, await readCatalog());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/dify-workflows") {
      send(response, 200, sanitizeDifyWorkflows(await readDifyWorkflows()));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/tts-config") {
      send(response, 200, getTtsConfig());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/chat-history") {
      const vehicleId = url.searchParams.get("vehicleId") ?? "";
      const knowledgeSignature = url.searchParams.get("knowledgeSignature") ?? "";
      const history = await readChatHistory();
      if (vehicleId) {
        const vehicleHistory = history.vehicles[vehicleId] ?? { messages: [], conversationId: "" };
        if (knowledgeSignature && vehicleHistory.knowledgeSignature !== knowledgeSignature) {
          send(response, 200, { vehicleId, messages: [], conversationId: "" });
          return;
        }
        send(response, 200, vehicleHistory);
        return;
      }

      send(response, 200, history);
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/catalog") {
      const catalog = normalizeCatalog(await readJsonBody(request));
      await writeCatalog(catalog);
      send(response, 200, catalog);
      return;
    }

    if (request.method === "PUT" && url.pathname.startsWith("/api/dify-workflows/")) {
      const vehicleId = decodeURIComponent(url.pathname.replace("/api/dify-workflows/", "")).trim();
      if (!vehicleId) throw new Error("vehicle id is required");
      const body = await readJsonBody(request);
      const config = await readDifyWorkflows();
      const previous = config.bindings?.[vehicleId] ?? {};
      const nextBinding = {
        ...previous,
        vehicleId,
        vehicleName: String(body.vehicleName ?? previous.vehicleName ?? ""),
        appName: String(body.appName ?? previous.appName ?? ""),
        appId: String(body.appId ?? previous.appId ?? ""),
        workflowId: String(body.workflowId ?? previous.workflowId ?? ""),
        apiBaseUrl: String(body.apiBaseUrl ?? previous.apiBaseUrl ?? config.apiBaseUrl ?? "http://127.0.0.1/v1"),
        appType: String(body.appType ?? previous.appType ?? config.appType ?? "chatflow"),
        user: String(body.user ?? previous.user ?? process.env.DIFY_USER ?? "dealer-demo"),
        apiKey: typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : previous.apiKey,
      };
      config.bindings = {
        ...(config.bindings ?? {}),
        [vehicleId]: nextBinding,
      };
      await writeDifyWorkflows(config);
      send(response, 200, sanitizeDifyWorkflows(config).bindings[vehicleId]);
      return;
    }

    if (request.method === "PUT" && url.pathname.startsWith("/api/chat-history/")) {
      const vehicleId = decodeURIComponent(url.pathname.replace("/api/chat-history/", "")).trim();
      if (!vehicleId) throw new Error("vehicle id is required");
      const body = await readJsonBody(request);
      const history = await readChatHistory();
      history.vehicles[vehicleId] = {
        vehicleId,
        vehicleName: String(body.vehicleName ?? ""),
        conversationId: String(body.conversationId ?? ""),
        knowledgeSignature: String(body.knowledgeSignature ?? ""),
        messages: normalizeChatMessages(body.messages),
        updatedAt: new Date().toISOString(),
      };
      await writeChatHistory(history);
      send(response, 200, history.vehicles[vehicleId]);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/tts/stream") {
      const body = await readJsonBody(request);
      const text = stripMarkdownForSpeech(body.text).slice(0, 800);
      if (!text) {
        send(response, 400, { error: "text is required" });
        return;
      }

      const ttsConfig = getTtsConfig();
      const provider = String(body.provider || ttsConfig.provider || "").trim();
      const voiceId = String(body.voiceId || ttsConfig.voiceId || "").trim();
      if (!ttsConfig.configured) {
        send(response, 400, {
          error: "TTS 模型音色还没配置，请在 .env 配置 SILICONFLOW_API_KEY、DOUBAO_ACCESS_KEY/DOUBAO_API_KEY 或 OPENAI_API_KEY",
          needsConfig: true,
          provider,
        });
        return;
      }

      try {
        const audioStream = await streamModelTts({ text, provider, voiceId });
        response.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-cache, no-transform",
          "Transfer-Encoding": "chunked",
        });
        audioStream.on("data", (chunk) => response.write(chunk));
        audioStream.on("end", () => response.end());
        audioStream.on("error", (error) => {
          console.warn("[TTS] stream error:", error.message);
          try { response.end(); } catch {}
        });
      } catch (error) {
        if (!response.headersSent) send(response, 500, { error: error.message });
        else response.end();
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reset") {
      const catalog = { ...defaultCatalog, updatedAt: new Date().toISOString() };
      await writeCatalog(catalog);
      send(response, 200, catalog);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ai-guide/stream") {
      const body = await readJsonBody(request);
      const question = String(body.question ?? "").trim();
      if (!question) throw new Error("question is required");
      await streamDifyGuide({
        question,
        vehicle: body.vehicle ?? {},
        conversationId: body.conversationId ?? body.conversation_id ?? "",
      }, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ai-guide") {
      const body = await readJsonBody(request);
      const question = String(body.question ?? "").trim();
      if (!question) throw new Error("question is required");
      send(response, 200, await runDifyGuide({
        question,
        vehicle: body.vehicle ?? {},
        conversationId: body.conversationId ?? body.conversation_id ?? "",
      }));
      return;
    }

    if (await serveStatic(request, response, url.pathname)) return;

    send(response, 404, { error: "Not found" });
  } catch (error) {
    send(response, 400, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`EV trike platform listening at http://${host}:${port}`);
});
