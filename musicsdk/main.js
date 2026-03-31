const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// 引入您的搜索API模块 (前提: 已经删除了它们底部的建窗代码)
require('./lx-tx.js');
require('./lx-wy.js');
require('./lx-kg.js');
require('./lx-kw.js');
require('./lx-mg.js');

let mainWindow;
let activeScriptId = null;
let sandboxes = {};
let pendingRequests = {};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1050, height: 750,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ==========================================
// 音源沙盒 (Sandbox) 核心引擎
// ==========================================

// 1. 导入并注入音源脚本
ipcMain.handle('import-source', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Javascript', extensions: ['js'] }]
    });
    if (canceled || filePaths.length === 0) return { success: false };
    
    try {
        const scriptCode = fs.readFileSync(filePaths[0], 'utf-8');
        const scriptId = 'custom_source_' + Date.now();

        // 销毁旧沙盒
        if (activeScriptId && sandboxes[activeScriptId]) {
            sandboxes[activeScriptId].destroy();
        }

        // 创建隐藏的沙盒窗口执行真正的解密音源
        let sb = new BrowserWindow({
            show: false,
            webPreferences: {
                // 指向您提供的 preload 文件
                preload: path.join(__dirname, 'lx-source-tester.sandbox-preload.js'),
                contextIsolation: true,
                sandbox: false
            }
        });
        sandboxes[scriptId] = sb;
        activeScriptId = scriptId;

        await sb.loadURL('about:blank');
        await sb.webContents.executeJavaScript(`window.__SCRIPT_ID__ = "${scriptId}";\n${scriptCode}`);
        
        return { success: true, scriptId, msg: '音源注入成功！' };
    } catch (err) {
        return { success: false, msg: err.message };
    }
});

// 2. 向沙盒发起音乐 URL 请求
ipcMain.handle('get-music-url', async (event, platform, songInfo, quality) => {
    if (!activeScriptId || !sandboxes[activeScriptId]) {
        throw new Error('请先点击右上角【导入音源脚本】！');
    }

    return new Promise((resolve, reject) => {
        const reqId = 'req_' + Date.now() + '_' + Math.random();
        pendingRequests[reqId] = { resolve, reject };

        // 构建 LX Music 标准的请求数据格式
        const requestData = {
            action: 'musicUrl',
            source: platform,
            info: {
                type: 'musicUrl',
                musicInfo: songInfo, 
                quality: quality
            }
        };

        // 发送给沙盒去解析
        sandboxes[activeScriptId].webContents.send('trigger-request', reqId, requestData);

        // 15秒超时控制
        setTimeout(() => {
            if (pendingRequests[reqId]) {
                delete pendingRequests[reqId];
                reject(new Error('音源脚本解析超时或无响应'));
            }
        }, 15000);
    });
});

// 3. 接收沙盒的解析结果
ipcMain.on('sandbox-event', (event, type, data) => {
    if (type === 'response') {
        const { reqId, response } = data;
        if (pendingRequests[reqId]) {
            pendingRequests[reqId].resolve(response);
            delete pendingRequests[reqId];
        }
    } else if (type === 'error') {
        const { reqId, msg } = data;
        if (pendingRequests[reqId]) {
            pendingRequests[reqId].reject(new Error(msg));
            delete pendingRequests[reqId];
        }
    }
});