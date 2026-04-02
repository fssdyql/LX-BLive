const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // 🌟 新增窗口控制
    windowHide: () => ipcRenderer.send('window-hide'),
    windowMin: () => ipcRenderer.send('window-min'),
    windowMax: () => ipcRenderer.send('window-max'),
    windowClose: () => ipcRenderer.send('window-close'),

    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config) => ipcRenderer.invoke('save-config', config),
    skipSong: () => ipcRenderer.invoke('skip-song'),
    manualAdd: (name, user) => ipcRenderer.invoke('manual-add', name, user),
    removeSong: (id) => ipcRenderer.invoke('remove-song', id),
    manualAddDirect: (songObj, user) => ipcRenderer.invoke('manual-add-direct', songObj, user),
    
    importSource: () => ipcRenderer.invoke('import-source'),
    removePlugin: (path) => ipcRenderer.invoke('remove-plugin', path),
    importMfPlugin: () => ipcRenderer.invoke('import-mf-plugin'),
    removeMfPlugin: (path) => ipcRenderer.invoke('remove-mf-plugin', path),
    mfSearchAll: (keyword) => ipcRenderer.invoke('mf-search-all', keyword),

    onQueueUpdate: (cb) => ipcRenderer.on('queue-update', (e, data) => cb(data)),
    onPlayingUpdate: (cb) => ipcRenderer.on('playing-update', (e, data) => cb(data)),
    onBiliStatus: (cb) => ipcRenderer.on('bili-status', (e, data) => cb(data)),
    onLxStatus: (cb) => ipcRenderer.on('lx-status', (e, data) => cb(data)),
    onLxProgress: (cb) => ipcRenderer.on('lx-progress', (e, data) => cb(data)),
    onLog: (cb) => ipcRenderer.on('log', (e, data) => cb(data)),

    search: async (platform, keyword, page = 1) => {
        if (platform === 'tx') return await ipcRenderer.invoke('tx-api', 'search', keyword, page);
        if (platform === 'wy') return await ipcRenderer.invoke('wy-api-call', 'search', keyword, page);
        if (platform === 'kw') return await ipcRenderer.invoke('kw-api-call', 'search', keyword, page);
        if (platform === 'mg') return await ipcRenderer.invoke('mg-api', 'search', keyword, page);
        if (platform === 'kg') return await ipcRenderer.invoke('kg-api-call', { method: 'search', args:[keyword, page, 20] });
    },

    onBotRequestSearch: (cb) => ipcRenderer.on('bot-request-search', (e, data) => cb(data)),
    sendBotSearchResult: (reqId, best) => ipcRenderer.send('bot-search-result', { reqId, best }),
    onPlayLocalAudio: (cb) => ipcRenderer.on('play-local-audio', (e, data) => cb(data)),
    sendLocalAudioProgress: (data) => ipcRenderer.send('local-audio-progress', data),
    sendLocalAudioEnded: () => ipcRenderer.send('local-audio-ended')
});