class CryptoSystem {
    static generateKey() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    static generateNonce() {
        const array = new Uint8Array(12);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    static hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        return bytes;
    }

    static bytesToHex(bytes) {
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    static async sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        return this.bytesToHex(new Uint8Array(hashBuffer));
    }

    static async importKey(hexKey) {
        const keyBuffer = this.hexToBytes(hexKey);
        return crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }

    static async deriveMasterKey(password, salt) {
        const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }

    static getMasterSalt() {
        let saltHex = localStorage.getItem('master_salt');
        if (!saltHex) {
            const salt = crypto.getRandomValues(new Uint8Array(16));
            saltHex = this.bytesToHex(salt);
            localStorage.setItem('master_salt', saltHex);
        }
        return this.hexToBytes(saltHex);
    }

    static async encryptWithMaster(data, password) {
        const salt = this.getMasterSalt();
        const key = await this.deriveMasterKey(password, salt);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(data));
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        return btoa(String.fromCharCode(...combined));
    }

    static async decryptWithMaster(encryptedBase64, password) {
        try {
            const salt = this.getMasterSalt();
            const key = await this.deriveMasterKey(password, salt);
            const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12));
            return new TextDecoder().decode(decrypted);
        } catch (e) { return null; }
    }

    static async saveEncryptedContacts(contacts, password) {
        const encrypted = await this.encryptWithMaster(JSON.stringify(contacts), password);
        localStorage.setItem('contacts_encrypted', encrypted);
    }

    static async loadEncryptedContacts(password) {
        const encrypted = localStorage.getItem('contacts_encrypted');
        if (!encrypted) return {};
        const json = await this.decryptWithMaster(encrypted, password);
        return json ? JSON.parse(json) : null;
    }

    static async saveEncryptedHistory(key, history, password) {
        const encrypted = await this.encryptWithMaster(JSON.stringify(history), password);
        localStorage.setItem(`hist_${key}`, encrypted);
    }

    static async loadEncryptedHistory(key, password) {
        const encrypted = localStorage.getItem(`hist_${key}`);
        if (!encrypted) return [];
        const json = await this.decryptWithMaster(encrypted, password);
        return json ? JSON.parse(json) : [];
    }

    static async encrypt(text, hexKey) {
        const key = await this.importKey(hexKey);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text));
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        return btoa(String.fromCharCode(...combined));
    }

    static async decrypt(encryptedBase64, hexKey) {
        try {
            const key = await this.importKey(hexKey);
            const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12));
            return new TextDecoder().decode(decrypted);
        } catch (e) { return null; }
    }

    static async encryptData(buffer, hexKey) {
        const key = await this.importKey(hexKey);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, buffer);
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        return btoa(String.fromCharCode(...combined));
    }

    static async decryptData(encryptedBase64, hexKey) {
        try {
            const key = await this.importKey(hexKey);
            const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12));
        } catch (e) { return null; }
    }

    static extractFingerprint(sdp) {
        const match = sdp.match(/a=fingerprint:(sha-\d+) (\S+)/);
        return match ? match[2].replace(/:/g, '').toLowerCase() : null;
    }

    // Генерация голосового кода (Alpha-Tango-Blue-12-98)
    static async generateVoiceCode(seed) {
        const hash = await this.sha256(seed);
        const bytes = this.hexToBytes(hash.slice(0, 8));
        
        const words = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 
                       'Red', 'Blue', 'Green', 'Yellow', 'Black', 'White', 'Zero', 'One'];
        
        const w1 = words[bytes[0] % 8];
        const w2 = words[8 + (bytes[1] % 6)];
        const n1 = bytes[2] % 100;
        const n2 = bytes[3] % 100;
        
        return `${w1}-${w2}-${n1.toString().padStart(2,'0')}-${n2.toString().padStart(2,'0')}`;
    }
}