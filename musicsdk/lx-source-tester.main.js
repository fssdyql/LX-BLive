const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let sandboxes = {};

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadFile('index.html');
}

ipcMain.on('run-script', (event, scriptId, scriptCode) => {
  if (sandboxes[scriptId]) {
    sandboxes[scriptId].destroy();
  }
  let sb = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'sandbox-preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  });
  sandboxes[scriptId] = sb;
  
  sb.loadURL('about:blank').then(() => {
    sb.webContents.executeJavaScript(`window.__SCRIPT_ID__ = "${scriptId}";\n${scriptCode}`)
      .then(() => event.reply('sandbox-event', scriptId, 'log', '✅ 脚本沙盒注入成功'))
      .catch(err => event.reply('sandbox-event', scriptId, 'log', `❌ 注入失败: ${err.message}`));
  });
});

ipcMain.on('destroy-script', (event, scriptId) => {
  if (sandboxes[scriptId]) {
    sandboxes[scriptId].destroy();
    delete sandboxes[scriptId];
  }
});

ipcMain.on('sandbox-event', (event, type, data) => {
  let scriptId = null;
  for (let id in sandboxes) {
    if (sandboxes[id].webContents === event.sender) {
      scriptId = id; break;
    }
  }
  if (scriptId && mainWindow) {
    mainWindow.webContents.send('sandbox-event', scriptId, type, data);
  }
});

ipcMain.on('test-request', (event, scriptId, reqId, requestData) => {
  if (sandboxes[scriptId]) {
    sandboxes[scriptId].webContents.send('trigger-request', reqId, requestData);
  } else {
    mainWindow.webContents.send('sandbox-event', scriptId, 'error', { reqId, msg: '找不到对应的脚本沙盒' });
  }
});