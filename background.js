importScripts('lib/translator.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '翻译选中文本',
    contexts: ['selection']
  });
});

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['styles/content.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || tab.url?.startsWith('chrome://')) return;

  await ensureContentScript(tab.id);

  if (command === 'translate-page') {
    chrome.tabs.sendMessage(tab.id, { action: 'translatePage' });
  } else if (command === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, { action: 'translateSelection' });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'translate-selection' && tab?.id) {
    await ensureContentScript(tab.id);
    chrome.tabs.sendMessage(tab.id, {
      action: 'translateText',
      text: info.selectionText
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'translate') {
    translate(message.text, message.options)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'translateBatch') {
    translateBatch(message.texts, message.options)
      .then(results => sendResponse({ success: true, results }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'getSettings') {
    getSettings().then(s => sendResponse(s));
    return true;
  }

  if (message.action === 'testLLM') {
    const config = message.config;
    const endpoint = config.endpoint.replace(/\/$/, '');
    const url = endpoint.includes('/chat/completions') ? endpoint :
      endpoint.endsWith('/v1') ? `${endpoint}/chat/completions` :
      `${endpoint}/v1/chat/completions`;

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: '你是一个翻译助手。' },
          { role: 'user', content: '请将 "Hello" 翻译为中文' }
        ],
        temperature: 0.3
      })
    })
      .then(async resp => {
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status}: ${cleanErrorMessage(errText, 150)}`);
        }
        return resp.json();
      })
      .then(data => {
        const result = data.choices?.[0]?.message?.content;
        sendResponse({ success: true, result });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});
