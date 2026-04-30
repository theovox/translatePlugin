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

document.addEventListener('DOMContentLoaded', async () => {
  const engineEl = document.getElementById('engine');
  const engineDescEl = document.getElementById('engineDesc');
  const targetLangEl = document.getElementById('targetLang');
  const modeBtns = document.querySelectorAll('.mode-switch button');
  const inputText = document.getElementById('inputText');
  const resultBox = document.getElementById('resultBox');
  const translatePageBtn = document.getElementById('translatePageBtn');
  const translateInputBtn = document.getElementById('translateInputBtn');

  LANGUAGES.forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = lang.name;
    targetLangEl.appendChild(opt);
  });

  const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const disabledEngines = settings.disabledEngines || [];

  engineEl.innerHTML = '';
  ALL_ENGINES.forEach(key => {
    if (disabledEngines.includes(key)) return;
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = ENGINE_INFO[key].name;
    engineEl.appendChild(opt);
  });

  engineEl.value = settings.engine;
  targetLangEl.value = settings.targetLang;
  updateEngineDesc();

  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === settings.displayMode);
  });

  function updateEngineDesc() {
    const info = ENGINE_INFO[engineEl.value];
    engineDescEl.textContent = info ? info.desc : '';
  }

  engineEl.addEventListener('change', () => {
    chrome.storage.sync.set({ engine: engineEl.value });
    updateEngineDesc();
  });

  targetLangEl.addEventListener('change', () => {
    chrome.storage.sync.set({ targetLang: targetLangEl.value });
  });

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chrome.storage.sync.set({ displayMode: btn.dataset.mode });
    });
  });

  translatePageBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || tab.url?.startsWith('chrome://')) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    } catch {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles/content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    }
    chrome.tabs.sendMessage(tab.id, { action: 'translatePage' });
    window.close();
  });

  translateInputBtn.addEventListener('click', async () => {
    const text = inputText.value.trim();
    if (!text) return;

    resultBox.className = 'result-box empty';
    resultBox.textContent = '正在翻译...';
    resultBox.style.color = '';

    const resp = await chrome.runtime.sendMessage({
      action: 'translate',
      text,
      options: {}
    });

    if (resp.success) {
      resultBox.className = 'result-box';
      resultBox.textContent = resp.result;
    } else {
      resultBox.className = 'result-box';
      resultBox.style.color = '#d93025';
      resultBox.textContent = resp.error;
    }
  });

  document.getElementById('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
