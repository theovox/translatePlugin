(function () {
  if (window.__tpInjected) return;
  window.__tpInjected = true;

  let isTranslating = false;
  let floatPanel = null;
  let showingTranslation = true;
  let pageTranslated = false;
  let currentTranslateId = 0;

  function showIndicator(text) {
    removeIndicator();
    const el = document.createElement('div');
    el.className = 'tp-translating-indicator';
    el.id = 'tp-indicator';
    el.textContent = text;
    document.body.appendChild(el);
  }

  function removeIndicator() {
    const el = document.getElementById('tp-indicator');
    if (el) el.remove();
  }

  function toggleTranslation() {
    if (!pageTranslated) {
      showIndicator('请先翻译页面 (Alt+T)');
      setTimeout(removeIndicator, 1500);
      return;
    }

    showingTranslation = !showingTranslation;

    document.querySelectorAll('.tp-bilingual-wrapper').forEach(wrapper => {
      const original = wrapper.querySelector('.tp-original');
      const translated = wrapper.querySelector('.tp-translated');
      if (showingTranslation) {
        if (original) original.style.display = '';
        if (translated) translated.style.display = '';
      } else {
        if (translated) translated.style.display = 'none';
        if (original) original.style.display = '';
      }
    });

    document.querySelectorAll('[data-tp-original]').forEach(span => {
      if (showingTranslation) {
        span.textContent = span.dataset.tpTranslated;
        span.style.color = '';
      } else {
        span.textContent = span.dataset.tpOriginal;
        span.style.color = 'inherit';
      }
    });

    showIndicator(showingTranslation ? '已显示译文' : '已显示原文');
    setTimeout(removeIndicator, 1500);
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    if (e.altKey && (e.key === 'r' || e.key === 'R' || e.key === '®')) {
      e.preventDefault();
      toggleTranslation();
    }

    if (e.altKey && (e.key === 'a' || e.key === 'A' || e.key === 'å')) {
      e.preventDefault();
      toggleAutoTranslate();
    }

    if (e.key === 'Escape') removeFloatPanel();
  });

  async function toggleAutoTranslate() {
    const settings = await sendMessage({ action: 'getSettings' });
    const newVal = !settings.autoTranslate;
    await new Promise(resolve => chrome.storage.sync.set({ autoTranslate: newVal }, resolve));
    showIndicator(newVal ? '自动翻译: 已开启' : '自动翻译: 已关闭');
    setTimeout(removeIndicator, 2000);
  }

  function getTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement?.tagName;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE'].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement?.closest('.tp-bilingual-wrapper, .tp-float-panel, .tp-translating-indicator')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement?.hasAttribute('data-tp-original')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement?.isContentEditable) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  function abortTranslation() {
    currentTranslateId++;
    isTranslating = false;
  }

  async function translatePage() {
    // 如果正在翻译，中断旧任务
    if (isTranslating) {
      abortTranslation();
      await new Promise(r => setTimeout(r, 100));
    }

    const myId = ++currentTranslateId;
    isTranslating = true;
    showingTranslation = true;

    if (pageTranslated) {
      clearTranslation();
    }

    try {
      const settings = await sendMessage({ action: 'getSettings' });
      const engineNames = { google: '谷歌翻译', bing: 'Bing 翻译', tencent: '腾讯翻译', custom_llm: '自定义大模型' };
      const engineName = engineNames[settings.engine] || settings.engine;

      if (myId !== currentTranslateId) return;
      showIndicator(`[${engineName}] 正在翻译页面...`);

      const textNodes = getTextNodes(document.body);

      if (textNodes.length === 0) {
        removeIndicator();
        isTranslating = false;
        return;
      }

      const batchSize = 20;
      for (let i = 0; i < textNodes.length; i += batchSize) {
        if (myId !== currentTranslateId) {
          showIndicator('翻译已中断');
          setTimeout(removeIndicator, 1500);
          return;
        }

        const batchNodes = textNodes.slice(i, i + batchSize);
        const batchTexts = batchNodes.map(n => n.textContent.trim()).filter(Boolean);

        if (batchTexts.length === 0) continue;

        const resp = await sendMessage({
          action: 'translateBatch',
          texts: batchTexts,
          options: {}
        });

        if (myId !== currentTranslateId) {
          showIndicator('翻译已中断');
          setTimeout(removeIndicator, 1500);
          return;
        }

        if (!resp.success) {
          showIndicator(`[${engineName}] 翻译出错: ${resp.error}`);
          setTimeout(removeIndicator, 3000);
          isTranslating = false;
          return;
        }

        let textIdx = 0;
        batchNodes.forEach(node => {
          const text = node.textContent.trim();
          if (!text) return;
          if (resp.results[textIdx]) {
            applyTranslation(node, resp.results[textIdx], settings.displayMode);
          }
          textIdx++;
        });

        const progress = Math.min(i + batchSize, textNodes.length);
        showIndicator(`[${engineName}] 正在翻译... ${progress}/${textNodes.length}`);
      }

      if (myId !== currentTranslateId) return;

      pageTranslated = true;
      showIndicator(`[${engineName}] 翻译完成 (Alt+R 切换原文/译文)`);
      setTimeout(removeIndicator, 3000);
    } catch (err) {
      if (myId === currentTranslateId) {
        showIndicator(`翻译出错: ${err.message}`);
        setTimeout(removeIndicator, 3000);
      }
    }

    if (myId === currentTranslateId) {
      isTranslating = false;
    }
  }

  function applyTranslation(textNode, translated, displayMode) {
    const parent = textNode.parentElement;
    if (!parent) return;

    if (displayMode === 'replace') {
      const span = document.createElement('span');
      span.textContent = translated;
      span.dataset.tpOriginal = textNode.textContent;
      span.dataset.tpTranslated = translated;
      span.style.color = '#1a73e8';
      textNode.replaceWith(span);
    } else {
      const wrapper = document.createElement('span');
      wrapper.className = 'tp-bilingual-wrapper';

      const original = document.createElement('span');
      original.className = 'tp-original';
      original.textContent = textNode.textContent;

      const trans = document.createElement('span');
      trans.className = 'tp-translated';
      trans.textContent = translated;

      wrapper.appendChild(original);
      wrapper.appendChild(trans);
      textNode.replaceWith(wrapper);
    }
  }

  async function translateSelection() {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    showFloatPanel(text, rect);
  }

  async function translateText(text) {
    const selection = window.getSelection();
    let rect;
    if (selection && selection.rangeCount > 0) {
      rect = selection.getRangeAt(0).getBoundingClientRect();
    }
    if (!rect || (rect.x === 0 && rect.y === 0)) {
      rect = { left: window.innerWidth / 2 - 150, top: window.innerHeight / 2 - 50, bottom: window.innerHeight / 2 };
    }
    showFloatPanel(text, rect);
  }

  async function showFloatPanel(text, rect) {
    removeFloatPanel();

    const panel = document.createElement('div');
    panel.className = 'tp-float-panel';

    const top = rect.bottom + window.scrollY + 8;
    let left = rect.left + window.scrollX;
    if (left + 420 > window.innerWidth) left = window.innerWidth - 430;
    if (left < 10) left = 10;

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.position = 'absolute';

    const engineNames = { google: '谷歌翻译', bing: 'Bing 翻译', tencent: '腾讯翻译', custom_llm: '自定义大模型' };

    panel.innerHTML = `
      <div class="tp-float-header">
        <span class="tp-float-engine">翻译中...</span>
        <button class="tp-float-close">&times;</button>
      </div>
      <div class="tp-float-original">${escapeHtml(text.length > 200 ? text.slice(0, 200) + '...' : text)}</div>
      <div class="tp-float-result tp-float-loading">正在翻译...</div>
    `;

    panel.querySelector('.tp-float-close').addEventListener('click', removeFloatPanel);
    document.body.appendChild(panel);
    floatPanel = panel;

    try {
      const settings = await sendMessage({ action: 'getSettings' });
      const resp = await sendMessage({ action: 'translate', text, options: {} });

      if (!panel.isConnected) return;

      if (resp.success) {
        panel.querySelector('.tp-float-engine').textContent = engineNames[settings.engine] || settings.engine;
        panel.querySelector('.tp-float-result').className = 'tp-float-result';
        panel.querySelector('.tp-float-result').textContent = resp.result;
      } else {
        panel.querySelector('.tp-float-result').className = 'tp-float-result tp-float-error';
        panel.querySelector('.tp-float-result').textContent = resp.error;
      }
    } catch (err) {
      if (panel.isConnected) {
        panel.querySelector('.tp-float-result').className = 'tp-float-result tp-float-error';
        panel.querySelector('.tp-float-result').textContent = err.message;
      }
    }
  }

  function removeFloatPanel() {
    if (floatPanel) {
      floatPanel.remove();
      floatPanel = null;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      try {
        if (!chrome.runtime?.id) {
          reject(new Error('插件已更新，请刷新页面'));
          return;
        }
        chrome.runtime.sendMessage(msg, resp => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(resp);
          }
        });
      } catch (err) {
        reject(new Error('插件已更新，请刷新页面'));
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (floatPanel && !floatPanel.contains(e.target)) {
      removeFloatPanel();
    }
  });

  function isChinesePage() {
    const lang = (document.documentElement.lang || '').toLowerCase();
    if (lang.startsWith('zh')) return true;

    // 采样页面文本判断是否为中文
    const sample = document.body?.innerText?.slice(0, 500) || '';
    const chineseChars = sample.match(/[一-鿿]/g);
    if (chineseChars && chineseChars.length > sample.length * 0.3) return true;

    return false;
  }

  // 自动翻译：页面加载时检查设置
  async function checkAutoTranslate() {
    try {
      const settings = await sendMessage({ action: 'getSettings' });
      if (settings.autoTranslate && !isChinesePage()) {
        setTimeout(() => translatePage(), 500);
      }
    } catch {}
  }
  checkAutoTranslate();

  // SPA 页面 URL 变化监听
  let lastUrl = location.href;

  function clearTranslation() {
    document.querySelectorAll('.tp-bilingual-wrapper').forEach(wrapper => {
      const original = wrapper.querySelector('.tp-original');
      if (original) {
        wrapper.replaceWith(document.createTextNode(original.textContent));
      }
    });
    document.querySelectorAll('[data-tp-original]').forEach(span => {
      span.replaceWith(document.createTextNode(span.dataset.tpOriginal));
    });
    pageTranslated = false;
    showingTranslation = true;
  }

  async function onUrlChange() {
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;

    // 中断正在进行的翻译
    if (isTranslating) {
      abortTranslation();
    }

    clearTranslation();

    try {
      const settings = await sendMessage({ action: 'getSettings' });
      if (settings.autoTranslate && !isChinesePage()) {
        setTimeout(() => translatePage(), 800);
      }
    } catch {}
  }

  const origPushState = history.pushState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    onUrlChange();
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    onUrlChange();
  };

  window.addEventListener('popstate', () => onUrlChange());

  let urlCheckTimer = null;
  const observer = new MutationObserver(() => {
    if (urlCheckTimer) return;
    urlCheckTimer = setTimeout(() => {
      urlCheckTimer = null;
      if (location.href !== lastUrl) {
        onUrlChange();
      }
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ ok: true });
      return;
    }
    if (message.action === 'translatePage') {
      translatePage();
    } else if (message.action === 'translateSelection') {
      translateSelection();
    } else if (message.action === 'translateText') {
      translateText(message.text);
    } else if (message.action === 'toggleTranslation') {
      toggleTranslation();
    }
  });
})();
