// crypto.js
// Класс для AES-256-GCM шифрования через Web Crypto API.
class CryptoSystem {
    static generateKey() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    static hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    }

    static async importKey(hexKey) {
        const rawKey = this.hexToBytes(hexKey);
        return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }

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

    static async encryptData(arrayBuffer, hexKey) {
        const key = await this.importKey(hexKey);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, arrayBuffer);
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);
        return btoa(String.fromCharCode(...combined));
    }

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
}