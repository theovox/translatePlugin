const ENGINE_INFO = {
  google:     { name: '谷歌翻译',     desc: '速度快、语种全，推荐首选' },
  bing:       { name: 'Bing 翻译',    desc: '微软翻译，质量高，学术文档友好' },
  tencent:    { name: '腾讯翻译',     desc: '国内通道，速度快，中英互译质量好' },
  custom_llm: { name: '自定义大模型', desc: '翻译质量最高，适合精翻，整页翻译 token 消耗大' }
};

const ALL_ENGINES = Object.keys(ENGINE_INFO);

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

const DEFAULT_SETTINGS = {
  engine: 'google',
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

document.addEventListener('DOMContentLoaded', async () => {
  const engineEl = document.getElementById('engine');
  const targetLangEl = document.getElementById('targetLang');
  const engineListEl = document.getElementById('engineList');
  const llmSection = document.getElementById('llmSection');
  const llmEndpoint = document.getElementById('llmEndpoint');
  const llmApiKey = document.getElementById('llmApiKey');
  const llmModel = document.getElementById('llmModel');
  const llmSystemPrompt = document.getElementById('llmSystemPrompt');
  const autoTranslateEl = document.getElementById('autoTranslate');

  LANGUAGES.forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = lang.name;
    targetLangEl.appendChild(opt);
  });

  const settings = await new Promise(resolve => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve);
  });

  const disabledEngines = settings.disabledEngines || [];

  function buildEngineSelect() {
    const currentVal = engineEl.value || settings.engine;
    engineEl.innerHTML = '';
    ALL_ENGINES.forEach(key => {
      if (disabledEngines.includes(key)) return;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = ENGINE_INFO[key].name;
      engineEl.appendChild(opt);
    });
    if (engineEl.querySelector(`option[value="${currentVal}"]`)) {
      engineEl.value = currentVal;
    }
    toggleLLMSection(engineEl.value);
  }

  function buildEngineList() {
    engineListEl.innerHTML = '';
    ALL_ENGINES.forEach(key => {
      const info = ENGINE_INFO[key];
      const enabled = !disabledEngines.includes(key);
      const li = document.createElement('li');
      li.className = 'engine-item' + (enabled ? '' : ' disabled');
      li.innerHTML = `
        <label class="engine-toggle">
          <input type="checkbox" data-engine="${key}" ${enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        <div class="engine-info">
          <div class="engine-name">${info.name}</div>
          <div class="engine-desc">${info.desc}</div>
        </div>
      `;
      engineListEl.appendChild(li);
    });

    engineListEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.engine;
        const li = cb.closest('.engine-item');
        if (cb.checked) {
          const idx = disabledEngines.indexOf(key);
          if (idx !== -1) disabledEngines.splice(idx, 1);
          li.classList.remove('disabled');
        } else {
          if (!disabledEngines.includes(key)) disabledEngines.push(key);
          li.classList.add('disabled');
          if (engineEl.value === key) {
            const firstEnabled = ALL_ENGINES.find(e => !disabledEngines.includes(e));
            if (firstEnabled) engineEl.value = firstEnabled;
          }
        }
        buildEngineSelect();
      });
    });
  }

  buildEngineList();
  buildEngineSelect();

  engineEl.value = settings.engine;
  targetLangEl.value = settings.targetLang;
  document.querySelector(`input[name="displayMode"][value="${settings.displayMode}"]`).checked = true;
  autoTranslateEl.checked = settings.autoTranslate || false;

  llmEndpoint.value = settings.customLLM.endpoint;
  llmApiKey.value = settings.customLLM.apiKey;
  llmModel.value = settings.customLLM.model;
  llmSystemPrompt.value = settings.customLLM.systemPrompt;

  toggleLLMSection(settings.engine);

  engineEl.addEventListener('change', () => {
    toggleLLMSection(engineEl.value);
  });

  function toggleLLMSection(engine) {
    llmSection.classList.toggle('visible', engine === 'custom_llm');
  }

  document.getElementById('saveBtn').addEventListener('click', () => {
    const data = {
      engine: engineEl.value,
      targetLang: targetLangEl.value,
      sourceLang: 'auto',
      displayMode: document.querySelector('input[name="displayMode"]:checked').value,
      autoTranslate: autoTranslateEl.checked,
      disabledEngines: [...disabledEngines],
      customLLM: {
        endpoint: llmEndpoint.value.trim(),
        apiKey: llmApiKey.value.trim(),
        model: llmModel.value.trim(),
        systemPrompt: llmSystemPrompt.value.trim() || DEFAULT_SETTINGS.customLLM.systemPrompt
      }
    };
    chrome.storage.sync.set(data, () => {
      showToast('设置已保存');
    });
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    chrome.storage.sync.set(DEFAULT_SETTINGS, () => {
      disabledEngines.length = 0;
      engineEl.value = DEFAULT_SETTINGS.engine;
      targetLangEl.value = DEFAULT_SETTINGS.targetLang;
      document.querySelector(`input[name="displayMode"][value="${DEFAULT_SETTINGS.displayMode}"]`).checked = true;
      autoTranslateEl.checked = false;
      llmEndpoint.value = '';
      llmApiKey.value = '';
      llmModel.value = DEFAULT_SETTINGS.customLLM.model;
      llmSystemPrompt.value = DEFAULT_SETTINGS.customLLM.systemPrompt;
      buildEngineList();
      buildEngineSelect();
      toggleLLMSection(DEFAULT_SETTINGS.engine);
      showToast('已恢复默认设置');
    });
  });

  document.getElementById('testLLM').addEventListener('click', async () => {
    const testResult = document.getElementById('testResult');
    testResult.className = 'test-result';
    testResult.style.display = 'block';
    testResult.textContent = '正在测试...';
    testResult.style.background = '#f0f0f0';
    testResult.style.color = '#666';

    const config = {
      endpoint: llmEndpoint.value.trim(),
      apiKey: llmApiKey.value.trim(),
      model: llmModel.value.trim()
    };

    if (!config.endpoint || !config.apiKey) {
      testResult.className = 'test-result error';
      testResult.textContent = '请先填写 API 地址和密钥';
      return;
    }

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'testLLM',
        config
      });

      if (resp.success) {
        testResult.className = 'test-result success';
        testResult.textContent = `连接成功！测试翻译结果: ${resp.result}`;
      } else {
        testResult.className = 'test-result error';
        testResult.textContent = `连接失败: ${resp.error}`;
      }
    } catch (err) {
      testResult.className = 'test-result error';
      testResult.textContent = `连接失败: ${err.message}`;
    }
  });
});

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}
