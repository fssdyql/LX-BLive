const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// 插件依赖库
const axios = require('axios');
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');
const dayjs = require('dayjs');
const qs = require('qs');
const he = require('he');
const bigInt = require('big-integer');

let mainWindow;
let currentPluginInstance = null;
let pluginUserVariables = {}; // 模拟插件配置

// 模拟 MF 插件的 require 环境
const packages = {
    'cheerio': cheerio,
    'crypto-js': CryptoJS,
    'axios': axios,
    'dayjs': dayjs,
    'big-integer': bigInt,
    'qs': qs,
    'he': he
};

const _require = (packageName) => {
    const pkg = packages[packageName];
    if (pkg) {
        pkg.default = pkg;
        return pkg;
    }
    return null;
};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// --- IPC 接口实现 ---

// 1. 加载插件
ipcMain.handle('load-plugin', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Javascript', extensions: ['js'] }]
    });
    
    if (canceled || filePaths.length === 0) return null;

    try {
        const funcCode = fs.readFileSync(filePaths[0], 'utf-8');
        const _module = { exports: {}, loaded: false };
        
        const env = {
            getUserVariables: () => pluginUserVariables,
            os: process.platform,
            appVersion: 'tester-1.0.0',
            lang: 'zh-CN'
        };

        const _process = {
            platform: process.platform,
            version: process.versions.node,
            env
        };

        // 核心：模拟 MusicFree 的沙盒执行机制
        Function(`
            'use strict';
            return function(require, __musicfree_require, module, exports, console, env, process) {
                ${funcCode}
            }
        `)()(_require, _require, _module, _module.exports, console, env, _process);

        currentPluginInstance = _module.exports.default ? _module.exports.default : _module.exports;
        
        return {
            platform: currentPluginInstance.platform,
            version: currentPluginInstance.version,
            author: currentPluginInstance.author,
            userVariables: currentPluginInstance.userVariables ||[],
            supportedMethods: Object.keys(currentPluginInstance).filter(k => typeof currentPluginInstance[k] === 'function')
        };
    } catch (err) {
        console.error(err);
        return { error: err.message };
    }
});

// 2. 更新插件配置
ipcMain.handle('set-config', (event, config) => {
    pluginUserVariables = config;
    return true;
});

// 3. 统一调用插件方法 (包含容错处理)
ipcMain.handle('call-method', async (event, methodName, ...args) => {
    if (!currentPluginInstance || typeof currentPluginInstance[methodName] !== 'function') {
        return { error: `插件未加载或不支持 ${methodName} 方法` };
    }
    try {
        const result = await currentPluginInstance[methodName](...args);
        return { data: result };
    } catch (err) {
        console.error(`调用 ${methodName} 出错:`, err);
        return { error: err.message || err.toString() };
    }
});