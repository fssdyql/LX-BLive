if (typeof global.File === 'undefined') {
    global.File = class { constructor() { throw new Error('File polyfill not implemented'); } };
}
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const MusicBot = require('./core/MusicBot');
const OBSServer = require('./core/OBSServer');
const ConfigManager = require('./core/ConfigManager');

const platforms =['tx', 'wy', 'kg', 'kw', 'mg'];
platforms.forEach(p => {
    try { require(path.join(__dirname, 'musicsdk', `lx-${p}.js`)); } catch (e) { }
});

const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');
const axios = require('axios');
const dayjs = require('dayjs');
const bigInt = require('big-integer');
const qs = require('qs');
const he = require('he');

const mfPackages = { 'cheerio': cheerio, 'crypto-js': CryptoJS, 'axios': axios, 'dayjs': dayjs, 'big-integer': bigInt, 'qs': qs, 'he': he };
const mfRequire = (name) => { const pkg = mfPackages[name]; if (pkg) { pkg.default = pkg; return pkg; } return null; };

let loadedMfPlugins = {}; 
let sandboxes = {};       
let pendingRequests = {};

let mainWindow;
let tray = null;
const bot = new MusicBot();
const obs = new OBSServer();

// 🌟 读取根目录下的 icon.png 作为全局图标
const iconPath = path.join(__dirname, 'icon.png');

function createTray() {
    let trayIcon;
    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
    } else {
        // 如果用户忘了放图片，使用默认隐形占位符防崩溃
        const iconBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAGFJREFUOE9jZKAQMELp/1TQD8ZgGpGGEQ0DBgasCgwMDAwMDDAFYBqRBbHqRBbEqhNZAKtOZAGsOpEFsOpEFsCqE1kAq05kQYI6cTUYmUbEo2FEMAwYmECRzUeR1E4jMhEA/1s2AYlYcR4AAAAASUVORK5CYII=";
        trayIcon = nativeImage.createFromDataURL(iconBase64);
    }
    
    tray = new Tray(trayIcon);
    const contextMenu = Menu.buildFromTemplate([
        { label: '显示主界面', click: () => { mainWindow.show(); mainWindow.restore(); } },
        { label: '退出程序', click: () => { app.quit(); } }
    ]);
    tray.setToolTip('lx-blive 弹幕点歌');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (!mainWindow.isVisible()) { mainWindow.show(); }
        else if (mainWindow.isMinimized()) { mainWindow.restore(); }
        else { mainWindow.hide(); }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1050, height: 780, minWidth: 950, minHeight: 700,
        frame: false, 
        icon: fs.existsSync(iconPath) ? iconPath : undefined, // 🌟 任务栏图标
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
        backgroundColor: '#1e1e2e', show: false
    });
    mainWindow.loadFile('renderer/index.html'); 
    mainWindow.setMenuBarVisibility(false);
    mainWindow.once('ready-to-show', () => { mainWindow.show(); initPlugins(); });

    obs.start(8888);

    bot.on('queue-update', (q) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('queue-update', q); obs.broadcast('queueUpdate', { queue: q }); });
    bot.on('playing-update', (song) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('playing-update', song); obs.broadcast('nowPlaying', song ? { song: song.name, requester: song.user, role: song.role } : null); });
    bot.on('log', (msg) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('log', msg); });
    bot.on('bili-status', (s) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bili-status', s); });
    bot.on('lx-status', (s) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lx-status', s); });
    bot.on('lx-progress', (p) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lx-progress', p); obs.broadcast('progress', { progress: p.progress, duration: p.duration }); });
    bot.on('alert', (data) => obs.broadcast('alert', data));

    bot.on('trigger-internal-search', (song) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bot-request-search', { reqId: song.id, keyword: song.name });
    });
    
    bot.on('trigger-plugin-resolve', async ({ platform, songInfo }) => {
        const boxes = Object.values(sandboxes);
        if (boxes.length === 0) { bot.emit('log', `[错误] 未挂载任何 LX 插件！`); bot.playNext(); return; }
        try {
            const urlsRes = await Promise.any(boxes.map(sb => requestSandbox(sb, platform, songInfo, '128k')));
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('play-local-audio', urlsRes);
        } catch(e) { bot.emit('log', `[LX解析失败] 所有插件无可用解析`); bot.playNext(); }
    });

    bot.on('trigger-mf-search-match', async (song) => {
        const keys = Object.keys(loadedMfPlugins);
        if (keys.length === 0) { bot.emit('log', '[MF模式] 错误：未导入任何 MF 插件！'); return bot.playNext(); }
        
        let allResults =[];
        await Promise.allSettled(keys.map(async (plat) => {
            try {
                const plugin = loadedMfPlugins[plat].instance;
                if (!plugin.search) return;
                const res = await plugin.search(song.name, 1, 'music');
                if (res && res.data) { res.data.forEach(item => { item._platform = plat; allResults.push(item); }); }
            } catch(e) {}
        }));

        let best = allResults.find(s => {
            const n = (s.title || '').toLowerCase();
            const si = (s.artist || '').toLowerCase();
            return n.includes(song.name.toLowerCase()) || si.includes(song.name.toLowerCase());
        });
        if(!best && allResults.length > 0) best = allResults[0];

        if (best) {
            bot.emit('log', `[MF匹配] 找到匹配项: ${best.title} - ${best._platform}`);
            bot.emit('trigger-mf-resolve', { platform: best._platform, songInfo: best });
        } else {
            bot.emit('log', `[MF匹配失败] 所有插件均未能搜索到 ${song.name}`);
            bot.playNext();
        }
    });

    bot.on('trigger-mf-resolve', async ({ platform, songInfo }) => {
        const pluginWrap = loadedMfPlugins[platform];
        if (!pluginWrap || !pluginWrap.instance.getMediaSource) { bot.emit('log', `[MF解析失败] 插件不支持`); return bot.playNext(); }
        try {
            const result = await pluginWrap.instance.getMediaSource(songInfo, 'standard');
            if (result && result.url) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('play-local-audio', result.url); } 
            else { bot.emit('log', `[MF解析失败] 获取不到播放链接`); bot.playNext(); }
        } catch(e) { bot.emit('log', `[MF解析异常] ${e.message}`); bot.playNext(); }
    });

    bot.reloadConfig();
    createTray();
}

function initPlugins() {
    const config = ConfigManager.get();
    if(config.plugins) config.plugins.forEach(p => { if (fs.existsSync(p)) loadPluginIntoSandbox(p); });
    if(config.mfPlugins) config.mfPlugins.forEach(p => { if (fs.existsSync(p)) loadMFPlugin(p); });
}

function loadPluginIntoSandbox(filePath) {
    try {
        const scriptCode = fs.readFileSync(filePath, 'utf-8');
        const scriptId = 'custom_source_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        let sb = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'musicsdk', 'lx-source-tester.sandbox-preload.js'), contextIsolation: true, sandbox: false } });
        sandboxes[scriptId] = sb;
        sb.loadURL('about:blank');
        sb.webContents.once('did-finish-load', () => {
            const safeCode = `window.__SCRIPT_ID__ = "${scriptId}"; try { ${scriptCode} } catch(e){} void 0;`;
            sb.webContents.executeJavaScript(safeCode).catch(()=>{});
        });
        return { success: true, scriptId, msg: '加载成功' };
    } catch(err) { return { success: false, msg: err.message }; }
}

function requestSandbox(sb, platform, songInfo, quality) {
    return new Promise((resolve, reject) => {
        const reqId = 'req_' + Date.now();
        pendingRequests[reqId] = { resolve, reject };
        sb.webContents.send('trigger-request', reqId, { action: 'musicUrl', source: platform, info: { type: 'musicUrl', musicInfo: songInfo, quality: quality } });
        setTimeout(() => { if (pendingRequests[reqId]) { reject(new Error('超时')); delete pendingRequests[reqId]; } }, 15000);
    });
}

function loadMFPlugin(filePath) {
    try {
        const funcCode = fs.readFileSync(filePath, 'utf-8');
        const _module = { exports: {} };
        const env = { getUserVariables: () => ({}), os: process.platform, appVersion: 'lx-blive-1.0', lang: 'zh-CN' };
        const _process = { platform: process.platform, version: process.versions.node, env };
        
        Function(`'use strict'; return function(require, __musicfree_require, module, exports, console, env, process) { ${funcCode} }`)()
        (mfRequire, mfRequire, _module, _module.exports, console, env, _process);

        const instance = _module.exports.default ? _module.exports.default : _module.exports;
        if (instance && instance.platform) {
            loadedMfPlugins[instance.platform] = { instance, path: filePath };
            return { success: true, platform: instance.platform, msg: '加载成功' };
        }
        return { success: false, msg: '无效的MF插件' };
    } catch (err) { return { success: false, msg: err.message }; }
}

ipcMain.on('window-hide', () => mainWindow.hide());
ipcMain.on('window-min', () => mainWindow.minimize());
ipcMain.on('window-max', () => { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); });
ipcMain.on('window-close', () => app.quit()); 

ipcMain.handle('import-mf-plugin', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters:[{ name: 'Javascript', extensions: ['js'] }] });
    if (canceled || filePaths.length === 0) return { success: false };
    const res = loadMFPlugin(filePaths[0]);
    if(res.success) {
        let cfg = ConfigManager.get();
        if(!cfg.mfPlugins) cfg.mfPlugins =[];
        if(!cfg.mfPlugins.includes(filePaths[0])) { cfg.mfPlugins.push(filePaths[0]); ConfigManager.save(cfg); }
    }
    return res;
});

ipcMain.handle('remove-mf-plugin', (event, pathToRemove) => {
    let cfg = ConfigManager.get();
    if(cfg.mfPlugins) { cfg.mfPlugins = cfg.mfPlugins.filter(p => p !== pathToRemove); ConfigManager.save(cfg); }
    const plat = Object.keys(loadedMfPlugins).find(k => loadedMfPlugins[k].path === pathToRemove);
    if(plat) delete loadedMfPlugins[plat];
    return { success: true };
});

ipcMain.handle('mf-search-all', async (event, keyword) => {
    let allResults =[];
    const keys = Object.keys(loadedMfPlugins);
    await Promise.allSettled(keys.map(async (plat) => {
        try {
            const plugin = loadedMfPlugins[plat].instance;
            if (plugin.search) {
                const res = await plugin.search(keyword, 1, 'music');
                if (res && res.data) {
                    res.data.forEach(item => { item._platform = plat; allResults.push(item); });
                }
            }
        } catch(e) {}
    }));
    return allResults;
});

ipcMain.handle('import-source', async () => { 
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties:['openFile'], filters:[{ name: 'Javascript', extensions: ['js'] }] });
    if (canceled || filePaths.length === 0) return { success: false };
    const res = loadPluginIntoSandbox(filePaths[0]);
    if(res.success) { let cfg = ConfigManager.get(); if(!cfg.plugins) cfg.plugins =[]; if(!cfg.plugins.includes(filePaths[0])) { cfg.plugins.push(filePaths[0]); ConfigManager.save(cfg); } }
    return res;
});
ipcMain.handle('remove-plugin', (event, pathToRemove) => {
    let cfg = ConfigManager.get();
    if(cfg.plugins) { cfg.plugins = cfg.plugins.filter(p => p !== pathToRemove); ConfigManager.save(cfg); }
    return { success: true };
});

ipcMain.handle('get-config', () => ConfigManager.get());
ipcMain.handle('save-config', (event, newConfig) => { ConfigManager.save(newConfig); bot.reloadConfig(); return { success: true }; });
ipcMain.handle('skip-song', () => bot.playNext());
ipcMain.handle('remove-song', (event, songId) => bot.removeFromQueue(songId));
ipcMain.handle('manual-add-direct', (event, songObj, user) => bot.manualAddDirect(songObj, user));
ipcMain.handle('manual-add', (event, name, user) => bot.manualAdd(name, user));

ipcMain.on('sandbox-event', (event, type, data) => {
    if (type === 'response') { const { reqId, response } = data; if (pendingRequests[reqId]) { pendingRequests[reqId].resolve(response); delete pendingRequests[reqId]; } } 
    else if (type === 'error') { const { reqId, msg } = data; if (pendingRequests[reqId]) { pendingRequests[reqId].reject(new Error(msg)); delete pendingRequests[reqId]; } }
});

ipcMain.on('bot-search-result', (e, { reqId, best }) => bot.handleInternalSearchResult(best));
ipcMain.on('local-audio-ended', () => bot.playNext());
ipcMain.on('local-audio-progress', (event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lx-progress', data);
    obs.broadcast('progress', { progress: data.progress, duration: data.duration });
});

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });

app.on('will-quit', () => {
    for (let id in sandboxes) {
        if (sandboxes[id] && !sandboxes[id].isDestroyed()) sandboxes[id].destroy();
    }
    if (obs.server) obs.server.close();
    process.exit(0);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
process.on('uncaughtException', () => {});