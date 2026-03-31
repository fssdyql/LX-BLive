const { contextBridge, ipcRenderer } = require('electron');
const needle = require('needle');
const zlib = require('zlib');
const { createCipheriv, publicEncrypt, constants, randomBytes, createHash } = require('crypto');

const events = { request: null };

contextBridge.exposeInMainWorld('lx', {
  EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
  request(url, { method = 'get', timeout, headers, body, form, formData }, callback) {
    let options = { 
      headers: { ...headers, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36' },
      response_timeout: timeout || 60000 
    };
    let data = body || form || formData;
    if (form || formData) options.json = false;

    needle.request(method, url, data, options, (err, resp) => {
      if (err) {
        callback.call(this, err, null, null);
      } else {
        let rawBody = resp.raw.toString();
        let formattedBody;
        try { formattedBody = JSON.parse(rawBody); } catch (_) { formattedBody = rawBody; }
        callback.call(this, null, {
          statusCode: resp.statusCode,
          headers: resp.headers,
          body: formattedBody,
        }, formattedBody);
      }
    });
    return () => {};
  },
  send(eventName, data) {
    ipcRenderer.send('sandbox-event', eventName, data);
    return Promise.resolve();
  },
  on(eventName, handler) {
    if (eventName === 'request') events.request = handler;
    return Promise.resolve();
  },
  utils: {
    crypto: {
      aesEncrypt: (buf, mode, key, iv) => {
        const cipher = createCipheriv(mode, key, iv);
        return Buffer.concat([cipher.update(buf), cipher.final()]);
      },
      rsaEncrypt: (buf, key) => {
        const b = Buffer.concat([Buffer.alloc(128 - buf.length), buf]);
        return publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, b);
      },
      randomBytes: (size) => randomBytes(size),
      md5: (str) => createHash('md5').update(str).digest('hex'),
    },
    buffer: {
      from: (...args) => Buffer.from(...args),
      bufToString: (buf, f) => Buffer.from(buf, 'binary').toString(f),
    },
    zlib: {
      inflate: (buf) => new Promise((res, rej) => zlib.inflate(buf, (e, d) => e ? rej(e) : res(d))),
      deflate: (d) => new Promise((res, rej) => zlib.deflate(d, (e, b) => e ? rej(e) : res(b))),
    }
  },
  currentScriptInfo: { name: 'Auto-Tester', version: '2.0.0' },
  version: '2.0.0',
  env: 'desktop'
});

ipcRenderer.on('trigger-request', async (event, reqId, data) => {
  if (!events.request) {
    ipcRenderer.send('sandbox-event', 'error', { reqId, msg: '脚本未注册请求处理程序' });
    return;
  }
  try {
    const response = await events.request(data);
    ipcRenderer.send('sandbox-event', 'response', { reqId, response });
  } catch (err) {
    ipcRenderer.send('sandbox-event', 'error', { reqId, msg: err.message || err });
  }
});