class CryptoSystem {
    static generateKey() {
        let a = new Uint8Array(32);
        crypto.getRandomValues(a);
        return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }
    static generateNonce() {
        let a = new Uint8Array(12);
        crypto.getRandomValues(a);
        return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }
    static hexToBytes(a) {
        let b = new Uint8Array(a.length / 2);
        for (let c = 0; c < b.length; c++) b[c] = parseInt(a.substr(c * 2, 2), 16);
        return b;
    }
    static bytesToHex(a) {
        return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }
    static async importKey(a) {
        let b = this.hexToBytes(a);
        return crypto.subtle.importKey('raw', b, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    static async deriveMasterKey(a, b) {
        let c = new TextEncoder().encode(a), d = await crypto.subtle.importKey('raw', c, 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b, iterations: 100000, hash: 'SHA-256' }, d, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    static getMasterSalt() {
        let a = localStorage.getItem('master_salt');
        if (!a) {
            let b = crypto.getRandomValues(new Uint8Array(16));
            a = this.bytesToHex(b);
            localStorage.setItem('master_salt', a);
        }
        return this.hexToBytes(a);
    }
    static async encryptWithMaster(a, b) {
        let c = this.getMasterSalt(), d = await this.deriveMasterKey(b, c), e = crypto.getRandomValues(new Uint8Array(12)), f = new TextEncoder().encode(a), g = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: e }, d, f), h = new Uint8Array(e.length + g.byteLength);
        h.set(e);
        h.set(new Uint8Array(g), e.length);
        return btoa(String.fromCharCode(...h));
    }
    static async decryptWithMaster(a, b) {
        try {
            let c = this.getMasterSalt(), d = await this.deriveMasterKey(b, c), e = Uint8Array.from(atob(a), f => f.charCodeAt(0)), g = e.slice(0, 12), h = e.slice(12), i = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: g }, d, h);
            return new TextDecoder().decode(i);
        } catch (j) { return null; }
    }
    static async saveEncryptedContacts(a, b) {
        let c = JSON.stringify(a), d = await this.encryptWithMaster(c, b);
        localStorage.setItem('contacts_encrypted', d);
    }
    static async loadEncryptedContacts(a) {
        let b = localStorage.getItem('contacts_encrypted');
        if (!b) return {};
        let c = await this.decryptWithMaster(b, a);
        return c ? JSON.parse(c) : null;
    }
    static async saveEncryptedHistory(a, b, c) {
        let d = `hist_${a}`, e = JSON.stringify(b), f = await this.encryptWithMaster(e, c);
        localStorage.setItem(d, f);
    }
    static async loadEncryptedHistory(a, b) {
        let c = `hist_${a}`, d = localStorage.getItem(c);
        if (!d) return [];
        let e = await this.decryptWithMaster(d, b);
        return e ? JSON.parse(e) : [];
    }
    static async encrypt(a, b) {
        let c = await this.importKey(b), d = crypto.getRandomValues(new Uint8Array(12)), e = new TextEncoder().encode(a), f = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: d }, c, e), g = new Uint8Array(d.length + f.byteLength);
        g.set(d);
        g.set(new Uint8Array(f), d.length);
        return btoa(String.fromCharCode(...g));
    }
    static async decrypt(a, b) {
        try {
            let c = await this.importKey(b), d = Uint8Array.from(atob(a), e => e.charCodeAt(0)), f = d.slice(0, 12), g = d.slice(12), h = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: f }, c, g);
            return new TextDecoder().decode(h);
        } catch (i) { return null; }
    }
    static async encryptData(a, b) {
        let c = await this.importKey(b), d = crypto.getRandomValues(new Uint8Array(12)), e = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: d }, c, a), f = new Uint8Array(d.length + e.byteLength);
        f.set(d);
        f.set(new Uint8Array(e), d.length);
        return btoa(String.fromCharCode(...f));
    }
    static async decryptData(a, b) {
        try {
            let c = await this.importKey(b), d = Uint8Array.from(atob(a), e => e.charCodeAt(0)), f = d.slice(0, 12), g = d.slice(12), h = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: f }, c, g);
            return h;
        } catch (i) { return null; }
    }
    static async sha256(a) {
        let b = new TextEncoder().encode(a), c = await crypto.subtle.digest('SHA-256', b);
        return this.bytesToHex(new Uint8Array(c));
    }
    static extractFingerprint(a) {
        let b = a.match(/a=fingerprint:(sha-\d+) (\S+)/);
        return b ? b[2].replace(/:/g, '').toLowerCase() : null;
    }
    static async generateVoiceCode(seed) {
        const hash = await this.sha256(seed);
        const bytes = this.hexToBytes(hash.slice(0, 4));
        const words = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'Red', 'Blue', 'Green', 'Yellow', 'Black', 'White', 'Zero', 'One'];
        return `${words[bytes[0] % 8]}-${words[8 + (bytes[1] % 6)]}-${bytes[2] % 100}-${bytes[3] % 100}`;
    }
}
