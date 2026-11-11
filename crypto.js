const WORD_LIST = [
'Альфа','Браво','Чарли','Дельта','Эхо','Фокстрот','Гольф','Отель',
'Индия','Джульет','Кило','Лима','Майк','Ноябрь','Оскар','Папа',
'Квебек','Ромео','Сьерра','Танго','Юниформ','Виктор','Виски','Рентген',
'Янки','Зулу','Красный','Синий','Зелёный','Жёлтый','Оранжевый','Пурпурный',
'Серебряный','Золотой','Кристальный','Алмазный','Рубиновый','Изумрудный','Сапфировый',
'Нефритовый','Ониксовый','Янтарный','Коралловый','Лазурный','Фиолетовый','Малиновый','Индиго',
'Бирюзовый','Магентовый','Оливковый','Бордовый'
];

class CryptoSystem {
static encoder = new TextEncoder();
static decoder = new TextDecoder();

static randomBytes(n) {
return crypto.getRandomValues(new Uint8Array(n));
}

static b64encode(buf) {
const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
let s = '';
for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

static b64decode(str) {
const s = String(str).replaceAll('-', '+').replaceAll('_', '/');
const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
return Uint8Array.from(atob(s + pad), c => c.charCodeAt(0));
}

static concat(a, b) {
const r = new Uint8Array(a.length + b.length);
r.set(a);
r.set(b, a.length);
return r;
}

static async sha256(bytes) {
return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

static async deriveRoom(secret) {
const roomHash = await this.sha256(this.concat(this.encoder.encode('0byte-room|'), secret));
const roomId = Array.from(roomHash.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
const keyRaw = await this.sha256(this.concat(this.encoder.encode('0byte-signal|'), secret));
const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
return { roomId, key };
}

static async seal(key, obj) {
const iv = this.randomBytes(12);
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, this.encoder.encode(JSON.stringify(obj)));
return { i: this.b64encode(iv), c: this.b64encode(ct) };
}

static async open(key, envelope) {
const pt = await crypto.subtle.decrypt(
{ name: 'AES-GCM', iv: this.b64decode(envelope.i) },
key,
this.b64decode(envelope.c)
);
return JSON.parse(this.decoder.decode(pt));
}

static fingerprint(sdp) {
const m = String(sdp).match(/a=fingerprint:sha-256 (\S+)/i);
return m ? m[1].replaceAll(':', '').toLowerCase() : '';
}

static async sas(localSdp, remoteSdp) {
const pair = [this.fingerprint(localSdp), this.fingerprint(remoteSdp)].sort().join('|');
const h = await this.sha256(this.encoder.encode(pair));
return Array.from(h.slice(0, 4), b => WORD_LIST[b % WORD_LIST.length]);
}
}