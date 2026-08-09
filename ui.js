const UI = {
    init: async () => {
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
        if (hasData) {
            await UI.promptPassword(false);
        } else {
            const wantPass = confirm('Создать мастер-пароль для шифрования базы данных?');
            if (wantPass) await UI.promptPassword(true);
        }
        UI.bootstrap();
    },

    promptPassword: (isCreate) => {
        return new Promise(async (resolve) => {
            const modal = document.getElementById('master-password-modal');
            const title = document.getElementById('mp-title');
            const desc = document.getElementById('mp-desc');
            const input = document.getElementById('master-password-input');
            const confirm = document.getElementById('master-password-confirm');
            const btn = document.getElementById('mp-submit-btn');
            const err = document.getElementById('mp-error');

            modal.classList.remove('hidden');
            title.textContent = isCreate ? 'Создание ключа' : 'Авторизация';
            desc.textContent = isCreate ? 'Придумайте надежный пароль.' : 'Введите пароль для доступа.';
            btn.textContent = isCreate ? 'Создать' : 'Войти';
            
            if (isCreate) {
                confirm.classList.remove('hidden');
            } else {
                confirm.classList.add('hidden');
            }
            
            input.value = ''; 
            confirm.value = ''; 
            err.classList.add('hidden');

            setTimeout(() => input.focus(), 100);

            const submit = async () => {
                const pass = input.value.trim();
                if (pass.length < 6) { 
                    err.textContent = 'Минимум 6 символов'; 
                    err.classList.remove('hidden'); 
                    return; 
                }
                
                if (isCreate && pass !== confirm.value.trim()) { 
                    err.textContent = 'Пароли не совпадают'; 
                    err.classList.remove('hidden'); 
                    return; 
                }
                
                if (!isCreate) {
                    const encrypted = localStorage.getItem('contacts_encrypted');
                    if (encrypted) {
                        const test = await CryptoSystem.decryptWithMaster(encrypted, pass);
                        if (test === null) { 
                            err.textContent = 'Неверный пароль'; 
                            err.classList.remove('hidden'); 
                            return; 
                        }
                    }
                }

                masterPassword = pass;
                modal.classList.add('hidden');
                resolve();
            };

            btn.onclick = submit;
            input.onkeydown = e => { if (e.key === 'Enter') submit(); };
            if (isCreate) confirm.onkeydown = e => { if (e.key === 'Enter') submit(); };
        });
    },

    bootstrap: async () => {
        if (!localStorage.getItem('uid')) localStorage.setItem('uid', CryptoSystem.generateKey().slice(0, 16));
        currentUser = localStorage.getItem('uid');
        
        await UI.loadSettings();
        UI.setupListeners();
        
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('main-chat').classList.add('hidden');
        document.getElementById('sidebar').classList.remove('hidden-mobile');
    },

    loadSettings: async () => {
        myName = localStorage.getItem('myName') || 'Node_01';
        myAvatar = localStorage.getItem('myAvatar') || '';
        
        if (masterPassword) {
            contacts = await CryptoSystem.loadEncryptedContacts(masterPassword) || {};
        } else {
            contacts = JSON.parse(localStorage.getItem('contacts') || '{}');
        }
        UI.renderContacts();
    },

    renderContacts: () => {
        const list = document.getElementById('contact-list');
        if (!list) return;
        list.innerHTML = '';
        Object.entries(contacts).forEach(([id, c]) => {
            const div = document.createElement('div');
            div.className = `contact-item ${id === activePeer ? 'active' : ''}`;
            div.innerHTML = `
                <div class="avatar-placeholder">${c.avatar || '<svg class="icon"><use href="#icon-user"></use></svg>'}</div>
                <div class="contact-info">
                    <div class="contact-name">${c.name || id.slice(0,6)}</div>
                </div>
            `;
            div.onclick = () => UI.openChat(id);
            list.appendChild(div);
        });
    },

    openChat: (id) => {
        activePeer = id;
        localStorage.setItem('activePeer', id);
        document.getElementById('sidebar').classList.add('hidden-mobile');
        document.getElementById('main-chat').classList.remove('hidden');
        
        const c = contacts[id] || {};
        document.getElementById('chat-name').textContent = c.name || id.slice(0,6);
        document.getElementById('chat-avatar').innerHTML = c.avatar || '<svg class="icon"><use href="#icon-user"></use></svg>';
        
        UI.updateStatus();
        UI.loadMessages(id);
        UI.renderContacts();
    },

    updateStatus: () => {
        const state = window.WebRTC.getState();
        const isOnline = state.dataChannel && state.dataChannel.readyState === 'open';
        const dot = document.getElementById('status-dot');
        const txt = document.getElementById('chat-status');
        const banner = document.getElementById('connection-banner');
        
        if (isOnline) {
            dot.className = 'dot online';
            txt.textContent = 'Secure Connection';
            banner.classList.add('hidden');
        } else {
            dot.className = 'dot offline';
            txt.textContent = 'Disconnected';
            if (activePeer) banner.classList.remove('hidden');
        }
    },

    loadMessages: async (id) => {
        const container = document.getElementById('messages-container');
        if (!container) return;
        container.innerHTML = '';
        
        const history = await window.WebRTC.loadHistory(id);
        const state = window.WebRTC.getState();
        const localKey = contacts[id]?.localSessionKey;
        const remoteKey = contacts[id]?.remoteKey;

        for (const msg of history) {
            const isMine = msg.from === state.currentUser;
            const div = document.createElement('div');
            div.className = `message ${isMine ? 'mine' : 'other'}`;
            let content = '🔒 Encrypted';
            const key = isMine ? remoteKey : localKey;

            if (msg.type === 'image') {
                if (key && msg.ciphertext) {
                    const buf = await CryptoSystem.decryptData(msg.ciphertext, key);
                    if (buf) {
                        const url = URL.createObjectURL(new Blob([buf], { type: msg.mimeType }));
                        content = `<img src="${url}" onclick="UI.openLightbox('${url}')">`;
                    }
                }
            } else {
                if (key && msg.ciphertext) {
                    const txt = await CryptoSystem.decrypt(msg.ciphertext, key);
                    if (txt) content = txt;
                }
            }
            div.innerHTML = `<div>${content}</div><span class="message-time">${new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>`;
            container.appendChild(div);
        }
        container.scrollTop = container.scrollHeight;
    },

    setupListeners: () => {
        document.getElementById('theme-toggle-btn').onclick = () => {
            document.body.classList.toggle('light');
            const isLight = document.body.classList.contains('light');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
            document.querySelector('.theme-icon-dark').classList.toggle('hidden', isLight);
            document.querySelector('.theme-icon-light').classList.toggle('hidden', !isLight);
        };

        document.getElementById('new-chat-btn').onclick = () => {
            document.getElementById('new-chat-modal').classList.remove('hidden');
            UI.showStep('step-role');
        };
        
        document.querySelectorAll('.close-modal').forEach(b => b.onclick = () => b.closest('.modal-overlay').classList.add('hidden'));

        document.getElementById('settings-btn').onclick = () => {
            document.getElementById('set-name').value = myName;
            document.getElementById('settings-modal').classList.remove('hidden');
        };
        
        document.getElementById('btn-save-settings').onclick = async () => {
            myName = document.getElementById('set-name').value || 'Node_01';
            localStorage.setItem('myName', myName);
            UI.renderContacts();
            document.getElementById('settings-modal').classList.add('hidden');
        };
        
        document.getElementById('btn-wipe').onclick = () => {
            if (confirm('Удалить все данные?')) { localStorage.clear(); location.reload(); }
        };

        const inp = document.getElementById('message-input');
        inp.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            UI.toggleSendBtn();
        });
        
        inp.addEventListener('keypress', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.WebRTC.sendMessage(); }
        });
        
        document.getElementById('send-btn').onclick = window.WebRTC.sendMessage;
        document.getElementById('attach-btn').onclick = () => document.getElementById('file-input').click();
        document.getElementById('file-input').onchange = e => { if(e.target.files[0]) window.WebRTC.sendImage(e.target.files[0]); e.target.value=''; };

        document.getElementById('back-btn').onclick = () => {
            document.getElementById('sidebar').classList.remove('hidden-mobile');
            document.getElementById('main-chat').classList.add('hidden');
        };

        document.getElementById('btn-host-copy').onclick = () => { navigator.clipboard.writeText(window.currentPayload); alert('Copied'); };
        document.getElementById('guest-offer-input').addEventListener('input', window.WebRTC.processGuestInput);
        document.getElementById('btn-guest-generate').onclick = window.WebRTC.generateAnswer;
        document.getElementById('btn-guest-copy').onclick = () => { navigator.clipboard.writeText(window.guestPayload); alert('Copied'); };

        UI.setupPaste('host-paste-zone', 'host-answer-input');
        UI.setupPaste('guest-paste-zone', 'guest-offer-input');
    },

    toggleSendBtn: () => {
        const btn = document.getElementById('send-btn');
        const inp = document.getElementById('message-input');
        btn.disabled = inp.value.trim().length === 0;
    },

    setupPaste: (zoneId, inputId) => {
        const zone = document.getElementById(zoneId);
        const input = document.getElementById(inputId);
        zone.onclick = () => input.focus();
        zone.addEventListener('paste', (e) => {
            setTimeout(() => {
                input.dispatchEvent(new Event('input'));
            }, 100);
        });
    },

    showStep: (id) => {
        document.querySelectorAll('.step-view').forEach(el => el.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    },

    selectRole: (role) => {
        if (role === 'host') window.WebRTC.startHost();
        else window.WebRTC.startGuest();
    },

    goBack: () => UI.showStep('step-role'),

    setVoiceCode: (type, code) => {
        document.getElementById(`${type}-voice-code`).textContent = code;
    },

    showLoader: (type) => {
        document.getElementById(`${type}-loader`).classList.remove('hidden');
    },

    hideLoaders: () => {
        document.querySelectorAll('.loader-container').forEach(el => el.classList.add('hidden'));
    },

    resetGuest: () => {
        document.getElementById('guest-result').classList.add('hidden');
        document.getElementById('btn-guest-generate').disabled = true;
        document.getElementById('guest-offer-input').value = '';
    },

    showGuestResult: (code, payload) => {
        window.guestPayload = payload;
        UI.setVoiceCode('guest', code);
        document.getElementById('guest-result').classList.remove('hidden');
    },

    openLightbox: (src) => {
        const lb = document.getElementById('lightbox');
        document.getElementById('lb-img').src = src;
        lb.classList.remove('hidden');
        lb.onclick = (e) => { if(e.target === lb || e.target.closest('.lb-close')) lb.classList.add('hidden'); };
    },

    loadTheme: () => {
        if (localStorage.getItem('theme') === 'light') {
            document.body.classList.add('light');
            document.querySelector('.theme-icon-dark').classList.add('hidden');
            document.querySelector('.theme-icon-light').classList.remove('hidden');
        }
    }
};

document.addEventListener('DOMContentLoaded', UI.init);
