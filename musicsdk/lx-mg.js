const { ipcMain } = require('electron'); // 仅保留 ipcMain，删掉 app 和 BrowserWindow
const path = require('path');
const crypto = require('crypto');

class MiguAPI {
    constructor() {
        this.defaultHeaders = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
            'Referer': 'https://m.music.migu.cn/',
            'channel': '0146921'
        };
        this.pcHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
            'Referer': 'https://music.migu.cn/v3',
            'Accept': 'application/json, text/javascript, */*; q=0.01'
        };
    }

    async doFetch(url, options = {}) {
        const reqOptions = { headers: this.defaultHeaders, ...options };
        try {
            const response = await fetch(url, reqOptions);
            const text = await response.text();
            let raw;
            try { raw = JSON.parse(text); } catch (e) { raw = text; }
            return { request: { url, ...reqOptions }, raw, parsed: null };
        } catch (error) {
            throw new Error(`Fetch failed: ${error.message}`);
        }
    }

    md5(str) {
        return crypto.createHash('md5').update(str).digest('hex');
    }

    createSignature(time, str) {
        const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
        const signatureMd5 = '6cdc72a439cef99a3418d2a78aa28c73';
        const sign = this.md5(`${str}${signatureMd5}yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${time}`);
        return { sign, deviceId };
    }

    // 1. 歌曲搜索 - 调整格式适配演示.txt
    async search(text, page = 1, limit = 20) {
        const time = Date.now().toString();
        const { sign, deviceId } = this.createSignature(time, text);
        const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(text)}&pageNo=${page}&sort=0&sid=USS`;
        
        const res = await this.doFetch(url, {
            headers: {
                uiVersion: 'A_music_3.6.1', deviceId, timestamp: time, sign, channel: '0146921',
                'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30'
            }
        });

        if (res.raw && res.raw.songResultData && res.raw.songResultData.resultList) {
            res.parsed = res.raw.songResultData.resultList.flat().map(data => ({
                name: data.name,
                singer: data.singerList ? data.singerList.map(s => s.name).join('、') : '未知歌手',
                source: 'mg',
                songmid: data.songId,             // 短ID
                copyrightId: data.copyrightId,    // 长ID (脚本解析必用)
                interval: data.duration || '00:00',
                albumName: data.album,
                albumId: data.albumId,
                img: data.img3 || data.img2 || data.img1,
                // 补全演示.txt要求的空结构，防止渲染报错
                types: [
                    { type: '128k', size: '0 B' },
                    { type: '320k', size: '0 B' },
                    { type: 'flac', size: '0 B' }
                ],
                _types: {
                    "128k": { size: "0 B" },
                    "320k": { size: "0 B" },
                    "flac": { size: "0 B" }
                }
            }));
        }
        return res;
    }

    // --- 以下功能保留，仅供内部或未来扩展使用 ---

    async tipSearch(text) {
        const url = `https://music.migu.cn/v3/api/search/suggest?keyword=${encodeURIComponent(text)}`;
        const res = await this.doFetch(url, { headers: this.pcHeaders });
        if (res.raw && res.raw.songs) {
            res.parsed = res.raw.songs.map(info => `${info.name} - ${info.singerName}`);
        }
        return res;
    }

    async getHotSearch() {
        const url = 'http://jadeite.migu.cn:7090/music_search/v3/search/hotword';
        const res = await this.doFetch(url);
        if (res.raw && res.raw.data && res.raw.data.hotwords) {
            res.parsed = res.raw.data.hotwords[0].hotwordList
                .filter(item => item.resourceType === 'song')
                .map(item => item.word);
        }
        return res;
    }

    async importPlaylist(urlOrId) {
        // ... (保持原有的导入歌单代码不变)
        return await this.doFetch(urlOrId); // 简化示例
    }

    async getLyric(copyrightId) {
        // ... (保持原有的歌词解密代码不变)
    }
}

// 实例化 API
const mgApi = new MiguAPI();

// ！！关键修改：只保留路由处理，删掉 app.whenReady ！！
ipcMain.handle('mg-api', async (event, method, ...args) => {
    try {
        if (typeof mgApi[method] === 'function') {
            return await mgApi[method](...args);
        }
        throw new Error(`Method ${method} not found`);
    } catch (error) {
        return { error: error.message, stack: error.stack };
    }
});

// 导出模块（可选，方便 main.js 引用）
module.exports = mgApi;