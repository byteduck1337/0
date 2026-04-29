// crypto.js
// Класс для AES-256-GCM шифрования через Web Crypto API.
// Добавлена поддержка мастер-ключа для защиты localStorage.

class CryptoSystem {
    // Генерация случайного ключа (hex)
    static generateKey() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    // Генерация случайного nonce (hex)
    static generateNonce() {
        const arr = new Uint8Array(12);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    // Hex → Uint8Array
    static hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    }

    // Uint8Array → Hex
    static bytesToHex(bytes) {
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }

    // Импорт ключа AES-GCM
    static async importKey(hexKey) {
        const rawKey = this.hexToBytes(hexKey);
        return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }

    // ========== Мастер-ключ для защиты localStorage ==========
    
    // Генерация мастер-ключа из пароля (PBKDF2)
    static async deriveMasterKey(password, salt) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    // Сохранить мастер-соль
    static getMasterSalt() {
        let saltHex = localStorage.getItem('master_salt');
        if (!saltHex) {
            const salt = crypto.getRandomValues(new Uint8Array(16));
            saltHex = this.bytesToHex(salt);
            localStorage.setItem('master_salt', saltHex);
        }
        return this.hexToBytes(saltHex);
    }

    // Зашифровать данные мастер-ключом
    static async encryptWithMaster(data, password) {
        const salt = this.getMasterSalt();
        const key = await this.deriveMasterKey(password, salt);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(data);
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);
        return btoa(String.fromCharCode(...combined));
    }

    // Расшифровать данные мастер-ключом
    static async decryptWithMaster(encryptedBase64, password) {
        try {
            const salt = this.getMasterSalt();
            const key = await this.deriveMasterKey(password, salt);
            const data = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            const iv = data.slice(0, 12);
            const ciphertext = data.slice(12);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            return null;
        }
    }

    // Сохранить контакты в зашифрованном виде
    static async saveEncryptedContacts(contacts, password) {
        const json = JSON.stringify(contacts);
        const encrypted = await this.encryptWithMaster(json, password);
        localStorage.setItem('contacts_encrypted', encrypted);
    }

    // Загрузить контакты из зашифрованного хранилища
    static async loadEncryptedContacts(password) {
        const encrypted = localStorage.getItem('contacts_encrypted');
        if (!encrypted) return {};
        const json = await this.decryptWithMaster(encrypted, password);
        return json ? JSON.parse(json) : null;
    }

    // Сохранить историю сообщений
    static async saveEncryptedHistory(peerId, messages, password) {
        const key = `hist_${peerId}`;
        const json = JSON.stringify(messages);
        const encrypted = await this.encryptWithMaster(json, password);
        localStorage.setItem(key, encrypted);
    }

    // Загрузить историю сообщений
    static async loadEncryptedHistory(peerId, password) {
        const key = `hist_${peerId}`;
        const encrypted = localStorage.getItem(key);
        if (!encrypted) return [];
        const json = await this.decryptWithMaster(encrypted, password);
        return json ? JSON.parse(json) : [];
    }

    // Шифрование текста для отправки
    static async encrypt(text, hexKey) {
        const key = await this.importKey(hexKey);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);
        return btoa(String.fromCharCode(...combined));
    }

    // Расшифровка текста
    static async decrypt(encryptedBase64, hexKey) {
        try {
            const key = await this.importKey(hexKey);
            const data = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            const iv = data.slice(0, 12);
            const ciphertext = data.slice(12);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error('Ошибка расшифровки:', e);
            return null;
        }
    }

    // Шифрование бинарных данных (изображения)
    static async encryptData(arrayBuffer, hexKey) {
        const key = await this.importKey(hexKey);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, arrayBuffer);
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);
        return btoa(String.fromCharCode(...combined));
    }

    // Расшифровка бинарных данных
    static async decryptData(encryptedBase64, hexKey) {
        try {
            const key = await this.importKey(hexKey);
            const data = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            const iv = data.slice(0, 12);
            const ciphertext = data.slice(12);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
            return decrypted;
        } catch (e) {
            console.error('Ошибка расшифровки данных:', e);
            return null;
        }
    }

    // Хеширование для верификации отпечатков
    static async sha256(message) {
        const encoded = new TextEncoder().encode(message);
        const hash = await crypto.subtle.digest('SHA-256', encoded);
        return this.bytesToHex(new Uint8Array(hash));
    }

    // Извлечение fingerprint из SDP
    static extractFingerprint(sdp) {
        const match = sdp.match(/a=fingerprint:(sha-\d+) (\S+)/);
        return match ? match[2].replace(/:/g, '').toLowerCase() : null;
    }
}