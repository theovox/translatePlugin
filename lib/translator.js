const TranslatorEngine = {
  GOOGLE: 'google',
  BING: 'bing',
  TENCENT: 'tencent',
  CUSTOM_LLM: 'custom_llm'
};

const ENGINE_INFO = {
  google:     { name: '谷歌翻译',     desc: '速度快、语种全，推荐首选' },
  bing:       { name: 'Bing 翻译',    desc: '微软翻译，质量高，学术文档友好' },
  tencent:    { name: '腾讯翻译',     desc: '国内通道，速度快，中英互译质量好' },
  custom_llm: { name: '自定义大模型', desc: '翻译质量最高，适合精翻，整页翻译 token 消耗大' }
};

const ALL_ENGINES = Object.keys(ENGINE_INFO);

const DEFAULT_SETTINGS = {
  engine: TranslatorEngine.GOOGLE,
  targetLang: 'zh-CN',
  sourceLang: 'auto',
  displayMode: 'bilingual',
  autoTranslate: false,
  disabledEngines: [],
  customLLM: {
    endpoint: '',
    apiKey: '',
    model: 'gpt-3.5-turbo',
    systemPrompt: '你是一个专业翻译助手。请将以下内容翻译为{targetLang}，只返回翻译结果，不要添加任何解释。'
  }
};

const LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁体中文' },
  { code: 'en', name: '英语' },
  { code: 'ja', name: '日语' },
  { code: 'ko', name: '韩语' },
  { code: 'fr', name: '法语' },
  { code: 'de', name: '德语' },
  { code: 'es', name: '西班牙语' },
  { code: 'ru', name: '俄语' },
  { code: 'pt', name: '葡萄牙语' },
  { code: 'it', name: '意大利语' },
  { code: 'ar', name: '阿拉伯语' },
  { code: 'th', name: '泰语' },
  { code: 'vi', name: '越南语' }
];

const LANG_NAME_MAP = Object.fromEntries(LANGUAGES.map(l => [l.code, l.name]));

const BING_LANG_MAP = {
  'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', 'en': 'en', 'ja': 'ja', 'ko': 'ko',
  'fr': 'fr', 'de': 'de', 'es': 'es', 'ru': 'ru', 'pt': 'pt',
  'it': 'it', 'ar': 'ar', 'th': 'th', 'vi': 'vi'
};

const TENCENT_LANG_MAP = {
  'zh-CN': 'zh', 'zh-TW': 'zh-TW', 'en': 'en', 'ja': 'jp', 'ko': 'kr',
  'fr': 'fr', 'de': 'de', 'es': 'es', 'ru': 'ru', 'pt': 'pt',
  'it': 'it', 'ar': 'ar', 'th': 'th', 'vi': 'vi'
};

function cleanErrorMessage(errBody, maxLen) {
  if (!errBody) return '';
  if (errBody.trim().startsWith('<') || errBody.trim().startsWith('<!')) {
    const titleMatch = errBody.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch) return titleMatch[1].trim();
    return '服务器返回了 HTML 错误页面，请检查网络或 API 地址';
  }
  if (errBody.length > (maxLen || 200)) return errBody.slice(0, maxLen || 200) + '...';
  return errBody;
}

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve);
  });
}

async function saveSettings(settings) {
  return new Promise(resolve => {
    chrome.storage.sync.set(settings, resolve);
  });
}

// ===== Google 翻译 =====
async function translateGoogle(text, sourceLang, targetLang) {
  const sl = sourceLang === 'auto' ? 'auto' : sourceLang;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Google 翻译请求失败: ${resp.status}`);
  const data = await resp.json();
  return data[0].map(item => item[0]).join('');
}

// ===== Bing / 微软翻译 =====
let bingToken = null;
let bingTokenExpiry = 0;

async function getBingToken() {
  if (bingToken && Date.now() < bingTokenExpiry) return bingToken;
  const resp = await fetch('https://edge.microsoft.com/translate/auth', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!resp.ok) throw new Error(`Bing 获取 token 失败: ${resp.status}`);
  bingToken = await resp.text();
  bingTokenExpiry = Date.now() + 8 * 60 * 1000;
  return bingToken;
}

async function translateBing(text, sourceLang, targetLang) {
  const token = await getBingToken();
  const to = BING_LANG_MAP[targetLang] || targetLang;
  const params = new URLSearchParams({ 'api-version': '3.0', to });
  if (sourceLang !== 'auto') {
    params.set('from', BING_LANG_MAP[sourceLang] || sourceLang);
  }

  const resp = await fetch(`https://api.cognitive.microsofttranslator.com/translate?${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify([{ Text: text }])
  });

  if (!resp.ok) {
    bingToken = null;
    throw new Error(`Bing 翻译请求失败: ${resp.status}`);
  }

  const data = await resp.json();
  return data[0].translations[0].text;
}

// ===== 腾讯翻译 =====
async function translateTencent(text, sourceLang, targetLang) {
  const from = sourceLang === 'auto' ? 'auto' : (TENCENT_LANG_MAP[sourceLang] || sourceLang);
  const to = TENCENT_LANG_MAP[targetLang] || targetLang;

  const resp = await fetch('https://transmart.qq.com/api/imt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Referer': 'https://transmart.qq.com/'
    },
    body: JSON.stringify({
      header: {
        fn: 'auto_translation',
        client_key: 'browser-chrome-130.0.0-Mac_OS_X-' + Date.now() + '-' + Math.random().toString(36).slice(2)
      },
      type: 'plain',
      model_category: 'normal',
      text_domain: 'general',
      source: { lang: from, text_list: [text] },
      target: { lang: to }
    })
  });

  if (!resp.ok) throw new Error(`腾讯翻译请求失败: ${resp.status}`);
  const data = await resp.json();

  if (data.auto_translation) {
    return data.auto_translation.join('');
  }
  if (data.header && data.header.ret_code !== 'succ') {
    throw new Error(`腾讯翻译错误: ${data.header.ret_code || '未知错误'}`);
  }
  throw new Error('腾讯翻译返回数据格式异常');
}

// ===== 自定义大模型 =====
async function translateCustomLLM(text, sourceLang, targetLang, config) {
  if (!config.endpoint || !config.apiKey) {
    throw new Error('请先在设置中配置自定义大模型的 API 地址和密钥');
  }

  const targetName = LANG_NAME_MAP[targetLang] || targetLang;
  const systemPrompt = config.systemPrompt.replace('{targetLang}', targetName);

  const endpoint = config.endpoint.replace(/\/$/, '');
  const url = endpoint.includes('/chat/completions') ? endpoint :
    endpoint.endsWith('/v1') ? `${endpoint}/chat/completions` :
    `${endpoint}/v1/chat/completions`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.3
    })
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`大模型 API 请求失败 (${resp.status}): ${cleanErrorMessage(errBody, 150)}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content.trim();
}

// ===== 统一翻译入口 =====
async function translate(text, options = {}) {
  const settings = await getSettings();
  const engine = options.engine || settings.engine;
  const sourceLang = options.sourceLang || settings.sourceLang;
  const targetLang = options.targetLang || settings.targetLang;

  if (!text || !text.trim()) return '';

  switch (engine) {
    case TranslatorEngine.GOOGLE:
      return translateGoogle(text, sourceLang, targetLang);
    case TranslatorEngine.BING:
      return translateBing(text, sourceLang, targetLang);
    case TranslatorEngine.TENCENT:
      return translateTencent(text, sourceLang, targetLang);
    case TranslatorEngine.CUSTOM_LLM:
      return translateCustomLLM(text, sourceLang, targetLang, settings.customLLM);
    default:
      throw new Error(`未知的翻译引擎: ${engine}`);
  }
}

async function translateBatch(texts, options = {}) {
  const settings = await getSettings();
  const engine = options.engine || settings.engine;

  // 自定义大模型逐条串行
  if (engine === TranslatorEngine.CUSTOM_LLM) {
    const results = [];
    for (const text of texts) {
      results.push(await translate(text, options));
    }
    return results;
  }

  const batchSize = 10;
  const results = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const promises = batch.map(t => translate(t, options));
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }
  return results;
}
