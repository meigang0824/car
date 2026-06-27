import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const catalogPath = join(root, "data/catalog.json");
const envPath = join(root, ".env");
const outputDir = join(root, "data/faqs");
const model = process.env.SILICONFLOW_FAQ_MODEL || "Qwen/Qwen2.5-14B-Instruct";

const readEnv = async () => {
  const env = {};
  try {
    const raw = await readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^([^#=\s]+)=(.*)$/);
      if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {}
  return env;
};

const specValue = (vehicle, label) => vehicle.specs.find(([key]) => key === label)?.[1] ?? "";

const vehicleFacts = (vehicle) => {
  const specs = Object.fromEntries(vehicle.specs);
  return [
    `车型：${vehicle.name}`,
    `系列：${vehicle.series}`,
    `定位/卖点：${vehicle.slogan}`,
    `价格政策：${vehicle.dealerPolicy}`,
    `展示价：${vehicle.price}`,
    `库存：${vehicle.inventory}台`,
    `配置参数：${Object.entries(specs).map(([key, value]) => `${key}=${value}`).join("；")}`,
  ].join("\n");
};

const exactFactText = (vehicle) => {
  const specs = Object.fromEntries(vehicle.specs);
  return JSON.stringify({
    车型: vehicle.name,
    系列: vehicle.series,
    定位卖点: vehicle.slogan,
    展示价: vehicle.price,
    库存: `${vehicle.inventory}台`,
    经销商政策: vehicle.dealerPolicy,
    参数: specs,
  }, null, 2);
};

const categories = [
  ["产品配置", [
    (v) => `${v.name}的核心配置有哪些？`,
    (v) => `${v.name}最适合主推哪几个配置点？`,
    (v) => `${v.name}的电压配置怎么跟客户说？`,
    (v) => `${v.name}的控制器是什么配置？`,
    (v) => `${v.name}的减震配置有什么优势？`,
    (v) => `${v.name}的轮胎规格适合什么路况？`,
    (v) => `${v.name}的大灯配置怎么介绍？`,
    (v) => `${v.name}的仪表配置怎么讲？`,
    (v) => `${v.name}的尺寸和轴距怎么给客户解释？`,
    (v) => `${v.name}的载重能力适合哪些用途？`,
  ]],
  ["外观与内饰", [
    (v) => `${v.name}外观看起来适合什么客户？`,
    (v) => `${v.name}车身尺寸大不大？`,
    (v) => `${v.name}坐进去会不会显得局促？`,
    (v) => `${v.name}适合老人上下车吗？`,
    (v) => `${v.name}适合接送孩子吗？`,
    (v) => `${v.name}的仪表看起来实用吗？`,
    (v) => `${v.name}晚上看车时应该重点展示哪里？`,
    (v) => `${v.name}外观怎么讲才不生硬？`,
    (v) => `${v.name}客户嫌外观普通时怎么回应？`,
    (v) => `${v.name}客户坐进去后导购应该怎么引导体验？`,
  ]],
  ["动力与续航", [
    (v) => `${v.name}电机多大？`,
    (v) => `${v.name}动力够不够日常代步？`,
    (v) => `${v.name}坐两个人会不会吃力？`,
    (v) => `${v.name}适合爬坡路段吗？`,
    (v) => `${v.name}最高速度是多少？`,
    (v) => `${v.name}速度为什么不是越快越好？`,
    (v) => `${v.name}电压配置对使用有什么影响？`,
    (v) => `${v.name}控制器对骑行有什么帮助？`,
    (v) => `${v.name}续航应该怎么跟客户沟通？`,
    (v) => `${v.name}客户担心电不够用怎么回答？`,
  ]],
  ["安全配置", [
    (v) => `${v.name}安全性怎么介绍？`,
    (v) => `${v.name}大灯对夜间骑行有什么帮助？`,
    (v) => `${v.name}轮胎对安全有什么作用？`,
    (v) => `${v.name}减震对安全有帮助吗？`,
    (v) => `${v.name}车身尺寸对稳定性有什么影响？`,
    (v) => `${v.name}限速在${specValue(v, "速度")}怎么解释？`,
    (v) => `${v.name}带老人或孩子安全吗？`,
    (v) => `${v.name}雨天出门怎么跟客户讲安全感？`,
    (v) => `${v.name}载重${specValue(v, "重量")}怎么提醒客户合理使用？`,
    (v) => `${v.name}客户担心三轮车不稳怎么回应？`,
  ]],
  ["使用与保养", [
    (v) => `${v.name}日常使用要注意什么？`,
    (v) => `${v.name}适合每天短途使用吗？`,
    (v) => `${v.name}轮胎日常怎么保养？`,
    (v) => `${v.name}减震平时需要特别维护吗？`,
    (v) => `${v.name}电机日常使用怎么更省心？`,
    (v) => `${v.name}大灯平时需要经常换吗？`,
    (v) => `${v.name}仪表使用时要注意什么？`,
    (v) => `${v.name}雨天使用要提醒客户什么？`,
    (v) => `${v.name}长期停放要怎么提醒客户？`,
    (v) => `${v.name}新车交付时导购要教客户哪些使用点？`,
  ]],
  ["售后服务", [
    (v) => `${v.name}售后怎么跟客户讲更稳妥？`,
    (v) => `${v.name}客户问保修多久怎么回答？`,
    (v) => `${v.name}客户担心后期维修麻烦怎么回应？`,
    (v) => `${v.name}客户问配件好不好换怎么说？`,
    (v) => `${v.name}交车前要帮客户确认哪些项目？`,
    (v) => `${v.name}客户问电机售后怎么说？`,
    (v) => `${v.name}客户问轮胎后期维护怎么说？`,
    (v) => `${v.name}客户担心小问题没人管怎么回应？`,
    (v) => `${v.name}售后政策没统一时导购怎么说？`,
    (v) => `${v.name}如何用门店服务增强客户信任？`,
  ]],
  ["价格与优惠", [
    (v) => `${v.name}多少钱？`,
    (v) => `${v.name}门店标价和建议成交价怎么说？`,
    (v) => `${v.name}客户嫌贵怎么回应？`,
    (v) => `${v.name}价格能不能优惠？`,
    (v) => `${v.name}和低价车相比贵在哪里？`,
    (v) => `${v.name}怎么把价格讲得有价值感？`,
    (v) => `${v.name}适合作为门店主推款吗？`,
    (v) => `${v.name}客户只看价格怎么引导？`,
    (v) => `${v.name}成交时怎么自然收口？`,
    (v) => `${v.name}预算有限的客户适合买吗？`,
  ]],
  ["与竞品对比", [
    (v) => `${v.name}和同价位车型比优势在哪里？`,
    (v) => `${v.name}和更便宜的三轮车怎么对比？`,
    (v) => `${v.name}和高配车型比怎么讲？`,
    (v) => `${v.name}适合拿来对比哪类客户需求？`,
    (v) => `${v.name}客户说别家配置更高怎么回应？`,
    (v) => `${v.name}客户说别家价格更低怎么回应？`,
    (v) => `${v.name}怎么不攻击竞品地讲优势？`,
    (v) => `${v.name}对比时应该先问客户什么？`,
    (v) => `${v.name}配置均衡体现在哪里？`,
    (v) => `${v.name}怎么跟客户说买车不能只看单个参数？`,
  ]],
  ["常见异议", [
    (v) => `${v.name}客户担心动力不够怎么办？`,
    (v) => `${v.name}客户担心续航怎么办？`,
    (v) => `${v.name}客户担心车太大怎么办？`,
    (v) => `${v.name}客户担心车太小怎么办？`,
    (v) => `${v.name}客户担心载重不够怎么办？`,
    (v) => `${v.name}客户担心轮胎不耐用怎么办？`,
    (v) => `${v.name}客户担心减震不舒服怎么办？`,
    (v) => `${v.name}客户说再看看怎么跟进？`,
    (v) => `${v.name}客户拿价格压价怎么回应？`,
    (v) => `${v.name}客户犹豫不下单怎么收口？`,
  ]],
  ["购买建议", [
    (v) => `${v.name}最适合什么客户买？`,
    (v) => `${v.name}适合家庭代步吗？`,
    (v) => `${v.name}适合老人买吗？`,
    (v) => `${v.name}适合接孩子买吗？`,
    (v) => `${v.name}适合乡镇赶集吗？`,
    (v) => `${v.name}适合上下班通勤吗？`,
    (v) => `${v.name}导购推荐时第一句话怎么说？`,
    (v) => `${v.name}客户试骑后怎么推动成交？`,
    (v) => `${v.name}什么情况下不建议客户买？`,
    (v) => `${v.name}成交前最后怎么帮客户确认？`,
  ]],
];

const generateQuestions = (vehicle) => {
  const questions = categories.flatMap(([, builders]) => builders.map((build) => build(vehicle)));
  const unique = [...new Set(questions)];
  if (unique.length !== 100) {
    throw new Error(`${vehicle.name} generated ${unique.length} unique questions, expected 100`);
  }
  return unique;
};

const allowedNumbers = (vehicle, question) => {
  const source = `${exactFactText(vehicle)}\n${question}`;
  return new Set(source.match(/\d+(?:\.\d+)?/g) ?? []);
};

const answerLooksSafe = (answer, vehicle, question) => {
  if (!answer || /�|Mourinho|^\s*user\s/i.test(answer)) return false;
  if (/无法回答|未知|不清楚/.test(answer)) return false;
  const allowed = allowedNumbers(vehicle, question);
  const numbers = answer.match(/\d+(?:\.\d+)?/g) ?? [];
  return numbers.every((number) => allowed.has(number));
};

const fallbackAnswer = (question, vehicle) => {
  const specs = Object.fromEntries(vehicle.specs);
  const name = vehicle.name;
  const value = (key) => specs[key] ?? "";
  const priceText = vehicle.dealerPolicy;
  const core = `核心配置可以这样讲：${name}是${vehicle.series}，${vehicle.slogan}。参数上有${value("电压")}电压、${value("电机")}、${value("控制器")}、${value("减震")}、${value("轮胎")}，速度${value("速度")}，尺寸${value("尺寸")}。门店介绍时别堆参数，重点说它适合客户日常代步和接送家人。`;
  if (/多少钱|价格|标价|成交价|活动价|结算价|优惠/.test(question)) {
    return `${priceText} 讲价格时先问用途和预算，再把配置价值说清楚。客户如果只看低价，可以引导他看动力、轮胎、减震和日常使用是否省心。`;
  }
  if (/电机|动力|爬坡|吃力|多少瓦|功率/.test(question)) {
    return `${name}的电机是${value("电机")}。导购可以说，这套动力更适合${vehicle.series}的日常代步场景，接送孩子、买菜、短途出行够用，试骑时让客户感受起步和平顺性。`;
  }
  if (/控制器|电控|几管/.test(question)) {
    return `${name}用的是${value("控制器")}。这类配置不要讲得太技术，直接告诉客户：控制器关系到起步、加速和平顺感，日常骑起来顺不顺，试一下就能感受到。`;
  }
  if (/电压|电池|电瓶|续航|电不够/.test(question)) {
    return `${name}的电压配置是${value("电压")}。续航沟通时不要报死数，实际会受电池、载重、路况和骑法影响。导购可以结合客户每天跑多远，按门店实测和厂家配置单来说明。`;
  }
  if (/减震|避震|悬挂|舒服/.test(question)) {
    return `${name}的减震是${value("减震")}。可以让客户坐上去感受一下，走社区路、买菜路、接孩子路段时，好的减震能减少颠簸，坐着更舒服，也更省心。`;
  }
  if (/轮胎|真空胎|路况|耐用/.test(question)) {
    return `${name}的轮胎是${value("轮胎")}。导购可以说，轮胎关系到抓地、通过性和日常维护，客户平时走小区路、乡镇路、买菜赶集，都要选让自己放心的轮胎规格。`;
  }
  if (/大灯|灯光|夜间|晚上|照明/.test(question)) {
    return `${name}配的是${value("大灯")}。晚上接孩子、下班回家、雨天傍晚出门，灯光看得清很重要。可以现场开灯给客户看，让他自己感受亮度和安全感。`;
  }
  if (/仪表|显示/.test(question)) {
    return `${name}配的是${value("仪表")}。导购可以说，仪表主要看清不清楚、用起来方不方便。客户日常骑车时，速度和车辆状态一眼能看明白，就更省心。`;
  }
  if (/尺寸|轴距|轮距|大不大|太大|太小|稳定|坐进去|局促/.test(question)) {
    return `${name}的尺寸是${value("尺寸")}，轴距${value("轴距")}，轮距${value("轮距")}。讲尺寸时别只报数字，要让客户坐进去、看转弯空间和停车位置，合不合适一体验就清楚。`;
  }
  if (/载重|承重|带老人|带孩子|两个人/.test(question)) {
    return `${name}的载重资料是${value("重量")}。导购要提醒客户按合理载重使用，别超负荷。日常接孩子、买菜、短途代步，重点让客户看车身稳定性和乘坐感受。`;
  }
  if (/售后|保修|维修|配件|交车|服务/.test(question)) {
    return `售后这块建议按门店实际政策说清楚，不要随口承诺。介绍${name}时，可以把${value("电机")}、${value("轮胎")}、${value("减震")}这些常用配置讲透，再告诉客户交车前会帮他检查和讲解使用注意事项。`;
  }
  if (/竞品|同价位|便宜|高配|对比|别家/.test(question)) {
    return `对比时不要攻击别人，先问客户用途。${name}可以从${vehicle.slogan}切入，再结合${value("电机")}、${value("轮胎")}、${value("减震")}和价格政策讲价值，让客户知道买车不是只看一个参数。`;
  }
  if (/犹豫|再看看|压价|下单|成交|收口/.test(question)) {
    return `客户犹豫时，别急着催。可以带他再看${name}的${value("电机")}、${value("减震")}、${value("轮胎")}，再问一句：您主要是接孩子、买菜还是上下班？用途对上了，再结合${priceText}自然收口。`;
  }
  if (/适合|推荐|主推|购买|老人|家庭|接孩子|赶集|上下班/.test(question)) {
    return `${name}适合的客户可以从用途判断：${vehicle.slogan}。如果客户主要是家庭代步、接送孩子、买菜或短途出行，就重点讲${value("电机")}、${value("减震")}、${value("轮胎")}带来的省心感。`;
  }
  return core;
};

const callLlm = async ({ apiKey, baseUrl, question, vehicle, index }) => {
  if (process.env.FACT_LOCK_ONLY === "1") return fallbackAnswer(question, vehicle);

  const messages = [
    {
      role: "system",
      content: [
        "你是有10年以上门店销售经验的电动三轮车金牌导购培训师。",
        "必须只使用用户给出的JSON事实，不得改写任何数字、单位、价格、配置名称。",
        "不要编造资料里没有的具体参数、保修时长、续航里程、优惠政策。",
        "资料没有明确的信息，只围绕已有事实做销售解释，并建议按门店实际政策确认。",
        "回答自然口语化，70到120个中文字，直接输出答案，不要编号，不要Markdown标题，不要使用数字序号。",
      ].join("\n"),
    },
    {
      role: "user",
      content: `JSON事实：\n${exactFactText(vehicle)}\n\n问题：${question}`,
    },
  ];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        max_tokens: 180,
      }),
    });
    const text = await response.text();
    if (response.ok) {
      const body = JSON.parse(text);
      const answer = body.choices?.[0]?.message?.content?.trim();
      const cleaned = answer?.replace(/\s+/g, " ").trim();
      if (answerLooksSafe(cleaned, vehicle, question)) return cleaned;
      if (attempt === 3 && cleaned) {
        console.warn(`FALLBACK ${vehicle.name} Q${index}: unsafe answer ${JSON.stringify(cleaned.slice(0, 100))}`);
        return fallbackAnswer(question, vehicle);
      }
    }
    if (attempt === 3) {
      console.warn(`FALLBACK ${vehicle.name} Q${index}: ${response.status} ${text.slice(0, 120)}`);
      return fallbackAnswer(question, vehicle);
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
  }
};

const removeOldFaqFiles = async () => {
  await mkdir(outputDir, { recursive: true });
  const files = await readdir(outputDir);
  await Promise.all(files.filter((file) => /faq/i.test(file) && file.endsWith(".txt")).map((file) => rm(join(outputDir, file), { force: true })));
};

const validateFaqText = (text, vehicleName) => {
  const qCount = (text.match(/^Q\d+：/gm) ?? []).length;
  const aCount = (text.match(/^A\d+：/gm) ?? []).length;
  const questions = [...text.matchAll(/^Q\d+：(.*)$/gm)].map((match) => match[1].trim());
  const uniqueQuestions = new Set(questions);
  if (qCount !== 100 || aCount !== 100 || uniqueQuestions.size !== 100) {
    throw new Error(`${vehicleName} validation failed: Q=${qCount}, A=${aCount}, uniqueQ=${uniqueQuestions.size}`);
  }
};

const main = async () => {
  const env = await readEnv();
  const apiKey = process.env.SILICONFLOW_API_KEY || env.SILICONFLOW_API_KEY;
  const baseUrl = (process.env.SILICONFLOW_BASE_URL || env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn").replace(/\/$/, "");
  if (!apiKey) throw new Error("SILICONFLOW_API_KEY is missing");

  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const vehicles = catalog.vehicles ?? [];
  await removeOldFaqFiles();

  const stats = [];
  for (const vehicle of vehicles) {
    const questions = generateQuestions(vehicle);
    const lines = [];
    console.log(`START ${vehicle.name}: ${questions.length} questions`);
    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i];
      const answer = await callLlm({ apiKey, baseUrl, question, vehicle, index: i + 1 });
      lines.push(`Q${i + 1}：${question}`);
      lines.push(`A${i + 1}：${answer}`);
      lines.push("");
      if ((i + 1) % 10 === 0) console.log(`PROGRESS ${vehicle.name}: ${i + 1}/100`);
    }
    const text = lines.join("\n").trimEnd() + "\n";
    validateFaqText(text, vehicle.name);
    const fileName = `${vehicle.id}_${vehicle.name}_FAQ.txt`;
    await writeFile(join(outputDir, fileName), text, "utf8");
    stats.push({ vehicleId: vehicle.id, vehicleName: vehicle.name, fileName, questions: 100, answers: 100 });
    console.log(`DONE ${vehicle.name}: ${fileName}`);
  }

  await writeFile(join(outputDir, "faq-generation-stats.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    model,
    vehicleCount: stats.length,
    faqFileCount: stats.length,
    totalQuestions: stats.reduce((sum, item) => sum + item.questions, 0),
    totalAnswers: stats.reduce((sum, item) => sum + item.answers, 0),
    files: stats,
  }, null, 2) + "\n", "utf8");
  console.log(`SUMMARY vehicles=${stats.length} files=${stats.length} questions=${stats.length * 100} answers=${stats.length * 100}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
