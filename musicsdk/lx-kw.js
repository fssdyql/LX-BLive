const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');

// ==========================================
// 核心工具与加解密模块 (替代原 util.js 等)
// ==========================================
const decodeName = (str) => {
    if (!str) return '';
    return str.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
};

const wbdCrypto = {
    aesMode: 'aes-128-ecb',
    aesKey: Buffer.from([112, 87, 39, 61, 199, 250, 41, 191, 57, 68, 45, 114, 221, 94, 140, 228], 'binary'),
    appId: 'y67sprxhhpws',
    decodeData(base64Result) {
        const data = Buffer.from(decodeURIComponent(base64Result), 'base64');
        const decipher = crypto.createDecipheriv(this.aesMode, this.aesKey, '');
        let dec = decipher.update(data, undefined, 'utf8');
        dec += decipher.final('utf8');
        return JSON.parse(dec);
    },
    buildParam(jsonData) {
        const data = Buffer.from(JSON.stringify(jsonData));
        const time = Date.now();
        const cipher = crypto.createCipheriv(this.aesMode, this.aesKey, '');
        let enc = cipher.update(data);
        enc = Buffer.concat([enc, cipher.final()]).toString('base64');
        const signStr = `${this.appId}${enc}${time}`;
        const sign = crypto.createHash('md5').update(signStr).digest('hex').toUpperCase();
        return `data=${encodeURIComponent(enc)}&time=${time}&appId=${this.appId}&sign=${sign}`;
    }
};

const buildLyricParams = (id, isGetLyricx = true) => {
    const buf_key = Buffer.from('yeelion');
    let params = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${id}`;
    if (isGetLyricx) params += '&lrcx=1';
    const buf_str = Buffer.from(params);
    const output = new Uint16Array(buf_str.length);
    let i = 0;
    while (i < buf_str.length) {
        let j = 0;
        while (j < buf_key.length && i < buf_str.length) {
            output[i] = buf_key[j] ^ buf_str[i];
            i++; j++;
        }
    }
    return Buffer.from(output).toString('base64');
};

// 核心网络请求封装：捕获并返回给前端完整的请求信息与原始数据
async function myFetch(url, options = {}) {
    options.headers = options.headers || {};
    options.headers['User-Agent'] = options.headers['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36';
    
    const res = await fetch(url, options);
    const buffer = await res.arrayBuffer();
    const bodyStr = new TextDecoder('utf-8').decode(buffer);
    
    let bodyJson = bodyStr;
    try { 
        // 尝试解析 JSON，部分接口返回不标准JSON需修复
        bodyJson = JSON.parse(bodyStr.replace(/('(?=(,\s*')))|('(?=:))|((?<=([:,]\s*))')|((?<={)')|('(?=}))/g, '"')); 
    } catch (e) {}

    return {
        request: { url, method: options.method || 'GET', headers: options.headers },
        raw: bodyJson,
        statusCode: res.status,
        bufferStr: bodyStr
    };
}

// ==========================================
// 业务 API 模块集成
// ==========================================
const kwAPI = {
    // 1. 歌曲搜索
    async search(keyword, page = 1, limit = 30) {
        const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
        const res = await myFetch(url);
        const parsed = (res.raw.abslist ||[]).map(item => ({
            songmid: item.MUSICRID.replace('MUSIC_', ''),
            name: decodeName(item.SONGNAME),
            singer: decodeName(item.ARTIST),
            album: decodeName(item.ALBUM),
            interval: item.DURATION,
            formats: item.FORMATS
        }));
        return { parsed, request: res.request, raw: res.raw };
    },
    // 1. 热搜
    async getHotSearch() {
        const url = `http://hotword.kuwo.cn/hotword.s?prod=kwplayer_ar_9.3.0.1&corp=kuwo&newver=2&vipver=9.3.0.1&source=kwplayer_ar_9.3.0.1_40.apk&p2p=1&notrace=0&uid=0&plat=kwplayer_ar&rformat=json&encoding=utf8&tabid=1`;
        const res = await myFetch(url, { headers: { 'User-Agent': 'Dalvik/2.1.0' } });
        const parsed = (res.raw.tagvalue ||[]).map(item => item.key);
        return { parsed, request: res.request, raw: res.raw };
    },
    // 1. 搜索联想提示
    async tipSearch(keyword) {
        const url = `https://tips.kuwo.cn/t.s?corp=kuwo&newver=3&p2p=1&notrace=0&c=mbox&w=${encodeURIComponent(keyword)}&encoding=utf8&rformat=json`;
        const res = await myFetch(url, { headers: { Referer: 'http://www.kuwo.cn/' } });
        const parsed = (res.raw.WORDITEMS ||[]).map(item => item.RELWORD);
        return { parsed, request: res.request, raw: res.raw };
    },
    // 2. 歌单解析导入
    async importPlaylist(link) {
        let id = link;
        const match = link.match(/\/playlist(?:_detail)?\/(\d+)/);
        if (match) id = match[1]; // 提取出真实的 ID
        
        const url = `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=0&rn=100&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`;
        const res = await myFetch(url);
        const parsed = {
            title: res.raw.title,
            cover: res.raw.pic,
            author: res.raw.uname,
            songs: (res.raw.musiclist ||[]).map(item => ({
                songmid: item.id,
                name: decodeName(item.name),
                singer: decodeName(item.artist)
            }))
        };
        return { parsed, request: res.request, raw: res.raw };
    },
    // 2. 歌单搜索
    async searchPlaylist(keyword, page = 1, limit = 20) {
        const url = `http://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${limit}&rformat=json&encoding=utf8&ver=mbox&vipver=MUSIC_8.7.7.0_BCS37&plat=pc&devid=28156413&ft=playlist&pay=0&needliveshow=0`;
        const res = await myFetch(url);
        const parsed = (res.raw.abslist ||[]).map(item => ({
            id: item.playlistid,
            name: decodeName(item.name),
            author: decodeName(item.nickname),
            playcnt: item.playcnt,
            songnum: item.songnum
        }));
        return { parsed, request: res.request, raw: res.raw };
    },
    // 3. 获取所有榜单
    async getLeaderboards() {
        const url = `http://qukudata.kuwo.cn/q.k?op=query&cont=tree&node=2&pn=0&rn=1000&fmt=json&level=2`;
        const res = await myFetch(url);
        const parsed = (res.raw.child ||[]).filter(b => b.source == '1').map(b => ({
            id: b.sourceid,
            name: b.name
        }));
        return { parsed, request: res.request, raw: res.raw };
    },
    // 3. 榜单详情 (包含逆向的 wbd 加密)
    async getLeaderboardDetail(id, page = 1) {
        const reqBody = { uid: '', devId: '', sFrom: 'kuwo_sdk', user_type: 'AP', carSource: 'kwplayercar_ar_6.0.1.0_apk_keluze.apk', id: String(id), pn: page - 1, rn: 100 };
        const url = `https://wbd.kuwo.cn/api/bd/bang/bang_info?${wbdCrypto.buildParam(reqBody)}`;
        const res = await myFetch(url);
        
        let parsed = null;
        let rawDecoded = null;
        if (res.raw && res.raw.data) {
            try {
                rawDecoded = wbdCrypto.decodeData(res.raw.data);
                parsed = (rawDecoded.data.musiclist ||[]).map(item => ({
                    songmid: item.id,
                    name: decodeName(item.name),
                    singer: decodeName(item.artist),
                    minfo: item.n_minfo
                }));
            } catch (e) { parsed = { error: 'AES Decrypt failed', detail: e.message }; }
        }
        return { parsed, request: res.request, raw: rawDecoded || res.raw };
    },
    // 3. 专辑搜索/详情
    async getAlbumDetail(id, page = 1) {
        const url = `http://search.kuwo.cn/r.s?pn=${page - 1}&rn=1000&stype=albuminfo&albumid=${id}&show_copyright_off=0&encoding=utf&vipver=MUSIC_9.1.0`;
        const res = await myFetch(url);
        const parsed = {
            albumName: decodeName(res.raw.name),
            author: decodeName(res.raw.artist),
            info: decodeName(res.raw.info),
            songs: (res.raw.musiclist ||[]).map(item => ({
                songmid: item.id,
                name: decodeName(item.name),
                singer: decodeName(item.artist)
            }))
        };
        return { parsed, request: res.request, raw: res.raw };
    },
    // 4. 评论获取
    async getComments(songmid, type = 'newest', page = 1, limit = 20) {
        const targetType = type === 'hottest' ? 'get_rec_comment' : 'get_comment';
        const url = `http://ncomment.kuwo.cn/com.s?f=web&type=${targetType}&aapiver=1&prod=kwplayer_ar_10.5.2.0&digest=15&sid=${songmid}&start=${limit * (page - 1)}&msgflag=1&count=${limit}&newver=3&uid=0`;
        const res = await myFetch(url, { headers: { 'User-Agent': 'Dalvik/2.1.0' } });
        const commentList = type === 'hottest' ? res.raw.hot_comments : res.raw.comments;
        const parsed = (commentList ||[]).map(item => ({
            id: item.id,
            user: item.u_name,
            content: item.msg,
            like_num: item.like_num,
            time: new Date(item.time * 1000).toLocaleString()
        }));
        return { parsed, request: res.request, raw: res.raw };
    },
    // 4. 歌词获取与解码 (含 Base64 异或解密)
    async getLyric(songmid) {
        const paramStr = buildLyricParams(songmid);
        const url = `http://newlyric.kuwo.cn/newlyric.lrc?${paramStr}`;
        const res = await myFetch(url);
        
        let parsed = { lyricStr: "解析失败" };
        try {
            // 响应体就是原始的base64，或者是在buffer里
            const base64Data = res.bufferStr.trim();
            // 在Node环境下，我们尝试将这个base64再次进行解析或解压（原生SDK使用了zlib解压缩或者直接toString）
            // 如果是以 base64 传输，直接解码：
            const decoded = Buffer.from(base64Data, 'base64').toString('utf8');
            parsed = { lyricStr: decoded.substring(0, 500) + '... (省略显示)' }; // 防止过长
        } catch (e) {}

        return { parsed, request: res.request, raw: { base64Response: res.bufferStr } };
    }
};

// ==========================================
// IPC Main 注册与窗口初始化
// ==========================================
ipcMain.handle('kw-api-call', async (event, method, ...args) => {
    try {
        if (kwAPI[method]) {
            return await kwAPI[method](...args);
        } else {
            throw new Error(`Method ${method} not found in kwAPI.`);
        }
    } catch (error) {
        return { 
            parsed: null, 
            request: { method, args }, 
            raw: { error: error.message, stack: error.stack } 
        };
    }
});
