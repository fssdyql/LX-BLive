const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    search: async (platform, keyword, page = 1) => {
        if (platform === 'tx') return await ipcRenderer.invoke('tx-api', 'search', keyword, page);
        if (platform === 'wy') return await ipcRenderer.invoke('wy-api-call', 'search', keyword, page);
        if (platform === 'kw') return await ipcRenderer.invoke('kw-api-call', 'search', keyword, page);
        if (platform === 'mg') return await ipcRenderer.invoke('mg-api', 'search', keyword, page);
        
        // 核心修复：完全迎合 lx-kg.js 的特殊对象传参格式！
        if (platform === 'kg') {
            return await ipcRenderer.invoke('kg-api-call', { 
                method: 'search', 
                args: [keyword, page, 20] 
            });
        }
    },
    getMusicUrl: (platform, songInfo, quality) => ipcRenderer.invoke('get-music-url', platform, songInfo, quality),
    importSource: () => ipcRenderer.invoke('import-source')
});