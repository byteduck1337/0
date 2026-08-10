const UI_LOG = {
  info: (...args) => console.log('%c[UI]', 'color: #06b6d4; font-weight: bold', ...args),
  error: (...args) => console.error('%c[UI Error]', 'color: #ef4444; font-weight: bold', ...args),
};
const UI = {
  init: () => {
    UI.loadTheme();
    if (!localStorage.getItem('eula_accepted')) {
      document.getElementById('eula-modal').classList.remove('hidden');
      document.getElementById('accept-eula-btn').onclick = () => {
        localStorage.setItem('eula_accepted', 'true');
        document.getElementById('eula-modal').classList.add('hidden');
        UI.checkAuth();
      };
    } else {
      UI.checkAuth();
    }
  },

  checkAuth: async () => {
    const hasData = localStorage.getItem('contacts_encrypted');
    await UI.promptPassword(!hasData);
    await UI.bootstrap();
  },

  promptPassword: (isCreate) => {
    return new Promise((resolve) => {
      const modal = document.getElementById('master-password-modal');
      const title = document.getElementById('mp-title');
      const desc = document.getElementById('mp-desc');
      const input = document.getElementById('master-password-input');
      const confirm = document.getElementById('master-password-confirm');
      const btn = document.getElementById('mp-submit-btn');
      const skip = document.getElementById('mp-skip-btn');
      const err = document.getElementById('mp-error');

      modal.classList.remove('hidden');
      title.textContent = isCreate ? 'Создание ключа' : 'Авторизация';
      desc.textContent = isCreate
        ? 'Мастер-пароль шифрует базу данных на этом устройстве. Утеря пароля означает потерю данных.'
        : 'Введите мастер-пароль для доступа к данным.';
      btn.textContent = isCreate ? 'Создать' : 'Войти';
      confirm.classList.toggle('hidden', !isCreate);
      skip.classList.toggle('hidden', !isCreate);
      input.value = ''; confirm.value = '';
      err.classList.add('hidden');
      setTimeout(() => input.focus(), 120);

      const submit = async () => {
        const pass = input.value.trim();
        if (pass.length < 6) { err.textContent = 'Минимум 6 символов'; err.classList.remove('hidden'); return; }
        if (isCreate && pass !== confirm.value.trim()) {
          err.textContent = 'Пароли не совпадают'; err.classList.remove('hidden'); return;
        }
        if (!isCreate) {
          const encrypted = localStorage.getItem('contacts_encrypted');
          if (encrypted) {
            const test = await CryptoSystem.decryptWithMaster(encrypted, pass);
            if (test === null) { err.textContent = 'Неверный пароль'; err.classList.remove('hidden'); return; }
          }
        }
        masterPassword = pass;
        modal.classList.add('hidden');
        resolve();
      };

      btn.onclick = submit;
      input.onkeydown = e => { if (e.key === 'Enter') submit(); };
      confirm.onkeydown = e => { if (e.key === 'Enter') submit(); };
      skip.onclick = () => { masterPassword = null; modal.classList.add('hidden'); resolve(); };
    });
  },

  bootstrap: async () => {
    if (!localStorage.getItem('uid')) localStorage.setItem('uid', CryptoSystem.generateKey().slice(0, 16));
    currentUser = localStorage.getItem('uid');
    await UI.loadSettings();
    UI.setupListeners();
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('me-name').textContent = myName;
    const last = localStorage.getItem('activePeer');
    if (last && contacts[last]) UI.openChat(last);
  },

  loadSettings: async () => {
    myName = localStorage.getItem('myName') || 'Node_01';
    myAvatar = localStorage.getItem('myAvatar') || '';
    if (masterPassword) {
      contacts = (await CryptoSystem.loadEncryptedContacts(masterPassword)) || {};
    } else {
      contacts = JSON.parse(localStorage.getItem('contacts') || '{}');
    }
    // миграция со старого формата ключей
    for (const c of Object.values(contacts)) {
      if (!c.localKeys) c.localKeys = c.localSessionKey ? [c.localSessionKey] : [];
      if (!c.remoteKeys) c.remoteKeys = c.remoteKey ? [c.remoteKey] : [];
    }
    UI.renderContacts();
  },

  renderContacts: () => {
    const list = document.getElementById('contact-list');
    if (!list) return;
    list.innerHTML = '';
    const state = window.WebRTC.getState();
    const online = state.dataChannel && state.dataChannel.readyState === 'open';
    const q = (document.getElementById('search-input')?.value || '').toLowerCase();

    const entries = Object.entries(contacts)
      .filter(([id, c]) => !q || (c.name || id).toLowerCase().includes(q));

    if (!entries.length) {
      list.innerHTML = `<div class="empty-hint">
        <svg class="icon lg dim"><use href="#i-user"></use></svg>
        <span>Пока пусто. Создайте первое соединение.</span>
      </div>`;
      return;
    }

    for (const [id, c] of entries) {
      const el = document.createElement('div');
      const isLive = id === activePeer && online;
      el.className = `contact-item ${id === activePeer ? 'active' : ''}`;
      el.innerHTML = `
        <div class="avatar">${c.avatar || '<svg class="icon"><use href="#i-user"></use></svg>'}</div>
        <div class="contact-meta">
          <div class="contact-name"></div>
          <div class="contact-sub">
            <span class="dot ${isLive ? 'online' : ''}"></span>
            ${isLive ? 'защищённый канал' : 'офлайн'}
          </div>
        </div>
        ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}`;
      el.querySelector('.contact-name').textContent = c.name || id.slice(0, 8);
      el.onclick = () => UI.openChat(id);
      list.appendChild(el);
    }
  },

  openChat: (id) => {
    activePeer = id;
    localStorage.setItem('activePeer', id);
    if (contacts[id]) contacts[id].unread = 0;
    document.getElementById('sidebar').classList.remove('visible');
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('main-chat').classList.remove('hidden');
    const c = contacts[id] || {};
    document.getElementById('chat-name').textContent = c.name || id.slice(0, 8);
    UI.updateStatus();
    UI.loadMessages(id);
    UI.renderContacts();
    setTimeout(() => document.getElementById('message-input').focus(), 100);
  },

  updateStatus: () => {
    const state = window.WebRTC.getState();
    const isOnline = state.dataChannel && state.dataChannel.readyState === 'open';
    const dot = document.getElementById('status-dot');
    const txt = document.getElementById('chat-status');
    const banner = document.getElementById('connection-banner');
    if (dot) dot.className = 'dot ' + (isOnline ? 'online' : 'offline');
    if (txt) txt.textContent = isOnline ? 'Защищённое соединение' : 'Не в сети';
    if (banner && activePeer) {
      const hasPhrase = !!(contacts[activePeer] && contacts[activePeer].phrase);
      const btn = document.getElementById('btn-reconnect');
      if (btn) btn.classList.toggle('hidden', !hasPhrase);
      if (isOnline) banner.classList.add('hidden');
      else banner.classList.remove('hidden');
    }
  },

  loadMessages: async (id) => {
    const container = document.getElementById('messages-container');
    if (!container) return;
    container.innerHTML = '';
    const history = await window.WebRTC.loadHistory(id);
    const state = window.WebRTC.getState();
    const c = contacts[id] || {};
    const myKeys = [...(c.remoteKeys || [])].reverse();
    const theirKeys = [...(c.localKeys || [])].reverse();

    const tryDecrypt = async (ciphertext, keys, isData) => {
      for (const k of keys) {
        const res = isData ? await CryptoSystem.decryptData(ciphertext, k)
                           : await CryptoSystem.decrypt(ciphertext, k);
        if (res) return res;
      }
      return null;
    };

    for (const msg of history) {
      const mine = msg.from === state.currentUser;
      const keys = mine ? myKeys : theirKeys;
      const row = document.createElement('div');
      row.className = 'message ' + (mine ? 'mine' : 'other');
      const body = document.createElement('div');
      body.className = 'msg-body';
      let ok = false;

      if (msg.type === 'image' && msg.ciphertext) {
        const buf = await tryDecrypt(msg.ciphertext, keys, true);
        if (buf) {
          const url = URL.createObjectURL(new Blob([buf], { type: msg.mimeType }));
          const img = document.createElement('img');
          img.src = url; img.loading = 'lazy';
          img.onclick = () => UI.openLightbox(url);
          body.appendChild(img); ok = true;
        }
      } else if (msg.ciphertext) {
        const text = await tryDecrypt(msg.ciphertext, keys, false);
        if (text) { body.textContent = text; ok = true; }
      }

      if (!ok) {
        body.classList.add('locked');
        body.innerHTML = '<svg class="icon sm"><use href="#i-lock"></use></svg><span>Не расшифровано</span>';
      }

      const time = document.createElement('span');
      time.className = 'msg-time';
      time.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      row.appendChild(body);
      row.appendChild(time);
      container.appendChild(row);
    }
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  },

  /* ---------- новое соединение ---------- */

  openNewSession: (prefill = '', autostart = false) => {
    document.getElementById('new-session-modal').classList.remove('hidden');
    UI.setConnectStage('idle');
    const input = document.getElementById('phrase-input');
    input.value = prefill;
    if (autostart && prefill) {
      UI.startConnect();
    } else {
      setTimeout(() => input.focus(), 120);
    }
  },

  setConnectStage: (stage) => {
    const form = document.getElementById('ns-form');
    const progress = document.getElementById('ns-progress');
    const status = document.getElementById('ns-status');
    const phraseCard = document.getElementById('ns-phrase-card');
    if (!form || !progress) return;

    if (stage === 'idle') {
      form.classList.remove('hidden');
      progress.classList.add('hidden');
      return;
    }
    form.classList.add('hidden');
    progress.classList.remove('hidden');
    phraseCard.classList.toggle('hidden', stage !== 'waiting');

    const texts = {
      checking: 'Проверяем канал…',
      waiting: 'Ожидаем второго участника',
      linking: 'Фраза принята — строим защищённый канал…',
    };
    status.textContent = texts[stage] || '';

    if (stage === 'waiting') {
      const s = window.WebRTC.getState().session;
      document.getElementById('ns-phrase').textContent = s ? s.display : '';
    }
  },

  startConnect: async () => {
    const phrase = document.getElementById('phrase-input').value.trim();
    if (!phrase) return;
    try {
      await window.WebRTC.connect(phrase);
    } catch (e) {
      UI.setConnectStage('idle');
      UI.toast(e.message || 'Ошибка соединения', 'error');
    }
  },

  onConnected: (roomId) => {
    document.getElementById('new-session-modal').classList.add('hidden');
    UI.setConnectStage('idle');
    UI.openChat(roomId);
    UI.toast('Защищённое соединение установлено', 'success');
  },

  copyText: async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    }
    UI.toast('Скопировано', 'success');
  },

  toast: (text, type = 'info') => {
    const wrap = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = type === 'error' ? 'alert' : type === 'success' ? 'check' : 'zap';
    el.innerHTML = `<svg class="icon sm"><use href="#i-${icon}"></use></svg><span></span>`;
    el.querySelector('span').textContent = text;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
    }, 3200);
  },

  openLightbox: (src) => {
    const lb = document.getElementById('lightbox');
    document.getElementById('lb-img').src = src;
    lb.classList.remove('hidden');
    lb.onclick = (e) => {
      if (e.target === lb || e.target.closest('.lb-close')) lb.classList.add('hidden');
    };
  },

  toggleSendBtn: () => {
    const btn = document.getElementById('send-btn');
    const inp = document.getElementById('message-input');
    btn.disabled = inp.value.trim().length === 0;
  },

  loadTheme: () => {
    if (localStorage.getItem('theme') === 'light') {
      document.body.classList.add('light');
      document.querySelector('.theme-icon-dark')?.classList.add('hidden');
      document.querySelector('.theme-icon-light')?.classList.remove('hidden');
    }
  },

  setupListeners: () => {
    document.getElementById('theme-toggle-btn').onclick = () => {
      document.body.classList.toggle('light');
      const isLight = document.body.classList.contains('light');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      document.querySelector('.theme-icon-dark').classList.toggle('hidden', isLight);
      document.querySelector('.theme-icon-light').classList.toggle('hidden', !isLight);
    };

    document.getElementById('new-session-btn').onclick = () => UI.openNewSession();

    document.querySelectorAll('.close-modal').forEach(b => {
      b.onclick = () => {
        const overlay = b.closest('.modal-overlay');
        if (overlay.id === 'new-session-modal') {
          window.WebRTC.cancelConnect();
          UI.setConnectStage('idle');
        }
        overlay.classList.add('hidden');
      };
    });

    /* новая сессия */
    document.getElementById('btn-gen-phrase').onclick = () => {
      const input = document.getElementById('phrase-input');
      input.value = window.WebRTC.generatePhrase();
      input.classList.remove('flash');
      void input.offsetWidth;
      input.classList.add('flash');
    };
    document.getElementById('btn-connect').onclick = UI.startConnect;
    document.getElementById('phrase-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); UI.startConnect(); }
    });
    document.getElementById('btn-cancel-connect').onclick = () => window.WebRTC.cancelConnect();
    document.getElementById('btn-copy-phrase').onclick = () => {
      UI.copyText(document.getElementById('ns-phrase').textContent);
    };

    /* настройки */
    document.getElementById('settings-btn').onclick = () => {
      document.getElementById('set-name').value = myName;
      document.getElementById('uid-display').textContent = currentUser || '—';
      document.getElementById('settings-modal').classList.remove('hidden');
    };
    document.getElementById('btn-save-settings').onclick = () => {
      myName = document.getElementById('set-name').value.trim() || 'Node_01';
      localStorage.setItem('myName', myName);
      document.getElementById('me-name').textContent = myName;
      document.getElementById('settings-modal').classList.add('hidden');
    };
    document.getElementById('btn-wipe').onclick = () => {
      if (confirm('Удалить все локальные данные без возможности восстановления?')) {
        localStorage.clear();
        location.reload();
      }
    };

    /* поиск */
    document.getElementById('search-input').addEventListener('input', UI.renderContacts);

    /* композер */
    const inp = document.getElementById('message-input');
    inp.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      UI.toggleSendBtn();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.WebRTC.sendMessage(); }
    });
    document.getElementById('send-btn').onclick = window.WebRTC.sendMessage;
    document.getElementById('attach-btn').onclick = () => document.getElementById('file-input').click();
    document.getElementById('file-input').onchange = e => {
      if (e.target.files[0]) window.WebRTC.sendImage(e.target.files[0]);
      e.target.value = '';
    };

    /* переподключение и навигация */
    document.getElementById('btn-reconnect').onclick = () => {
      if (activePeer) window.WebRTC.reconnect(activePeer);
    };
    document.getElementById('back-btn').onclick = () => {
      document.getElementById('sidebar').classList.add('visible');
    };
  },
};

document.addEventListener('DOMContentLoaded', UI.init);
