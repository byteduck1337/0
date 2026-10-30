class CryptoSystem {
    static generateKey() {
        const a = new Uint8Array(32);
        crypto.getRandomValues(a);
        return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }

    static generateNonce() {
        const a = new Uint8Array(12);
        crypto.getRandomValues(a);
        return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }

    static hexToBytes(a) {
        const b = new Uint8Array(a.length / 2);
        for (let c = 0; c < b.length; c++) {
            b[c] = parseInt(a.slice(c * 2, c * 2 + 2), 16);
        }
        return b;
    }

    static bytesToHex(a) {
        return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }

    static async importKey(a) {
        const b = this.hexToBytes(a);
        return crypto.subtle.importKey('raw', b, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }

    static async deriveMasterKey(a, b) {
        const c = new TextEncoder().encode(a);
        const d = await crypto.subtle.importKey('raw', c, 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: b, iterations: 100000, hash: 'SHA-256' },
            d,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    static getMasterSalt() {
        let a = localStorage.getItem('master_salt');
        if (!a) {
            const b = crypto.getRandomValues(new Uint8Array(16));
            a = this.bytesToHex(b);
            localStorage.setItem('master_salt', a);
        }
        return this.hexToBytes(a);
    }

    static async encryptWithMaster(a, b) {
        const c = this.getMasterSalt();
        const d = await this.deriveMasterKey(b, c);
        const e = crypto.getRandomValues(new Uint8Array(12));
        const f = new TextEncoder().encode(a);
        const g = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: e }, d, f);
        const h = new Uint8Array(e.length + g.byteLength);
        h.set(e);
        h.set(new Uint8Array(g), e.length);
        return btoa(String.fromCharCode(...h));
    }

    static async decryptWithMaster(a, b) {
        try {
            const c = this.getMasterSalt();
            const d = await this.deriveMasterKey(b, c);
            const e = Uint8Array.from(atob(a), f => f.charCodeAt(0));
            const g = e.slice(0, 12);
            const h = e.slice(12);
            const i = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: g }, d, h);
            return new TextDecoder().decode(i);
        } catch (j) {
            return null;
        }
    }

    static async saveEncryptedContacts(a, b) {
        const c = JSON.stringify(a);
        const d = await this.encryptWithMaster(c, b);
        localStorage.setItem('contacts_encrypted', d);
        // Не оставляем plaintext-копию
        localStorage.removeItem('contacts');
    }

    static async loadEncryptedContacts(a) {
        const b = localStorage.getItem('contacts_encrypted');
        if (!b) return {};
        const c = await this.decryptWithMaster(b, a);
        return c ? JSON.parse(c) : null;
    }

    static async saveEncryptedHistory(a, b, c) {
        const d = `hist_${a}`;
        const e = JSON.stringify(b);
        const f = await this.encryptWithMaster(e, c);
        localStorage.setItem(d, f);
    }

    static async loadEncryptedHistory(a, b) {
        const c = `hist_${a}`;
        const d = localStorage.getItem(c);
        if (!d) return [];
        const e = await this.decryptWithMaster(d, b);
        return e ? JSON.parse(e) : [];
    }

    static async encrypt(a, b) {
        const c = await this.importKey(b);
        const d = crypto.getRandomValues(new Uint8Array(12));
        const e = new TextEncoder().encode(a);
        const f = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: d }, c, e);
        const g = new Uint8Array(d.length + f.byteLength);
        g.set(d);
        g.set(new Uint8Array(f), d.length);
        return btoa(String.fromCharCode(...g));
    }

    static async decrypt(a, b) {
        try {
            const c = await this.importKey(b);
            const d = Uint8Array.from(atob(a), e => e.charCodeAt(0));
            const f = d.slice(0, 12);
            const g = d.slice(12);
            const h = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: f }, c, g);
            return new TextDecoder().decode(h);
        } catch (i) {
            return null;
        }
    }

    static async encryptData(a, b) {
        const c = await this.importKey(b);
        const d = crypto.getRandomValues(new Uint8Array(12));
        const e = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: d }, c, a);
        const f = new Uint8Array(d.length + e.byteLength);
        f.set(d);
        f.set(new Uint8Array(e), d.length);
        return btoa(String.fromCharCode(...f));
    }

    static async decryptData(a, b) {
        try {
            const c = await this.importKey(b);
            const d = Uint8Array.from(atob(a), e => e.charCodeAt(0));
            const f = d.slice(0, 12);
            const g = d.slice(12);
            const h = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: f }, c, g);
            return h;
        } catch (i) {
            return null;
        }
    }

    static async sha256(a) {
        const b = new TextEncoder().encode(a);
        const c = await crypto.subtle.digest('SHA-256', b);
        return this.bytesToHex(new Uint8Array(c));
    }

    static extractFingerprint(a) {
        const b = a.match(/a=fingerprint:(sha-\d+) (\S+)/);
        return b ? b[2].replace(/:/g, '').toLowerCase() : null;
    }

    static async generateVoiceCode(seed) {
        const hash = await this.sha256(seed);
        const bytes = this.hexToBytes(hash.slice(0, 4));
        const words = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'Red', 'Blue', 'Green', 'Yellow', 'Black', 'White', 'Zero', 'One'];
        return `${words[bytes[0] % 8]}-${words[8 + (bytes[1] % 6)]}-${bytes[2] % 100}-${bytes[3] % 100}`;
    }

    static async compressImage(file, maxDim = 800) {
        if (!file.type.startsWith('image/')) return { blob: file, type: file.type };
        try {
            const bitmap = await createImageBitmap(file);
            const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
            const w = Math.round(bitmap.width * scale);
            const h = Math.round(bitmap.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
            bitmap.close();
            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
            return { blob: blob || file, type: blob ? 'image/jpeg' : file.type };
        } catch (e) {
            return { blob: file, type: file.type };
        }
    }
}
