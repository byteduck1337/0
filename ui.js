const Settings = {
relayOnly: false,
displayName: ''
};

const UI = {
blobUrls: [],
messageCount: 0,
inviteLink: '',
sasWords: [],
typingHideTimer: null,
lastTypingSent: 0,
scan: { active: false, stream: null, timer: 0 },

el(id) {
return document.getElementById(id);
},

init() {
Settings.relayOnly = localStorage.getItem('0byte-relay') === '1';
const e = this.el.bind(this);
e('btn-create').addEventListener('click', () => this.onCreate());
e('btn-join').addEventListener('click', () => this.onJoinInput());
e('join-input').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') this.onJoinInput(); });
e('btn-scan').addEventListener('click', () => this.openScanner());
e('btn-copy').addEventListener('click', () => this.copy(this.inviteLink));
e('btn-share').addEventListener('click', () => {
if (navigator.share) navigator.share({ title: '/0byte/', url: this.inviteLink }).catch(() => {});
});
e('btn-cancel-wait').addEventListener('click', () => { Session.close(); this.showScreen('home'); });
e('btn-send').addEventListener('click', () => this.sendText());
e('message-input').addEventListener('keydown', (ev) => {
if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this.sendText(); }
});
e('message-input').addEventListener('input', () => this.onInput());
e('btn-attach').addEventListener('click', () => e('file-input').click());
e('file-input').addEventListener('change', (ev) => {
for (const f of ev.target.files) Transfer.send(f);
ev.target.value = '';
});
e('btn-burn').addEventListener('click', () => this.burn());
e('btn-settings').addEventListener('click', () => this.openSettings());
e('settings-close').addEventListener('click', () => this.closeModal('settings-modal'));
e('name-input').addEventListener('input', (ev) => {
Settings.displayName = ev.target.value.slice(0, 40);
Session.sendProfile();
});
e('relay-toggle').addEventListener('change', (ev) => {
Settings.relayOnly = ev.target.checked;
localStorage.setItem('0byte-relay', ev.target.checked ? '1' : '0');
});
e('sas-pill').addEventListener('click', () => {
this.el('sas-big').textContent = this.sasWords.join(' · ') || '—';
this.openModal('sas-modal');
});
e('sas-close').addEventListener('click', () => this.closeModal('sas-modal'));
e('scan-close').addEventListener('click', () => this.closeScanner());
e('scan-file-btn').addEventListener('click', () => e('scan-file').click());
e('scan-file').addEventListener('change', (ev) => {
this.scanFromFile(ev.target.files[0]);
ev.target.value = '';
});
e('lightbox').addEventListener('click', () => this.el('lightbox').classList.add('hidden'));
const chat = e('screen-chat');
let depth = 0;
chat.addEventListener('dragenter', (ev) => {
if (this.hasFiles(ev)) { ev.preventDefault(); depth++; e('drop-overlay').classList.add('visible'); }
});
chat.addEventListener('dragover', (ev) => { if (this.hasFiles(ev)) ev.preventDefault(); });
chat.addEventListener('dragleave', () => {
depth = Math.max(0, depth - 1);
if (!depth) e('drop-overlay').classList.remove('visible');
});
chat.addEventListener('drop', (ev) => {
if (!this.hasFiles(ev)) return;
ev.preventDefault();
depth = 0;
e('drop-overlay').classList.remove('visible');
for (const f of ev.dataTransfer.files) Transfer.send(f);
});
document.addEventListener('paste', (ev) => {
if (this.el('screen-chat').classList.contains('hidden')) return;
const files = ev.clipboardData ? ev.clipboardData.files : [];
for (const f of files) Transfer.send(f);
});
window.addEventListener('beforeunload', (ev) => {
if (this.messageCount > 0) { ev.preventDefault(); ev.returnValue = ''; }
});
if (location.hash.length > 10) this.joinLink(location.href);
},

hasFiles(ev) {
return ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');
},

showScreen(name) {
for (const s of ['home', 'wait', 'chat']) {
this.el('screen-' + s).classList.toggle('hidden', s !== name);
}
if (name === 'chat') {
const box = this.el('messages');
box.scrollTop = box.scrollHeight;
}
},

async onCreate() {
const btn = this.el('btn-create');
btn.disabled = true;
try {
const link = await Session.create();
this.inviteLink = link;
this.el('invite-link').textContent = link;
this.renderQR(link);
this.el('qr-wrap').classList.remove('hidden');
this.el('invite-row').classList.remove('hidden');
this.el('wait-spinner').classList.add('hidden');
this.el('wait-status').textContent = 'Ожидание собеседника…';
this.el('btn-share').classList.toggle('hidden', !navigator.share);
this.showScreen('wait');
} catch (err) {
this.toast('Не удалось создать комнату');
}
btn.disabled = false;
},

onJoinInput() {
const input = this.el('join-input');
const v = input.value.trim();
if (!v) { this.toast('Вставьте ссылку-приглашение'); return; }
input.value = '';
this.joinLink(v);
},

async joinLink(link) {
this.el('qr-wrap').classList.add('hidden');
this.el('invite-row').classList.add('hidden');
this.el('wait-spinner').classList.remove('hidden');
this.el('wait-status').textContent = 'Подключение…';
this.showScreen('wait');
try {
await Session.join(link);
} catch (err) {
this.fatal('Неверная ссылка-приглашение');
}
},

renderQR(text) {
const canvas = this.el('qr-canvas');
if (typeof qrcode !== 'function') {
this.el('qr-wrap').classList.add('hidden');
return;
}
try {
const qr = qrcode(0, 'M');
qr.addData(text);
qr.make();
const n = qr.getModuleCount();
const scale = Math.max(4, Math.floor(280 / n));
const margin = scale * 2;
canvas.width = n * scale + margin * 2;
canvas.height = canvas.width;
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = '#000000';
for (let r = 0; r < n; r++) {
for (let c = 0; c < n; c++) {
if (qr.isDark(r, c)) ctx.fillRect(margin + c * scale, margin + r * scale, scale, scale);
}
}
} catch (err) {
this.el('qr-wrap').classList.add('hidden');
}
},

signalState(state) {
if (this.el('screen-wait').classList.contains('hidden')) return;
const status = this.el('wait-status');
if (state === 'paired') status.textContent = 'Собеседник найден, устанавливаем канал…';
else status.textContent = Session.mode === 'host' ? 'Ожидание собеседника…' : 'Подключение…';
},

connState(state) {
if (state === 'connecting') this.el('peer-status').textContent = 'подключение…';
},

connected(words) {
this.sasWords = words;
this.el('sas-words').textContent = words.join(' · ') || '—';
this.el('status-dot').classList.add('online');
this.el('peer-status').textContent = 'онлайн';
const wasHidden = this.el('screen-chat').classList.contains('hidden');
this.showScreen('chat');
if (wasHidden) this.addSystem('Защищённое соединение установлено');
this.toast('Соединение установлено');
this.el('message-input').focus();
},

disconnected() {
this.el('status-dot').classList.remove('online');
this.el('peer-status').textContent = 'переподключение…';
},

peerLeft() {
this.el('status-dot').classList.remove('online');
this.el('peer-status').textContent = 'вышел';
if (!this.el('screen-chat').classList.contains('hidden')) this.addSystem('Собеседник покинул комнату');
},

fatal(message) {
Session.close();
this.showScreen('home');
this.toast(message);
},

setPeerName(name) {
this.el('peer-name').textContent = name || 'Собеседник';
},

peerTyping() {
const bar = this.el('typing-bar');
bar.classList.remove('hidden');
clearTimeout(this.typingHideTimer);
this.typingHideTimer = setTimeout(() => bar.classList.add('hidden'), 2000);
},

sendText() {
const input = this.el('message-input');
const text = input.value.trim();
if (!text) return;
if (!Session.sendText(text.slice(0, 16000))) {
this.toast('Нет соединения');
return;
}
this.addMessage({ mine: true, text: text.slice(0, 16000), ts: Date.now() });
input.value = '';
input.style.height = 'auto';
input.focus();
},

onInput() {
const input = this.el('message-input');
input.style.height = 'auto';
input.style.height = Math.min(input.scrollHeight, 120) + 'px';
const now = Date.now();
if (now - this.lastTypingSent > 1500) {
this.lastTypingSent = now;
Session.sendTyping();
}
},

addMessage({ mine, text, ts }) {
const box = this.el('messages');
const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
const div = document.createElement('div');
div.className = 'message ' + (mine ? 'my-message' : 'other-message');
const content = document.createElement('div');
content.className = 'message-content';
content.textContent = text;
const time = document.createElement('div');
time.className = 'message-time';
time.textContent = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
div.append(content, time);
box.append(div);
this.messageCount++;
if (mine || nearBottom) box.scrollTop = box.scrollHeight;
},

addSystem(text) {
const box = this.el('messages');
const div = document.createElement('div');
div.className = 'system-line';
div.textContent = text;
box.append(div);
box.scrollTop = box.scrollHeight;
},

trackUrl(url) {
this.blobUrls.push(url);
return url;
},

showImage(url) {
this.el('lightbox-img').src = url;
this.el('lightbox').classList.remove('hidden');
},

fileBubble({ id, name, size, mime, mine, file }) {
const box = this.el('messages');
const wrap = document.createElement('div');
wrap.className = 'message file-message ' + (mine ? 'my-message' : 'other-message');
const row = document.createElement('div');
row.className = 'file-row';
const icon = document.createElement('div');
icon.className = 'file-icon';
icon.innerHTML = '<svg class="icon"><use href="#i-' + (mime.startsWith('image/') ? 'image' : 'file') + '"></use></svg>';
const info = document.createElement('div');
info.className = 'file-info';
const nameEl = document.createElement('div');
nameEl.className = 'file-name';
nameEl.textContent = name;
nameEl.title = name;
const metaEl = document.createElement('div');
metaEl.className = 'file-meta';
metaEl.textContent = this.formatBytes(size);
info.append(nameEl, metaEl);
const cancelBtn = document.createElement('button');
cancelBtn.className = 'icon-btn file-cancel';
cancelBtn.innerHTML = '<svg class="icon"><use href="#i-x"></use></svg>';
cancelBtn.addEventListener('click', () => Transfer.cancel(id));
row.append(icon, info, cancelBtn);
const bar = document.createElement('div');
bar.className = 'progress';
const fill = document.createElement('div');
fill.className = 'progress-fill';
bar.append(fill);
wrap.append(row, bar);
box.append(wrap);
box.scrollTop = box.scrollHeight;
const self = this;
const finish = () => {
bar.remove();
cancelBtn.remove();
};
const preview = (source) => {
const url = self.trackUrl(URL.createObjectURL(source));
const img = document.createElement('img');
img.className = 'msg-img';
img.src = url;
img.alt = name;
img.addEventListener('click', () => self.showImage(url));
wrap.append(img);
};
return {
progress(ratio, speed) {
const pct = Math.min(100, Math.floor(ratio * 100));
fill.style.width = pct + '%';
metaEl.textContent = pct + '%' + (speed ? ' · ' + self.formatBytes(speed) + '/с' : '') + ' · ' + self.formatBytes(size);
},
done(blob) {
finish();
if (!mine && blob) {
if (mime.startsWith('image/')) preview(blob);
const url = self.trackUrl(URL.createObjectURL(blob));
const a = document.createElement('a');
a.className = 'file-save';
a.href = url;
a.download = name;
a.innerHTML = '<svg class="icon"><use href="#i-download"></use></svg>';
const label = document.createElement('span');
label.textContent = 'Сохранить';
a.append(label);
wrap.append(a);
metaEl.textContent = 'Получено · ' + self.formatBytes(size);
} else {
if (mine && file && mime.startsWith('image/')) preview(file);
metaEl.textContent = (mine ? 'Отправлено · ' : 'Получено · ') + self.formatBytes(size);
}
box.scrollTop = box.scrollHeight;
},
saved() {
finish();
metaEl.textContent = 'Сохранено на диск · ' + self.formatBytes(size);
},
cancelled() {
finish();
wrap.classList.add('file-cancelled');
metaEl.textContent = 'Отменено';
},
failed() {
finish();
wrap.classList.add('file-cancelled');
metaEl.textContent = 'Ошибка передачи';
}
};
},

async openScanner() {
this.openModal('scan-modal');
this.scan.active = true;
const video = this.el('scan-video');
try {
this.scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
video.srcObject = this.scan.stream;
await video.play();
let detector = null;
if ('BarcodeDetector' in window) {
try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; }
}
const canvas = this.el('scan-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const tick = async () => {
if (!this.scan.active) return;
if (video.readyState >= 2) {
try {
if (detector) {
const codes = await detector.detect(video);
if (codes.length) { this.onScanResult(codes[0].rawValue); return; }
} else if (typeof jsQR === 'function') {
canvas.width = video.videoWidth;
canvas.height = video.videoHeight;
ctx.drawImage(video, 0, 0);
const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
const code = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
if (code) { this.onScanResult(code.data); return; }
}
} catch (e) {}
}
this.scan.timer = setTimeout(tick, 200);
};
tick();
} catch (err) {
this.toast('Камера недоступна — загрузите фото QR');
}
},

closeScanner() {
this.scan.active = false;
clearTimeout(this.scan.timer);
if (this.scan.stream) {
for (const track of this.scan.stream.getTracks()) track.stop();
this.scan.stream = null;
}
this.el('scan-video').srcObject = null;
this.closeModal('scan-modal');
},

async scanFromFile(file) {
if (!file) return;
try {
const bitmap = await createImageBitmap(file);
const canvas = this.el('scan-canvas');
canvas.width = bitmap.width;
canvas.height = bitmap.height;
const ctx = canvas.getContext('2d', { willReadFrequently: true });
ctx.drawImage(bitmap, 0, 0);
if ('BarcodeDetector' in window) {
try {
const detector = new BarcodeDetector({ formats: ['qr_code'] });
const codes = await detector.detect(canvas);
if (codes.length) { this.onScanResult(codes[0].rawValue); return; }
} catch (e) {}
}
if (typeof jsQR === 'function') {
const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
const code = jsQR(d.data, d.width, d.height);
if (code) { this.onScanResult(code.data); return; }
}
this.toast('QR-код не найден на изображении');
} catch (err) {
this.toast('Не удалось прочитать изображение');
}
},

onScanResult(text) {
if (!text || text.indexOf('#') === -1) {
this.toast('Это не ссылка /0byte/');
return;
}
this.closeScanner();
this.joinLink(text);
},

openSettings() {
this.el('name-input').value = Settings.displayName;
this.el('relay-toggle').checked = Settings.relayOnly;
this.openModal('settings-modal');
},

openModal(id) {
this.el(id).classList.remove('hidden');
},

closeModal(id) {
this.el(id).classList.add('hidden');
},

burn() {
if (!confirm('Уничтожить сессию? Сообщения и файлы будут стёрты безвозвратно.')) return;
Session.close();
for (const url of this.blobUrls) {
try { URL.revokeObjectURL(url); } catch (e) {}
}
this.blobUrls = [];
this.messageCount = 0;
this.sasWords = [];
this.inviteLink = '';
this.el('messages').innerHTML = '';
this.el('sas-words').textContent = '—';
this.el('peer-name').textContent = 'Собеседник';
this.el('peer-status').textContent = 'офлайн';
this.el('status-dot').classList.remove('online');
this.el('typing-bar').classList.add('hidden');
this.showScreen('home');
this.toast('Сессия уничтожена');
},

copy(text) {
if (!text) return;
if (navigator.clipboard && navigator.clipboard.writeText) {
navigator.clipboard.writeText(text).then(() => this.toast('Скопировано')).catch(() => this.copyFallback(text));
} else {
this.copyFallback(text);
}
},

copyFallback(text) {
const ta = document.createElement('textarea');
ta.value = text;
document.body.append(ta);
ta.select();
try {
document.execCommand('copy');
this.toast('Скопировано');
} catch (e) {
this.toast('Не удалось скопировать');
}
ta.remove();
},

toast(message) {
const box = this.el('toasts');
const div = document.createElement('div');
div.className = 'toast';
div.textContent = message;
box.append(div);
setTimeout(() => {
div.classList.add('out');
setTimeout(() => div.remove(), 350);
}, 3000);
},

formatBytes(b) {
if (!isFinite(b) || b < 0) return '0 Б';
const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
let i = 0;
let v = b;
while (v >= 1024 && i < units.length - 1) {
v /= 1024;
i++;
}
return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}
};

UI.init();