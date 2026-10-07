class AssetManager {
    constructor() {
        this.cache = new Map();
    }

    async load(key, url) {
        return new Promise((resolve, reject) => {
            if (this.cache.has(key)) return resolve(this.cache.get(key));
            
            const img = new Image();
            img.onload = () => {
                this.cache.set(key, img);
                resolve(img);
            };
            img.onerror = () => reject(new Error(`Failed to mount asset: ${url}`));
            img.src = url;
        });
    }

    async loadMultiple(manifest) {
        const queue = Object.entries(manifest).map(([key, url]) => this.load(key, url));
        return Promise.all(queue);
    }

    get(key) {
        return this.cache.get(key);
    }
}