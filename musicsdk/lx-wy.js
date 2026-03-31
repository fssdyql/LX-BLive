const { app, BrowserWindow, ipcMain } = require('electron');
const crypto = require('crypto');

// ==========================================
// 1. 加密核心 (保持不变)
// ==========================================
const iv = Buffer.from('0102030405060708');
const presetKey = Buffer.from('0CoJUm6Qyw8W8jud');
const linuxapiKey = Buffer.from('rFgB&h#%2?^eDg:Q');
const base62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const publicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----';
const eapiKey = 'e82ckenh8dichen8';

const aesEncrypt = (buffer, mode, key, iv) => {
    const cipher = crypto.createCipheriv(mode, key, iv);
    return Buffer.concat([cipher.update(buffer), cipher.final()]);
};
const rsaEncrypt = (buffer, key) => {
    buffer = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer]);
    return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, buffer);
};

const CryptoApi = {
    weapi(object) {
        const text = JSON.stringify(object);
        const secretKey = crypto.randomBytes(16).map(n => base62.charAt(n % 62).charCodeAt());
        return {
            params: aesEncrypt(Buffer.from(aesEncrypt(Buffer.from(text), 'aes-128-cbc', presetKey, iv).toString('base64')), 'aes-128-cbc', secretKey, iv).toString('base64'),
            encSecKey: rsaEncrypt(secretKey.reverse(), publicKey).toString('hex'),
        };
    },
    eapi(url, object) {
        const text = typeof object === 'object' ? JSON.stringify(object) : object;
        const message = `nobody${url}use${text}md5forencrypt`;
        const digest = crypto.createHash('md5').update(message).digest('hex');
        const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
        return { params: aesEncrypt(Buffer.from(data), 'aes-128-ecb', eapiKey, '').toString('hex').toUpperCase() };
    }
};

async function fetchWyAPI(urlPath, data, type = 'weapi', explicitPostUrl = null) {
    const baseUrl = type === 'eapi' ? 'https://interface3.music.163.com' : 'https://music.163.com';
    let url = explicitPostUrl || (type === 'eapi' ? urlPath.replace(/^\/api\//, '/eapi/') : urlPath);
    if (!url.startsWith('http')) url = baseUrl + url;

    let formObj = type === 'weapi' ? CryptoApi.weapi(data) : CryptoApi.eapi(urlPath, data);
    const body = new URLSearchParams(formObj).toString();

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': 'os=pc; osver=Microsoft-Windows-10-Home-China-build-19043-64bit; appver=2.9.7; channel=netease;'
        },
        body
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    let rawJson;
    try {
        rawJson = JSON.parse(buffer.toString('utf8'));
    } catch (e) {
        const decipher = crypto.createDecipheriv('aes-128-ecb', eapiKey, '');
        rawJson = JSON.parse(Buffer.concat([decipher.update(buffer), decipher.final()]).toString());
    }
    return { raw: rawJson };
}

// ==========================================
// 2. 业务功能 (修复了语法错误和动态音质)
// ==========================================
const WyService = {
    async search(keyword, page = 1, limit = 20) {
        const res = await fetchWyAPI('/api/search/song/list/page', { 
            keyword, needCorrect: '1', channel: 'typing', 
            offset: limit * (page - 1), scene: 'normal', limit 
        }, 'eapi', '/eapi/search/song/list/page');

        const list = (res.raw?.data?.resources || []).map(r => {
            const s = r.baseInfo?.simpleSongData;
            const privilege = r.privilege; // 动态权限
            if (!s) return null;

            // 动态解析该歌曲支持的音质，绝不写死
            const types = [];
            const _types = {};
            if (privilege) {
                // 网易云音质映射：128000(标准), 320000(高), 999000(无损)
                if (privilege.maxbr >= 128000) {
                    types.push({ type: '128k', size: '3.1MB' });
                    _types['128k'] = { size: '3.1MB' };
                }
                if (privilege.maxbr >= 320000) {
                    types.push({ type: '320k', size: '8.2MB' });
                    _types['320k'] = { size: '8.2MB' };
                }
                if (privilege.maxbr >= 999000 || privilege.fl > 0) {
                    types.push({ type: 'flac', size: '25MB' });
                    _types['flac'] = { size: '25MB' };
                }
            }

            return {
                name: s.name,
                singer: (s.ar || []).map(a => a.name).join('、'),
                source: 'wy',
                songmid: s.id, 
                interval: "00:00", 
                albumName: s.al?.name || '',
                img: s.al?.picUrl || '',
                albumId: s.al?.id,
                types,
                _types
            };
        }).filter(i => i);

        return { parsed: { list }, ...res };
    }, // <--- 注意这个逗号，之前报错大概率是漏了它

    async tipSearch(keyword) {
        const res = await fetchWyAPI('/weapi/search/suggest/web', { s: keyword }, 'weapi');
        const list = (res.raw?.result?.songs || []).map(s => `${s.name} - ${s.artists[0].name}`);
        return { parsed: list, ...res };
    },

    async getLyric(songmid) {
        const res = await fetchWyAPI('/api/song/lyric/v1', { id: songmid }, 'eapi', '/eapi/song/lyric/v1');
        return { parsed: { lyric: res.raw?.lrc?.lyric }, ...res };
    }
};

// ==========================================
// 3. 通信桥接
// ==========================================
ipcMain.handle('wy-api-call', async (event, method, ...args) => {
    try {
        return await WyService[method](...args);
    } catch (err) {
        return { error: err.message };
    }
});