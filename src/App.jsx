import { useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Mic,
  Plus,
  Save,
  Search,
  Trash2,
  Truck,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import "./styles.css";

const STORAGE_KEY = "ev-trike-platform-config-v1";
const API_CATALOG = "/api/catalog";
const API_RESET = "/api/reset";
const API_AI_GUIDE_STREAM = "/api/ai-guide/stream";
const API_DIFY_WORKFLOWS = "/api/dify-workflows";
const API_CHAT_HISTORY = "/api/chat-history";
const API_TTS_CONFIG = "/api/tts-config";
const API_TTS_STREAM = "/api/tts/stream";

const productImages = (prefix, count, labels = []) =>
  Array.from({ length: count }, (_, index) => ({
    label: labels[index] ?? `产品图 ${index + 1}`,
    src: `/assets/products/${prefix}-${String(index + 1).padStart(2, "0")}.jpg`,
  }));

const leisureSpecs = (overrides = {}) => {
  const base = {
    电压: "60/72V 通用",
    控制器: "18管60/72V 通用",
    减震: "舒适液压",
    轮距: "795mm",
    电机: "800W 40H",
    轮胎: "前后300-10",
    速度: "28km/h",
    轴距: "1590mm",
    仪表: "LED液晶仪表",
    大灯: "LED大灯",
    重量: "155Kg",
    尺寸: "2160*930*1690mm",
    ...overrides,
  };
  return Object.entries(base);
};

const vehicleSpecs = {
  tiger: {
    电压: "72V",
    控制器: "72V 24管控制器",
    减震: "舒适液压",
    轮距: "910mm",
    电机: "1000W差速电机",
    轮胎: "3.00-10真空胎",
    速度: "28km/h",
    轴距: "2170mm",
    仪表: "LED液晶仪表",
    大灯: "LED大灯",
    重量: "180kg额定载重",
    尺寸: "2170*910*1650mm",
  },
  q7: {
    电压: "72V",
    控制器: "72V 30管控制器",
    减震: "加强舒适液压",
    轮距: "930mm",
    电机: "1200W加强差速电机",
    轮胎: "3.50-10加厚真空胎",
    速度: "28km/h",
    轴距: "2250mm",
    仪表: "LED液晶仪表",
    大灯: "LED大灯",
    重量: "220kg额定载重",
    尺寸: "2250*930*1680mm",
  },
  a8: {
    电压: "60V",
    控制器: "60V 18管静音控制器",
    减震: "舒适液压",
    轮距: "880mm",
    电机: "800W静音差速电机",
    轮胎: "3.00-10真空胎",
    速度: "28km/h",
    轴距: "2120mm",
    仪表: "LED液晶仪表",
    大灯: "LED大灯",
    重量: "160kg额定载重",
    尺寸: "2120*880*1600mm",
  },
  t5: {
    电压: "60V",
    控制器: "60V 15管控制器",
    减震: "舒适液压",
    轮距: "850mm",
    电机: "650W轮毂电机",
    轮胎: "3.00-8真空胎",
    速度: "28km/h",
    轴距: "2050mm",
    仪表: "LED液晶仪表",
    大灯: "LED大灯",
    重量: "150kg额定载重",
    尺寸: "2050*850*1180mm",
  },
  k3: {
    电压: "48V",
    控制器: "48V 12管控制器",
    减震: "舒适液压",
    轮距: "760mm",
    电机: "500W基础轮毂电机",
    轮胎: "2.75-8真空胎",
    速度: "25km/h",
    轴距: "1800mm",
    仪表: "LED液晶仪表",
    大灯: "LED大灯",
    重量: "120kg额定载重",
    尺寸: "1800*760*1120mm",
  },
};

const modelSpecs = (id) => Object.entries(vehicleSpecs[id]);

const specValue = (vehicle, label, fallback = "未配置") =>
  vehicle.specs.find(([name]) => name === label)?.[1] ?? fallback;

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

const motorText = (vehicle) => {
  const value = specValue(vehicle, "电机", specValue(vehicle, "电机功率"));
  return value.includes("电机") ? value : `${value}电机`;
};

const renderMessageText = (text) =>
  String(text).split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong className="message-emphasis" key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });

const vehicleKnowledgeSignature = (vehicle = {}) => {
  const payload = JSON.stringify({
    id: vehicle.id,
    name: vehicle.name,
    series: vehicle.series,
    price: vehicle.price,
    dealerPolicy: vehicle.dealerPolicy,
    slogan: vehicle.slogan,
    specs: vehicle.specs,
  });
  let hash = 5381;
  for (let index = 0; index < payload.length; index += 1) {
    hash = ((hash << 5) + hash) ^ payload.charCodeAt(index);
  }
  return `v1-${(hash >>> 0).toString(36)}`;
};

const requiredSpecGroups = [["电压"], ["电机", "电机功率"], ["速度", "续航里程"], ["尺寸"]];

const parameterTemplates = [
  {
    name: "休闲篷车标准",
    summary: "12 项基础销售参数",
    specs: leisureSpecs(),
  },
  {
    name: "小型代步标准",
    summary: "轻量车辆参数",
    specs: leisureSpecs({
      电压: "48/60V 通用",
      控制器: "12管48/60V 通用",
      电机: "500W 35H",
      轮距: "610mm",
      轴距: "1120mm",
      重量: "110Kg",
      尺寸: "1570*720*1060mm",
    }),
  },
  {
    name: "货运三轮标准",
    summary: "载重和续航导向",
    specs: Object.entries({
      续航里程: "120km",
      电机功率: "1200W",
      载重能力: "500kg",
      电池规格: "60V58Ah",
      充电时间: "8~10h",
      爬坡角度: "≤30°",
      电压: "60/72V 通用",
      轮胎: "前后300-12",
      货箱: "加厚钢板货箱",
      制动: "前后鼓刹",
      尺寸: "2900*1050*1350mm",
      重量: "260Kg",
    }),
  },
];

const normalizeVehicles = (items) =>
  items
    .filter(Boolean)
    .map((item, index) => {
      const specs = Array.isArray(item.specs) && item.specs.length
        ? item.specs
            .map((spec) => {
              if (Array.isArray(spec)) return [String(spec[0]), String(spec[1] ?? "")];
              return [String(spec.label ?? ""), String(spec.value ?? "")];
            })
            .filter(([label]) => label)
        : leisureSpecs();
      const images = Array.isArray(item.images)
        ? item.images
            .filter((image) => image?.src)
            .map((image, imageIndex) => ({
              label: image.label || `产品图 ${imageIndex + 1}`,
              src: image.src,
            }))
        : [];

      return {
        id: item.id || `imported-${Date.now()}-${index}`,
        name: item.name || `导入产品${index + 1}`,
        series: item.series || "未分组",
        tags: Array.isArray(item.tags) && item.tags.length ? item.tags : ["未标记"],
        status: item.status || "草稿",
        color: item.color || "#1f73ff",
        price: item.price || "¥0",
        slogan: item.slogan || "请在后台配置产品卖点",
        specs: specs.length ? specs : leisureSpecs(),
        inventory: Number(item.inventory) || 0,
        dealerPolicy: item.dealerPolicy || "请在后台配置经销商政策",
        images: images.length ? images : productImages("xingrui", 1, ["主图"]),
      };
    });

const initialVehicles = [
  {
    id: "tiger",
    name: "星瑞Plus",
    series: "休闲篷车",
    tags: ["热销款", "新品"],
    status: "已发布",
    color: "#b73a3a",
    price: "¥6,999",
    slogan: "热销稳定 | 72V长续航 | 1000W差速电机 | 家庭代步",
    specs: modelSpecs("tiger"),
    inventory: 168,
    dealerPolicy: "门店标价6999元，建议成交价6599元，适合作为热销主推款。",
    images: productImages("xingrui", 8, ["整车侧面", "侧面展示", "前侧视角", "座椅细节", "正面展示", "前脸细节", "前轮细节", "中控细节"]),
  },
  {
    id: "q7",
    name: "陆尚",
    series: "休闲篷车",
    tags: ["耐用款"],
    status: "已发布",
    color: "#8a72cc",
    price: "¥7,599",
    slogan: "耐用稳定 | 72V高功率 | 1200W加强差速 | 乡镇高频使用",
    specs: modelSpecs("q7"),
    inventory: 94,
    dealerPolicy: "门店标价7599元，建议成交价7199元，乡镇道路和高频使用优先推荐。",
    images: productImages("lushang", 8, ["整车侧面", "右侧展示", "前侧展示", "后侧展示", "车身侧面", "轮胎细节", "中控细节", "驾驶舱"]),
  },
  {
    id: "a8",
    name: "CL9",
    series: "轻奢篷车",
    tags: ["利润款"],
    status: "已发布",
    color: "#d8c7a6",
    price: "¥7,999",
    slogan: "轻奢外观 | 60V静音差速 | 舒适座舱 | 门店利润款",
    specs: modelSpecs("a8"),
    inventory: 52,
    dealerPolicy: "门店标价7999元，建议成交价7599元，主打外观质感和舒适配置。",
    images: productImages("cl9", 8, ["海报主图", "整车侧面", "后视图", "把手细节", "座椅扶手", "充电口", "前轮细节", "储物格"]),
  },
  {
    id: "t5",
    name: "H6",
    series: "休闲系列",
    tags: ["舒适款"],
    status: "已发布",
    color: "#b8d7da",
    price: "¥5,299",
    slogan: "舒适上下车 | 60V轮毂电机 | 老人代步 | 社区短途",
    specs: modelSpecs("t5"),
    inventory: 213,
    dealerPolicy: "门店标价5299元，建议成交价4999元，适合老人代步和社区短途。",
    images: productImages("h6", 8, ["整车侧面", "后侧视角", "正面展示", "前侧视角", "双座展示", "海报主图", "米色款", "红色款"]),
  },
  {
    id: "k3",
    name: "乐萌",
    series: "休闲系列",
    tags: ["活动款"],
    status: "已发布",
    color: "#f5a9be",
    price: "¥4,599",
    slogan: "活动引流 | 48V基础代步 | 多彩小车 | 价格敏感客户",
    specs: modelSpecs("k3"),
    inventory: 87,
    dealerPolicy: "门店标价4599元，活动建议价3999元，经销商结算参考价3180元，适合作为活动引流款。",
    images: productImages("lemeng", 6, ["粉色款", "红色款", "紫色款", "金色款", "绿色款", "海报主图"]),
  },
];

function ProductSprite({ className = "", tone, src, alt = "" }) {
  return (
    <div className={`sprite ${className}`} style={{ "--tone": tone }}>
      <img src={src ?? "/assets/reference.png"} alt={alt} />
      <span />
    </div>
  );
}

function LogoMark() {
  return (
    <div className="logo-wrap">
      <div className="logo-mark">F</div>
      <div>
        <strong>电动三轮车</strong>
        <span>厂家·经销商协同平台</span>
      </div>
    </div>
  );
}

function AppHeader({ mode, setMode, query, setQuery, apiStatus }) {
  const statusCopy = {
    loading: "连接中",
    connected: "API已连接",
    local: "本地缓存",
  }[apiStatus];

  return (
    <header className="app-header">
      <div className="topbar">
        <LogoMark />
        <div className="mode-switch" aria-label="系统模块">
          <button className={mode === "showroom" ? "active" : ""} onClick={() => setMode("showroom")}>展厅</button>
          <button className={mode === "admin" ? "active" : ""} onClick={() => setMode("admin")}>配置</button>
        </div>
        <span className={`sync-pill ${apiStatus}`}>
          <Database size={15} />
          {statusCopy}
        </span>
        <label className="search-box">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索产品" />
        </label>
        <button className="user-pill">
          <span className="avatar">张</span>
          <span>
            <strong>经销商名称</strong>
            <small>张三</small>
          </span>
          <ChevronDown size={18} />
        </button>
      </div>
    </header>
  );
}

function VehicleRail({ vehicles, selectedId, onSelect }) {
  return (
    <aside className="vehicle-rail glass-panel">
      <div className="panel-title">全部车型</div>
      <div className="vehicle-list">
        {vehicles.map((vehicle) => (
          <button
            key={vehicle.id}
            className={`vehicle-card ${selectedId === vehicle.id ? "selected" : ""}`}
            onClick={() => onSelect(vehicle.id)}
          >
            <ProductSprite src={vehicle.images[0]?.src} alt={vehicle.name} tone={vehicle.color} />
            <span className="vehicle-copy">
              <strong>{vehicle.name}</strong>
              <small>{vehicle.series}</small>
              <em>{vehicle.tags[0]}</em>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ProductStage({ vehicle }) {
  const slides = [
    ...vehicle.images,
  ];
  const [slideIndex, setSlideIndex] = useState(0);
  const [dragStart, setDragStart] = useState(null);
  const activeIndex = Math.min(slideIndex, slides.length - 1);
  const activeSlide = slides[activeIndex];
  const nextSlide = () => setSlideIndex((index) => (index + 1) % slides.length);
  const prevSlide = () => setSlideIndex((index) => (index - 1 + slides.length) % slides.length);

  useEffect(() => {
    setSlideIndex(0);
  }, [vehicle.id]);
  const finishDrag = (clientX) => {
    if (dragStart === null) return;
    const delta = clientX - dragStart;
    if (Math.abs(delta) > 45) {
      delta < 0 ? nextSlide() : prevSlide();
    }
    setDragStart(null);
  };

  return (
    <section className="stage-panel">
      <div className="stage-head">
        <div>
          <h1>{vehicle.name}</h1>
          <div className="tag-row">
            {vehicle.tags.map((tag) => (
              <span key={tag} className={tag === "新品" ? "tag mint" : "tag hot"}>
                {tag}
              </span>
            ))}
          </div>
          <p>{vehicle.slogan}</p>
        </div>
      </div>

      <div
        className="product-canvas photo-carousel"
        onPointerDown={(event) => setDragStart(event.clientX)}
        onPointerUp={(event) => finishDrag(event.clientX)}
        onPointerCancel={() => setDragStart(null)}
      >
        <button className="carousel-arrow prev" onClick={prevSlide} aria-label="上一张">
          <ChevronLeft size={24} />
        </button>
        <ProductSprite className="hero-sprite" src={activeSlide.src} alt={`${vehicle.name}${activeSlide.label}`} tone={vehicle.color} />
        <button className="carousel-arrow next" onClick={nextSlide} aria-label="下一张">
          <ChevronRight size={24} />
        </button>
        <span className="slide-caption">{activeSlide.label}</span>
      </div>

      <div className="thumb-strip">
        {slides.map((slide, index) => (
          <button
            key={`${slide.src}-${index}`}
            className={index === activeIndex ? "active" : ""}
            onClick={() => setSlideIndex(index)}
            aria-label={`查看${slide.label}`}
          >
            <img src={slide.src} alt={slide.label} />
            <span>{slide.label}</span>
          </button>
        ))}
      </div>

      <div className="spec-summary">
        {vehicle.specs.map(([label, value]) => (
          <div key={label}>
            <strong>{label}</strong>
            <span>{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AiGuide({ vehicle, workflowBinding }) {
  const introMessages = (currentVehicle) => [
    {
      role: "ai",
      text: `您好，我是${currentVehicle.name}智能客服。您可以直接问价格、续航、配置、适合场景，或者和其他车型对比，我会根据当前车型工作流来回答。`,
    },
  ];
  const [messages, setMessages] = useState(() => introMessages(vehicle));
  const [draft, setDraft] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState("idle");
  const [ttsConfig, setTtsConfig] = useState({ configured: false, provider: "doubao", voiceId: "", voices: {}, providers: [] });
  const [selectedVoiceId, setSelectedVoiceId] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("ev-trike-guide-model-voice") || "";
  });
  const [transcript, setTranscript] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const quickQuestions = [
    "多少钱？",
    "电机多少瓦？",
    "能跑多远？",
    "适合什么客户？",
    "减震怎么样？",
  ];
  const chatLogRef = useRef(null);
  const quickPromptsRef = useRef(null);
  const quickPromptDragRef = useRef({
    active: false,
    startX: 0,
    scrollLeft: 0,
    blockClick: false,
  });
  const recognitionRef = useRef(null);
  const voiceModeRef = useRef(false);
  const isAskingRef = useRef(false);
  const voiceStateRef = useRef("idle");
  const speechQueueRef = useRef([]);
  const speechBufferRef = useRef("");
  const speechActiveRef = useRef(false);
  const speakingRef = useRef(false);
  const audioRef = useRef(null);
  const knowledgeSignature = vehicleKnowledgeSignature(vehicle);

  useEffect(() => {
    let ignore = false;
    const fallback = introMessages(vehicle);
    setMessages(fallback);
    setVoiceMode(false);
    setVoiceState("idle");
    setTranscript("");
    setConversationId("");
    setIsAsking(false);
    try { recognitionRef.current?.stop?.(); } catch {}
    try { window.speechSynthesis?.cancel?.(); } catch {}
    try { audioRef.current?.pause?.(); } catch {}
    recognitionRef.current = null;
    audioRef.current = null;
    speechQueueRef.current = [];
    speechBufferRef.current = "";
    speechActiveRef.current = false;
    speakingRef.current = false;

    const loadHistory = async () => {
      try {
        const response = await fetch(`${API_CHAT_HISTORY}?vehicleId=${encodeURIComponent(vehicle.id)}&knowledgeSignature=${encodeURIComponent(knowledgeSignature)}`);
        const history = await response.json();
        if (ignore) return;
        const savedMessages = Array.isArray(history.messages) ? history.messages : [];
        setMessages(savedMessages.length ? savedMessages : fallback);
        setConversationId("");
      } catch {
        if (!ignore) setMessages(fallback);
      }
    };

    loadHistory();
    return () => {
      ignore = true;
    };
  }, [vehicle.id, knowledgeSignature]);

  useEffect(() => {
    chatLogRef.current?.scrollTo({
      top: chatLogRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, voiceState]);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useEffect(() => {
    isAskingRef.current = isAsking;
  }, [isAsking]);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  const getSpeechRecognition = () =>
    typeof window === "undefined" ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null;

  const voiceSupported = Boolean(getSpeechRecognition()) && typeof window !== "undefined";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedVoiceId) window.localStorage.setItem("ev-trike-guide-model-voice", selectedVoiceId);
    else window.localStorage.removeItem("ev-trike-guide-model-voice");
  }, [selectedVoiceId]);

  useEffect(() => {
    let ignore = false;
    let retryTimer = null;

    const loadTtsConfig = async () => {
      try {
        const response = await fetch(API_TTS_CONFIG);
        if (!response.ok) throw new Error("tts config unavailable");
        const config = await response.json();
        if (ignore) return;
        setTtsConfig(config);
        const voices = config.voices?.[config.provider] ?? [];
        const savedVoiceAvailable = selectedVoiceId && voices.some((voice) => voice.id === selectedVoiceId);
        if (!savedVoiceAvailable) setSelectedVoiceId(config.voiceId || voices[0]?.id || "");
        if (!config.configured) {
          retryTimer = window.setTimeout(loadTtsConfig, 2500);
        }
      } catch {
        if (!ignore) {
          setTtsConfig({ configured: false, provider: "siliconflow", voiceId: "", voices: {}, providers: [] });
          retryTimer = window.setTimeout(loadTtsConfig, 2500);
        }
      }
    };

    loadTtsConfig();
    return () => {
      ignore = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [selectedVoiceId]);

  const voiceMeta = {
    idle: {
      title: voiceMode ? `${vehicle.name} 智能客服待命` : `${vehicle.name} 语音智能客服`,
      hint: voiceSupported
        ? ttsConfig.configured ? "" : "TTS 模型未配置，暂时使用浏览器兜底播报"
        : "当前浏览器不支持语音识别",
      action: voiceMode ? "关闭" : "开启",
    },
    listening: {
      title: "正在听你说",
      hint: transcript || "请直接提问，例如：电机用什么配置？",
      action: "关闭",
    },
    recording: {
      title: "正在录音并转写",
      hint: transcript || "请说话，系统正在识别你的问题...",
      action: "关闭",
    },
    thinking: {
      title: "已识别，正在整理产品资料",
      hint: transcript,
      action: "关闭",
    },
    speaking: {
      title: `${vehicle.name} 智能客服正在语音回复`,
      hint: "播报结束后会继续听下一句",
      action: "关闭",
    },
  }[voiceState];

  const localTrace = (question, pending = false) => [
      { title: "接收问题", detail: question, status: pending ? "active" : "done" },
      { title: "定位车型", detail: `${vehicle.name} · ${vehicle.series}`, status: pending ? "active" : "done" },
      {
        title: workflowBinding?.configured ? "调用Dify智能客服工作流" : "使用本地产品资料",
        detail: workflowBinding?.configured ? normalizeWorkflowName(workflowBinding.appName) : "未配置 API Key，使用本地参数",
        status: pending ? "active" : "done",
      },
    {
      title: "选择知识库",
      detail: workflowBinding?.knowledgeBases?.map((item) => normalizeKnowledgeName(item.datasetName)).filter(Boolean).join("、") || `${vehicle.name}专属知识库`,
      status: pending ? "active" : "done",
    },
  ];

  const requestGuideAnswer = async (question, handlers = {}) => {
    let answer = "";
    let trace = localTrace(question, true);
    let nextConversationId = "";

    try {
      const response = await fetch(API_AI_GUIDE_STREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, vehicle }),
      });
      if (!response.ok || !response.body) throw new Error("智能客服流式请求失败");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const consumeBlock = (block) => {
        const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? "message";
        const dataText = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.replace(/^data:\s?/, ""))
          .join("\n")
          .trim();
        if (!dataText) return;
        const data = JSON.parse(dataText);

        if (event === "delta") {
          const text = data.text ?? "";
          answer += text;
          handlers.onDelta?.(text);
          return;
        }

        if (event === "trace") {
          trace = Array.isArray(data.trace) ? data.trace : trace;
          return;
        }

        if (event === "done") {
          answer = data.answer || answer;
          trace = Array.isArray(data.trace) ? data.trace : trace;
          nextConversationId = data.conversationId ?? nextConversationId;
          return;
        }

        if (event === "error") throw new Error(data.error || "智能客服流式生成失败");
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() ?? "";
        blocks.forEach(consumeBlock);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consumeBlock(buffer);

      if (!answer) throw new Error("智能客服没有返回内容");
      return {
        answer,
        conversationId: nextConversationId,
        trace: trace.length ? trace : localTrace(question),
      };
    } catch (error) {
      const failedAnswer = "智能客服暂时没有响应，请稍后再试。";
      if (!answer) handlers.onDelta?.(failedAnswer);
      return {
        answer: answer || failedAnswer,
        conversationId: "",
        trace: [
          ...localTrace(question),
          { title: "Dify 请求失败", detail: error.message, status: "done" },
        ],
      };
    }
  };

  const saveChatHistory = (nextMessages, nextConversationId = conversationId) => {
    const persistedMessages = nextMessages.filter((message) => !message.pending);
    void fetch(`${API_CHAT_HISTORY}/${encodeURIComponent(vehicle.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleName: vehicle.name,
          conversationId: "",
          knowledgeSignature,
          messages: persistedMessages,
        }),
    });
  };

  const stopListening = () => {
    try { recognitionRef.current?.stop?.(); } catch {}
    recognitionRef.current = null;
  };

  const cleanSpeechText = (text) =>
    String(text || "")
      .replace(/\*\*/g, "")
      .replace(/[#>`*_~-]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const normalizeSpeechChunk = (text) =>
    String(text || "")
      .replace(/\*\*/g, "")
      .replace(/[#>`*_~-]/g, "")
      .replace(/\s+/g, " ");

  const resumeListeningAfterSpeech = () => {
    if (!voiceModeRef.current) return;
    setTranscript("");
    setVoiceState("listening");
    window.setTimeout(startListening, 250);
  };

  const playBrowserSpeechFallback = (text) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return false;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.96;
    utterance.pitch = 1;
    utterance.onend = () => {
      speakingRef.current = false;
      if (speechQueueRef.current.length) {
        playNextSpeech();
        return;
      }
      if (!speechActiveRef.current) resumeListeningAfterSpeech();
    };
    utterance.onerror = utterance.onend;
    speakingRef.current = true;
    setVoiceState("speaking");
    window.speechSynthesis.speak(utterance);
    return true;
  };

  const playNextSpeech = async () => {
    if (!voiceModeRef.current || typeof window === "undefined") return;
    if (speakingRef.current) return;
    const text = speechQueueRef.current.shift();
    if (!text) return;

    if (!ttsConfig.configured) {
      playBrowserSpeechFallback(text);
      return;
    }

    speakingRef.current = true;
    setVoiceState("speaking");
    try {
      const response = await fetch(API_TTS_STREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          provider: ttsConfig.provider,
          voiceId: selectedVoiceId || ttsConfig.voiceId,
        }),
      });
      if (!response.ok) throw new Error("TTS 模型播报失败");
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        speakingRef.current = false;
        if (speechQueueRef.current.length) {
          void playNextSpeech();
          return;
        }
        if (!speechActiveRef.current) resumeListeningAfterSpeech();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        speakingRef.current = false;
        if (!playBrowserSpeechFallback(text) && !speechActiveRef.current) resumeListeningAfterSpeech();
      };
      await audio.play();
    } catch {
      speakingRef.current = false;
      if (!playBrowserSpeechFallback(text) && !speechActiveRef.current) resumeListeningAfterSpeech();
    }
  };

  const enqueueSpeech = (text, flush = false) => {
    if (!voiceModeRef.current || typeof window === "undefined") return;
    speechBufferRef.current += normalizeSpeechChunk(text);
    const nextQueue = [];
    const pattern = /(.+?[。！？!?；;])/g;
    let match;
    let consumed = 0;
    while ((match = pattern.exec(speechBufferRef.current))) {
      const sentence = cleanSpeechText(match[1]);
      if (sentence) nextQueue.push(sentence);
      consumed = pattern.lastIndex;
    }
    speechBufferRef.current = speechBufferRef.current.slice(consumed);

    if (flush) {
      const tail = cleanSpeechText(speechBufferRef.current);
      if (tail) nextQueue.push(tail);
      speechBufferRef.current = "";
    }

    if (nextQueue.length) {
      speechQueueRef.current.push(...nextQueue);
      playNextSpeech();
    } else if (flush && !speakingRef.current && !speechActiveRef.current) {
      resumeListeningAfterSpeech();
    }
  };

  const beginStreamSpeech = () => {
    if (!voiceModeRef.current || typeof window === "undefined") return;
    speechQueueRef.current = [];
    speechBufferRef.current = "";
    speechActiveRef.current = true;
    speakingRef.current = false;
    window.speechSynthesis.cancel();
    try { audioRef.current?.pause?.(); } catch {}
    audioRef.current = null;
  };

  const finishStreamSpeech = () => {
    if (!voiceModeRef.current) return;
    speechActiveRef.current = false;
    enqueueSpeech("", true);
  };

  const startListening = () => {
    const SpeechRecognition = getSpeechRecognition();
    if (!voiceModeRef.current || !SpeechRecognition || isAskingRef.current || voiceStateRef.current === "speaking") return;
    stopListening();
    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    setVoiceState("listening");

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += text;
        else interim += text;
      }
      const visibleText = (finalText || interim).trim();
      if (visibleText) setTranscript(visibleText);
      if (finalText.trim()) {
        const question = finalText.trim();
        stopListening();
        setTranscript(question);
        setVoiceState("thinking");
        void ask(question, { voice: true });
      }
    };

    recognition.onerror = () => {
      if (!voiceModeRef.current) return;
      setVoiceState("idle");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (!voiceModeRef.current || isAskingRef.current || voiceStateRef.current === "speaking" || voiceStateRef.current === "thinking") return;
      window.setTimeout(startListening, 450);
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
    }
  };

  const toggleVoiceMode = () => {
    if (!voiceSupported) return;
    if (voiceModeRef.current) {
      setVoiceMode(false);
      setVoiceState("idle");
      setTranscript("");
      stopListening();
      try { window.speechSynthesis?.cancel?.(); } catch {}
      try { audioRef.current?.pause?.(); } catch {}
      audioRef.current = null;
      speechQueueRef.current = [];
      speechBufferRef.current = "";
      speechActiveRef.current = false;
      speakingRef.current = false;
      return;
    }
    setVoiceMode(true);
    voiceModeRef.current = true;
    setTranscript("");
    window.setTimeout(startListening, 120);
  };

  const ask = async (text = draft, options = {}) => {
    const question = text.trim();
    if (!question || isAskingRef.current) return;
    const userMessage = { role: "user", text: options.userText ?? question, time: "刚刚" };
    const streamMessageId = `stream-${Date.now()}`;
    setIsAsking(true);
    isAskingRef.current = true;
    if (options.voice) beginStreamSpeech();
    setMessages((items) => {
      const next = [...items, userMessage];
      saveChatHistory(next);
      return next;
    });
    setDraft("");

    let firstRemoteDelta = true;

    const result = await requestGuideAnswer(question, {
      onDelta: (delta) => {
        const visibleDelta = firstRemoteDelta ? delta : delta;
        firstRemoteDelta = false;
        if (options.voice) enqueueSpeech(delta);
        setMessages((items) => {
          const exists = items.some((item) => item.id === streamMessageId);
          if (!exists) {
            return [...items, { id: streamMessageId, role: "ai", text: visibleDelta, pending: true }];
          }

          return items.map((item) =>
            item.id === streamMessageId ? { ...item, text: `${item.text}${visibleDelta}` } : item
          );
        });
      },
    });
    const nextConversationId = "";
    setConversationId("");
    setMessages((items) => {
      const exists = items.some((item) => item.id === streamMessageId);
      const next = exists
        ? items.map((item) => item.id === streamMessageId ? { role: "ai", text: result.answer } : item)
        : [...items, { role: "ai", text: result.answer }];
      saveChatHistory(next, nextConversationId);
      return next;
    });
    setIsAsking(false);
    isAskingRef.current = false;
    if (options.voice) finishStreamSpeech();
    return result.answer;
  };

  const startQuickPromptDrag = (event) => {
    const target = quickPromptsRef.current;
    if (!target) return;
    quickPromptDragRef.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: target.scrollLeft,
      blockClick: false,
    };
    event.currentTarget.classList.add("dragging");
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveQuickPromptDrag = (event) => {
    const target = quickPromptsRef.current;
    const drag = quickPromptDragRef.current;
    if (!target || !drag.active) return;
    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 4) {
      drag.blockClick = true;
      target.scrollLeft = drag.scrollLeft - deltaX;
      event.preventDefault();
    }
  };

  const endQuickPromptDrag = (event) => {
    quickPromptDragRef.current.active = false;
    event.currentTarget.classList.remove("dragging");
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const clickQuickPrompt = (event, question) => {
    if (quickPromptDragRef.current.blockClick) {
      event.preventDefault();
      event.stopPropagation();
      window.setTimeout(() => {
        quickPromptDragRef.current.blockClick = false;
      }, 0);
      return;
    }
    void ask(question);
  };

  return (
    <aside className="ai-panel glass-panel" data-vehicle-id={vehicle.id}>
      <div className="ai-head">
        <div className="bot-avatar"><Bot size={24} /></div>
        <div>
          <strong>{vehicle.name}智能客服</strong>
          <span>{vehicle.series} · {normalizeWorkflowName(workflowBinding?.appName)}</span>
          <em>{workflowBinding?.configured ? "专属知识库已接入" : "本地产品资料模式"}</em>
        </div>
        <button aria-label="语音音量"><Volume2 size={19} /></button>
        <button aria-label="关闭智能客服"><X size={21} /></button>
      </div>
      <div className="chat-log" ref={chatLogRef}>
        <div className="chat-context">
          <strong>{vehicle.name}</strong>
          <span>{normalizeKnowledgeName(workflowBinding?.knowledgeBases?.find((item) => item.type === "vehicle")?.datasetName, `${vehicle.name}专属知识库`)}</span>
        </div>
        {messages.map((msg, index) => (
          <div key={`${msg.role}-${index}`} className={`message ${msg.role} ${msg.pending ? "pending" : ""}`}>
            {msg.role === "ai" && <div className="mini-bot"><Bot size={16} /></div>}
            <div>
              {msg.role === "ai" && <strong>{vehicle.name}智能客服</strong>}
              <p>{renderMessageText(msg.text)}</p>
              {msg.time && <time>{msg.time}</time>}
            </div>
          </div>
        ))}
      </div>
      <div
        className="quick-prompts"
        ref={quickPromptsRef}
        aria-label="常用问题"
        onPointerDown={startQuickPromptDrag}
        onPointerMove={moveQuickPromptDrag}
        onPointerUp={endQuickPromptDrag}
        onPointerCancel={endQuickPromptDrag}
        onWheel={(event) => {
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.currentTarget.scrollLeft += event.deltaY;
          }
        }}
      >
        {quickQuestions.map((question) => (
          <button
            key={question}
            onClick={(event) => clickQuickPrompt(event, question)}
            onDragStart={(event) => event.preventDefault()}
            disabled={isAsking}
          >
            {question}
          </button>
        ))}
      </div>
      <div className="voice-card">
        <div className="voice-bot"><Bot size={18} /></div>
        <div className="voice-copy">
          <strong>{voiceMeta.title}</strong>
          {voiceMeta.hint && <span>{voiceMeta.hint}</span>}
          <div className={`wave ${voiceState}`} aria-hidden="true">
            {Array.from({ length: 22 }).map((_, i) => <i key={i} style={{ height: `${8 + ((i * 3) % 8) * 3}px` }} />)}
          </div>
          {voiceSupported && (
            <label className="voice-select">
              <em>模型音色</em>
              <select
                value={selectedVoiceId}
                onChange={(event) => setSelectedVoiceId(event.target.value)}
                aria-label="选择模型语音音色"
              >
                {(ttsConfig.voices?.[ttsConfig.provider] ?? []).map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button
          className={`talk-btn ${voiceMode ? voiceState : "idle"}`}
          onClick={toggleVoiceMode}
          disabled={!voiceSupported}
          aria-label={voiceMode ? "关闭连续语音会话" : "开启连续语音会话"}
        >
          <span className="talk-icon"><Mic size={22} /></span>
          <span>{voiceMeta.action}</span>
        </button>
      </div>
      <div className="ask-bar">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") ask();
          }}
          placeholder="键盘输入"
          disabled={isAsking}
        />
        <button className="send-btn" onClick={() => ask()} disabled={isAsking}>
          {isAsking ? "生成中" : "发送"}
        </button>
      </div>
    </aside>
  );
}

function Showroom({ vehicles, selectedId, setSelectedId, query, difyWorkflows }) {
  const keyword = query.trim().toLowerCase();
  const filteredVehicles = keyword
    ? vehicles.filter((item) =>
        [item.name, item.series, item.slogan, item.price, ...item.tags].join(" ").toLowerCase().includes(keyword)
      )
    : vehicles;
  const vehicle = filteredVehicles.find((item) => item.id === selectedId) ?? filteredVehicles[0];

  if (!filteredVehicles.length) {
    return (
      <div className="empty-showroom glass-panel">
        <Search size={34} />
        <strong>没有匹配产品</strong>
        <p>请换一个关键词，或到配置中心确认产品名称和系列。</p>
      </div>
    );
  }

  return (
    <div className="showroom-grid">
      <VehicleRail vehicles={filteredVehicles} selectedId={vehicle.id} onSelect={setSelectedId} />
      <div className="stage-stack">
        <ProductStage vehicle={vehicle} />
      </div>
      <AiGuide
        key={vehicle.id}
        vehicle={vehicle}
        workflowBinding={difyWorkflows.bindings?.[vehicle.id]}
      />
    </div>
  );
}

function AdminConsole({
  vehicles,
  selectedId,
  setSelectedId,
  setMode,
  updateVehicle,
  addVehicle,
  removeVehicle,
  difyWorkflows,
  updateDifyWorkflow,
}) {
  const vehicle = vehicles.find((item) => item.id === selectedId) ?? vehicles[0];

  return (
    <section className="configurator-shell">
      <aside className="config-model-panel glass-panel">
        <div className="config-panel-head">
          <span className="eyebrow">配置车辆</span>
          <h2>选择车辆</h2>
          <p>每辆车单独配置图片、参数和基础信息。</p>
        </div>
        <div className="config-model-list">
          {vehicles.map((item) => (
            <article
              key={item.id}
              className={selectedId === item.id ? "active" : ""}
            >
              <button className="model-pick" onClick={() => setSelectedId(item.id)}>
                <ProductSprite src={item.images[0]?.src} alt={item.name} tone={item.color} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.series}</small>
                </span>
                <em className={`status ${item.status}`}>{item.status}</em>
              </button>
              <div className="model-card-actions">
                <button onClick={() => setSelectedId(item.id)}>编辑</button>
                <button onClick={() => {
                  setSelectedId(item.id);
                  setMode("showroom");
                }}>预览</button>
              </div>
            </article>
          ))}
        </div>
        <div className="config-model-actions">
          <button onClick={addVehicle}><Plus size={18} />新增车辆</button>
          <button className="danger" onClick={() => removeVehicle(vehicle.id)} disabled={vehicles.length <= 1}>
            <Trash2 size={17} />删除当前
          </button>
        </div>
      </aside>

      <main className="configurator-main">
        <ParameterEditor
          vehicle={vehicle}
          updateVehicle={updateVehicle}
          workflowBinding={difyWorkflows.bindings?.[vehicle.id]}
          updateDifyWorkflow={updateDifyWorkflow}
        />
      </main>
    </section>
  );
}

function ParameterEditor({ vehicle, updateVehicle, workflowBinding, updateDifyWorkflow }) {
  const configTabs = [
    { id: "basic", label: "基础信息" },
    { id: "images", label: "产品图片" },
    { id: "specs", label: "参数项" },
    { id: "workflow", label: "Dify 工作流" },
  ];
  const [imageDraft, setImageDraft] = useState({ label: "产品图", src: "" });
  const [activeConfigTab, setActiveConfigTab] = useState("basic");
  const [workflowDraft, setWorkflowDraft] = useState({
    appName: "",
    appId: "",
    workflowId: "",
    apiBaseUrl: "http://127.0.0.1/v1",
    appType: "chatflow",
    apiKey: "",
  });
  const [draft, setDraft] = useState({
    name: vehicle.name,
    series: vehicle.series,
    status: vehicle.status,
    tags: vehicle.tags.join("、"),
    slogan: vehicle.slogan,
    price: vehicle.price,
    inventory: vehicle.inventory,
    policy: vehicle.dealerPolicy,
    specs: vehicle.specs.map(([label, value]) => ({ label, value })),
  });

  useEffect(() => {
    setImageDraft({ label: "产品图", src: "" });
    setActiveConfigTab("basic");
    setDraft({
      name: vehicle.name,
      series: vehicle.series,
      status: vehicle.status,
      tags: vehicle.tags.join("、"),
      slogan: vehicle.slogan,
      price: vehicle.price,
      inventory: vehicle.inventory,
      policy: vehicle.dealerPolicy,
      specs: vehicle.specs.map(([label, value]) => ({ label, value })),
    });
  }, [vehicle]);

  useEffect(() => {
    setWorkflowDraft({
      appName: normalizeWorkflowName(workflowBinding?.appName, `${vehicle.name}智能客服工作流`),
      appId: workflowBinding?.appId ?? "",
      workflowId: workflowBinding?.workflowId ?? "",
      apiBaseUrl: workflowBinding?.apiBaseUrl ?? "http://127.0.0.1/v1",
      appType: workflowBinding?.appType ?? "chatflow",
      apiKey: "",
    });
  }, [vehicle.id, vehicle.name, workflowBinding]);

  const addImage = () => {
    const src = imageDraft.src.trim();
    if (!src) return;

    updateVehicle(vehicle.id, {
      images: [
        ...vehicle.images,
        {
          label: imageDraft.label.trim() || `产品图 ${vehicle.images.length + 1}`,
          src,
        },
      ],
    });
    setImageDraft({ label: "产品图", src: "" });
  };

  const uploadImages = (event) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    Promise.all(files.map((file, index) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        label: file.name.replace(/\.[^.]+$/, "") || `上传图片 ${index + 1}`,
        src: reader.result,
      });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }))).then((images) => {
      updateVehicle(vehicle.id, {
        images: [...vehicle.images, ...images],
      });
    }).catch(() => {
      window.alert("图片上传失败，请重新选择图片。");
    });

    event.target.value = "";
  };

  const removeImage = (index) => {
    if (vehicle.images.length <= 1) return;
    updateVehicle(vehicle.id, {
      images: vehicle.images.filter((_, imageIndex) => imageIndex !== index),
    });
  };

  const updateSpec = (index, field, value) => {
    setDraft((current) => ({
      ...current,
      specs: current.specs.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const addSpec = () => {
    setDraft((current) => ({
      ...current,
      specs: [...current.specs, { label: "自定义", value: "" }],
    }));
  };

  const removeSpec = (index) => {
    setDraft((current) => ({
      ...current,
      specs: current.specs.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const applyTemplate = (template) => {
    setDraft((current) => ({
      ...current,
      specs: template.specs.map(([label, value]) => ({ label, value })),
    }));
  };

  const buildPatch = (overrides = {}) => {
    const next = { ...draft, ...overrides };
    const tags = next.tags.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean);

    return {
      name: next.name.trim() || vehicle.name,
      series: next.series.trim() || vehicle.series,
      status: next.status,
      slogan: next.slogan,
      price: next.price,
      inventory: Number(next.inventory) || 0,
      dealerPolicy: next.policy,
      tags: tags.length ? tags : ["未标记"],
      specs: next.specs
        .map((item) => [item.label.trim(), item.value.trim()])
        .filter(([label]) => label),
    };
  };

  const saveDraft = (overrides) => {
    updateVehicle(vehicle.id, buildPatch(overrides));
  };

  const saveWorkflowBinding = () => {
    updateDifyWorkflow(vehicle.id, {
      ...workflowDraft,
      vehicleName: vehicle.name,
    });
    setWorkflowDraft((current) => ({ ...current, apiKey: "" }));
  };

  const validationChecks = [
    ["基础信息完整", Boolean(draft.name.trim() && draft.series.trim() && draft.price.trim())],
    ["至少 1 张产品图", vehicle.images.length > 0],
    ["至少 8 个参数项", draft.specs.filter((item) => item.label.trim() && item.value.trim()).length >= 8],
    ["关键参数完整", requiredSpecGroups.every((labels) =>
      labels.some((label) => draft.specs.some((item) => item.label.trim() === label && item.value.trim()))
    )],
    ["经销商政策已配置", Boolean(draft.policy.trim())],
  ];
  const canPublish = validationChecks.every(([, pass]) => pass);

  return (
    <div className="admin-board split-board">
      <div>
        <h3>{vehicle.name} 车辆配置</h3>
        <p>当前页面只配置这辆车自己的基础信息、产品图片和参数项。</p>
        <div className="config-tabs" role="tablist" aria-label="配置分组">
          {configTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeConfigTab === tab.id}
              className={activeConfigTab === tab.id ? "active" : ""}
              onClick={() => setActiveConfigTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeConfigTab === "basic" && (
          <section className="config-tab-panel">
            <div className="template-grid">
              {parameterTemplates.map((template) => (
                <button key={template.name} onClick={() => applyTemplate(template)}>
                  <strong>{template.name}</strong>
                  <span>{template.summary}</span>
                </button>
              ))}
            </div>
            <div className="form-grid">
              <label>车辆名称<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <label>所属系列<input value={draft.series} onChange={(e) => setDraft({ ...draft, series: e.target.value })} /></label>
              <label>状态<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                <option>已发布</option>
                <option>待上架</option>
                <option>草稿</option>
              </select></label>
              <label>标签<input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} /></label>
              <label>指导价<input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></label>
              <label>库存台数<input type="number" value={draft.inventory} onChange={(e) => setDraft({ ...draft, inventory: Number(e.target.value) })} /></label>
              <label className="wide">产品卖点<textarea value={draft.slogan} onChange={(e) => setDraft({ ...draft, slogan: e.target.value })} /></label>
              <label className="wide">经销商政策<textarea value={draft.policy} onChange={(e) => setDraft({ ...draft, policy: e.target.value })} /></label>
            </div>
          </section>
        )}

        {activeConfigTab === "workflow" && (
          <section className="model-config-section">
            <div className="spec-editor-head">
              <div>
                <strong>Dify 工作流</strong>
                <p>当前车辆独立绑定一个 Chatflow：{workflowBinding?.configured ? normalizeWorkflowName(workflowBinding.appName) : "未配置"}</p>
              </div>
              {workflowBinding?.configured && <em className="workflow-status">已绑定 {workflowBinding.tokenPreview}</em>}
            </div>
            <div className="form-grid workflow-form">
              <label>工作流名称<input value={workflowDraft.appName} onChange={(e) => setWorkflowDraft({ ...workflowDraft, appName: e.target.value })} /></label>
              <label>App ID<input value={workflowDraft.appId} onChange={(e) => setWorkflowDraft({ ...workflowDraft, appId: e.target.value })} /></label>
              <label>Workflow ID<input value={workflowDraft.workflowId} onChange={(e) => setWorkflowDraft({ ...workflowDraft, workflowId: e.target.value })} /></label>
              <label>API 地址<input value={workflowDraft.apiBaseUrl} onChange={(e) => setWorkflowDraft({ ...workflowDraft, apiBaseUrl: e.target.value })} /></label>
              <label>应用类型<select value={workflowDraft.appType} onChange={(e) => setWorkflowDraft({ ...workflowDraft, appType: e.target.value })}>
                <option value="chatflow">Chatflow</option>
                <option value="workflow">Workflow</option>
              </select></label>
              <label>API Key<input value={workflowDraft.apiKey} onChange={(e) => setWorkflowDraft({ ...workflowDraft, apiKey: e.target.value })} placeholder={workflowBinding?.configured ? "留空则保持原密钥" : "app-..."} /></label>
            </div>
            <div className="knowledge-bindings">
              {(workflowBinding?.knowledgeBases ?? []).map((dataset) => (
                <article key={`${dataset.type}-${dataset.datasetId}`}>
                  <span>{dataset.type === "common" ? "通用知识库" : "车型知识库"}</span>
                  <strong>{normalizeKnowledgeName(dataset.datasetName)}</strong>
                  <small>{dataset.datasetId}</small>
                </article>
              ))}
            </div>
            <button className="primary compact-action" onClick={saveWorkflowBinding}>
              <Save size={17} />保存工作流绑定
            </button>
          </section>
        )}

        {activeConfigTab === "images" && (
          <section className="model-config-section">
            <div className="spec-editor-head">
              <div>
                <strong>产品图片</strong>
                <p>图片只绑定到当前车辆：{vehicle.name}</p>
              </div>
              <label className="upload-action">
                <Upload size={16} />
                上传图片
                <input type="file" accept="image/*" multiple onChange={uploadImages} />
              </label>
            </div>
            <div className="asset-bind compact">
              <label>图片名称<input value={imageDraft.label} onChange={(e) => setImageDraft({ ...imageDraft, label: e.target.value })} /></label>
              <label>图片地址<input value={imageDraft.src} onChange={(e) => setImageDraft({ ...imageDraft, src: e.target.value })} placeholder="/assets/products/xingrui-01.jpg" /></label>
              <button onClick={addImage}><Plus size={16} />绑定图片</button>
            </div>
            <div className="config-image-grid">
              {vehicle.images.map((image, index) => (
                <article key={`${image.src}-${index}`}>
                  <button onClick={() => removeImage(index)} disabled={vehicle.images.length <= 1} aria-label="删除图片">
                    <X size={15} />
                  </button>
                  <ProductSprite src={image.src} alt={`${vehicle.name}${image.label}`} tone={vehicle.color} />
                  <strong>{image.label}</strong>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeConfigTab === "specs" && (
          <div className="spec-editor">
            <div className="spec-editor-head">
              <div>
                <strong>参数项</strong>
                <p>参数只保存到当前车辆，不影响其他车辆。</p>
              </div>
              <button onClick={addSpec}><Plus size={16} />添加参数</button>
            </div>
            {draft.specs.map((item, index) => (
              <div className="spec-row" key={`${item.label}-${index}`}>
                <input value={item.label} onChange={(e) => updateSpec(index, "label", e.target.value)} placeholder="参数名" />
                <input value={item.value} onChange={(e) => updateSpec(index, "value", e.target.value)} placeholder="参数值" />
                <button onClick={() => removeSpec(index)} aria-label="删除参数"><X size={16} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="config-save-bar">
          <button className="primary" onClick={() => saveDraft()}>
            <Save size={18} />保存并同步
          </button>
        </div>
      </div>
      <div className="live-preview">
        <span className="eyebrow">实时预览</span>
        <h4>{draft.name}</h4>
        <div className="validation-card">
          <strong>发布校验</strong>
          {validationChecks.map(([label, pass]) => (
            <p key={label} className={pass ? "pass" : "fail"}>
              <CheckCircle2 size={15} />
              {label}
            </p>
          ))}
          <button className="primary publish" onClick={() => saveDraft({ status: "已发布" })} disabled={!canPublish}>
            发布到展厅
          </button>
        </div>
        {draft.specs.map((item, index) => (
          <div key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.value}</strong></div>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const [mode, setMode] = useState("showroom");
  const [query, setQuery] = useState("");
  const [apiStatus, setApiStatus] = useState("loading");
  const [difyWorkflows, setDifyWorkflows] = useState({ bindings: {} });
  const [vehicles, setVehicles] = useState(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved ? normalizeVehicles(JSON.parse(saved)) : initialVehicles;
    } catch {
      return initialVehicles;
    }
  });
  const [selectedId, setSelectedId] = useState("tiger");

  useEffect(() => {
    let ignore = false;

    const loadCatalog = async () => {
      try {
        const [response, workflowResponse] = await Promise.all([
          fetch(API_CATALOG),
          fetch(API_DIFY_WORKFLOWS),
        ]);
        if (!response.ok) throw new Error("catalog api unavailable");
        const catalog = await response.json();
        const normalized = normalizeVehicles(catalog.vehicles ?? []);
        if (!normalized.length) throw new Error("empty catalog");
        if (ignore) return;

        setVehicles(normalized);
        if (workflowResponse.ok) {
          setDifyWorkflows(await workflowResponse.json());
        }
        setSelectedId((current) => normalized.some((item) => item.id === current) ? current : normalized[0].id);
        setApiStatus("connected");
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        if (!ignore) setApiStatus("local");
      }
    };

    loadCatalog();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicles));
  }, [vehicles]);

  useEffect(() => {
    if (!vehicles.some((vehicle) => vehicle.id === selectedId) && vehicles[0]) {
      setSelectedId(vehicles[0].id);
    }
  }, [selectedId, vehicles]);

  const saveCatalog = async (nextVehicles) => {
    if (apiStatus !== "connected") return;

    try {
      const response = await fetch(API_CATALOG, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicles: nextVehicles }),
      });
      if (!response.ok) throw new Error("save failed");
    } catch {
      setApiStatus("local");
    }
  };

  const commitVehicles = (updater, { sync = true } = {}) => {
    setVehicles((current) => {
      const next = normalizeVehicles(typeof updater === "function" ? updater(current) : updater);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      if (sync) void saveCatalog(next);
      return next;
    });
  };

  const updateVehicle = (id, patch) => {
    commitVehicles((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const updateDifyWorkflow = async (vehicleId, patch) => {
    try {
      const response = await fetch(`${API_DIFY_WORKFLOWS}/${encodeURIComponent(vehicleId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const binding = await response.json();
      if (!response.ok) throw new Error(binding.error || "workflow save failed");
      setDifyWorkflows((current) => ({
        ...current,
        bindings: {
          ...(current.bindings ?? {}),
          [vehicleId]: binding,
        },
      }));
    } catch {
      window.alert("Dify 工作流绑定保存失败，请确认本地 API 服务正常。");
    }
  };

  const addVehicle = () => {
    const base = vehicles.find((item) => item.id === selectedId) ?? vehicles[0];
    const id = `custom-${Date.now()}`;
    const vehicle = {
      ...base,
      id,
      name: `新产品${vehicles.length + 1}`,
      series: base?.series ?? "休闲系列",
      tags: ["待配置"],
      status: "草稿",
      price: "¥0",
      slogan: "请在后台配置产品卖点",
      specs: leisureSpecs(),
      inventory: 0,
      dealerPolicy: "请在后台配置经销商政策",
      images: base?.images?.length ? [base.images[0]] : productImages("xingrui", 1, ["主图"]),
    };

    commitVehicles((items) => [...items, vehicle]);
    setSelectedId(id);
    setMode("admin");
  };

  const removeVehicle = (id) => {
    commitVehicles((items) => {
      if (items.length <= 1) return items;
      const next = items.filter((item) => item.id !== id);
      if (selectedId === id && next[0]) {
        setSelectedId(next[0].id);
      }
      return next;
    });
  };

  const exportConfig = () => {
    const blob = new Blob([
      JSON.stringify({ exportedAt: new Date().toISOString(), vehicles }, null, 2),
    ], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ev-trike-product-config.json";
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const importConfig = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const importedVehicles = Array.isArray(parsed) ? parsed : parsed.vehicles;
        const normalized = normalizeVehicles(Array.isArray(importedVehicles) ? importedVehicles : []);
        if (!normalized.length) throw new Error("empty config");
        commitVehicles(normalized);
        setSelectedId(normalized[0].id);
        setMode("admin");
      } catch {
        window.alert("配置文件格式不正确，请导入由系统导出的 JSON 文件。");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const resetConfig = async () => {
    window.localStorage.removeItem(STORAGE_KEY);
    if (apiStatus === "connected") {
      try {
        const response = await fetch(API_RESET, { method: "POST" });
        if (!response.ok) throw new Error("reset failed");
        const catalog = await response.json();
        const normalized = normalizeVehicles(catalog.vehicles ?? []);
        commitVehicles(normalized, { sync: false });
        setSelectedId(normalized[0].id);
        return;
      } catch {
        setApiStatus("local");
      }
    }

    commitVehicles(initialVehicles, { sync: false });
    setSelectedId(initialVehicles[0].id);
  };

  return (
    <div className="tablet-shell">
      <div className="app-surface">
        <AppHeader mode={mode} setMode={setMode} query={query} setQuery={setQuery} apiStatus={apiStatus} />
        <div className={`workspace ${mode === "showroom" ? "showroom-workspace" : "config-workspace"}`}>
          {mode === "showroom" && (
            <Showroom
              vehicles={vehicles}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              query={query}
              difyWorkflows={difyWorkflows}
            />
          )}
          {mode === "admin" && (
            <AdminConsole
              vehicles={vehicles}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              setMode={setMode}
              updateVehicle={updateVehicle}
              addVehicle={addVehicle}
              removeVehicle={removeVehicle}
              difyWorkflows={difyWorkflows}
              updateDifyWorkflow={updateDifyWorkflow}
              exportConfig={exportConfig}
              importConfig={importConfig}
              resetConfig={resetConfig}
            />
          )}
        </div>
      </div>
    </div>
  );
}
