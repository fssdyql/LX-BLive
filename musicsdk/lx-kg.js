const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');

// ---------------------------------------------------------
// 1. 数据清洗与格式化工具 (标准化输出格式)
// ---------------------------------------------------------
const formatters = {
    formatPlayTime(duration) {
        const d = parseInt(duration);
        if (isNaN(d)) return "00:00";
        const m = Math.floor(d / 60).toString().padStart(2, '0');
        const s = (d % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    },
    
    sizeFormate(sizeBytes) {
        if (!sizeBytes || sizeBytes == 0) return '0.00 MB';
        return (sizeBytes / (1024 * 1024)).toFixed(2) + ' MB';
    },

    parsePlaylistItem(item) {
        return {
            name: item.specialname || item.name,
            author: item.nickname || item.username,
            id: item.specialid,
            img: item.imgurl ? item.imgurl.replace('{size}', '480') : item.img,
            count: item.songcount || item.count,
            pubTime: item.publishtime,
            desc: item.intro,
            source: 'kg'
        };
    },

    parseSongItem(item) {
        if (!item) return null;
        
        const name = item.SongName || item.songname || '';
        
        let singer = '';
        if (Array.isArray(item.Singers)) {
            singer = item.Singers.map(s => s.name).join('、');
        } else if (item.authors && Array.isArray(item.authors)) {
            singer = item.authors.map(s => s.author_name).join('、');
        } else {
            singer = item.author_name || item.singername || '';
        }

        const songmid = item.Audioid || item.audio_id || (item.audio_info && item.audio_info.audio_id) || '';
        // 毫秒转秒处理
        let duration = item.Duration || item.duration || 0;
        if (item.audio_info && item.audio_info.timelength) duration = item.audio_info.timelength / 1000;
        
        const albumName = item.AlbumName || (item.album_info && item.album_info.album_name) || item.remark || '';
        const albumId = item.AlbumID || item.album_id || (item.album_info && item.album_info.album_id) || '';
        const hash = item.FileHash || item.hash || (item.audio_info && item.audio_info.hash) || '';
        const img = (item.Image || (item.album_info && item.album_info.sizable_cover) || '').replace('{size}', '480');

        const types =[];
        const _types = {};

// 在 lx-kg.js 的 formatters.parseSongItem 内部
const addType = (quality, sizeBytes, fileHash) => {
    // 必须有有效的 hash 才能添加
    if (!fileHash || fileHash === '00000000000000000000000000000000') return;
    const sizeStr = formatters.sizeFormate(sizeBytes);
    types.push({ type: quality, size: sizeStr, hash: fileHash });
    _types[quality] = { size: sizeStr, hash: fileHash };
};

// 这里的 item['320hash'] 等字段必须从原始 search 结果中对应
addType('128k', item.FileSize || item.filesize, item.FileHash || item.hash);
addType('320k', item.HQFileSize || item['320filesize'], item.HQFileHash || item['320hash']);
addType('flac', item.SQFileSize || item.sqfilesize, item.SQFileHash || item.sqhash);

        return {
            name, singer, source: 'kg', songmid,
            interval: formatters.formatPlayTime(duration),
            albumName, img, typeUrl: {}, albumId: String(albumId),
            types, _types, hash
        };
    }
};

// ---------------------------------------------------------
// 2. 酷狗协议层核心 API
// ---------------------------------------------------------
class KgApi {
    constructor() {
        this.userAgentPC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36';
    }

    // 优化的请求方法
    async _request(url, options = {}) {
        const headers = { 
            'User-Agent': this.userAgentPC,
            'Referer': 'https://www.kugou.com/',
            ...options.headers 
        };
        try {
            // 使用原生 fetch (Node 18+) 或确保已安装 node-fetch
            const res = await fetch(url, { ...options, headers });
            const rawData = await res.json();
            return { request: { url }, raw: rawData };
        } catch (error) {
            console.error("KG Request Error:", error);
            return { error: error.message };
        }
    }

    // 更新搜索接口地址和参数
    async search(keyword, page = 1, limit = 20) {
        // 使用更稳定的接口
        const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&tag=em&filter=2&isnew=1`;
        
        const res = await this._request(url);
        
        if (res.raw && res.raw.data && res.raw.data.lists) {
            // 关键：将原始数据清洗为 UI 认识的格式
            res.parsed = res.raw.data.lists.map(item => formatters.parseSongItem(item));
        } else {
            res.parsed = [];
        }
        return res;
    }

    // --- GCID 解码 ---
    async decodeGcid(gcid) {
        const params = 'appid=1005&clienttime=640612895&clientver=20109&dfid=-&mid=0&uuid=-';
        const bodyObj = { ret_info: 1, data:[{ id: gcid, id_type: 2 }] };
        const bodyStr = JSON.stringify(bodyObj);
        const signature = this._signature(params, bodyStr, 'android');
        const url = `https://t.kugou.com/v1/songlist/batch_decode?${params}&signature=${signature}`;
        
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/83.0.4103.106 Mobile Safari/537.36', 'Content-Type': 'application/json' },
            body: bodyStr
        });
        const data = await res.json();
        return data.data?.list?.[0]?.global_collection_id || null;
    }

    // --- 通过 GlobalCollectionId 获取歌单及全音质歌曲 ---
    async getPlaylistByGlobalId(globalId) {
        // 1. 获取歌单基础信息
        const pInfo = `appid=1058&clienttime=1586163242519&clientver=20000&dfid=-&format=jsonp&global_specialid=${globalId}&mid=1586163242519&specialid=0&srcappid=2919&uuid=1586163242519`;
        const sigInfo = this._signature(pInfo, '', 'web');
        const infoUrl = `https://mobiles.kugou.com/api/v5/special/info_v2?${pInfo}&signature=${sigInfo}`;
        const infoRes = await (await fetch(infoUrl, { headers: { 'User-Agent': this.userAgentMobile } })).json();
        
        // 2. 获取歌单内的基础歌曲哈希
        const pSong = `appid=1058&clienttime=1586163263991&clientver=20000&dfid=-&global_specialid=${globalId}&mid=1586163263991&page=1&pagesize=300&plat=0&specialid=0&srcappid=2919&uuid=1586163263991&version=8000`;
        const sigSong = this._signature(pSong, '', 'web');
        const songUrl = `https://mobiles.kugou.com/api/v5/special/song_v2?${pSong}&signature=${sigSong}`;
        const songRes = await (await fetch(songUrl, { headers: { 'User-Agent': this.userAgentMobile } })).json();
        
        // 3. 提取 Hash 去批量查询完整音质信息
        const hashes = songRes.data?.info?.map(s => s.hash) ||[];
        const detailedSongs = await this.getMusicInfos(hashes);

        return {
            request: { infoUrl, songUrl },
            raw: { info: infoRes, songs: songRes },
            parsed: {
                info: {
                    name: infoRes.data?.specialname,
                    img: infoRes.data?.imgurl?.replace('{size}', '480'),
                    desc: infoRes.data?.intro,
                    author: infoRes.data?.nickname
                },
                songs: detailedSongs.map(formatters.parseSongItem).filter(s => s) // 清洗并去除空项
            }
        };
    }

    // --- 歌单/分享链接终极解析器 ---
    async importPlaylist(link) {
        // 1. 匹配 gcid
        const gcidMatch = link.match(/gcid_(\w+)/);
        if (gcidMatch) {
            const globalId = await this.decodeGcid(gcidMatch[1]);
            if (globalId) return await this.getPlaylistByGlobalId(globalId);
        }

        // 2. 匹配 global_collection_id
        const globalMatch = link.match(/global_collection_id=(\w+)/);
        if (globalMatch) return await this.getPlaylistByGlobalId(globalMatch[1]);

        // 3. 匹配普通网页版
        const specialMatch = link.match(/special\/single\/(\d+)\.html/);
        if (specialMatch) {
            const fetchRes = await fetch(link);
            const text = await fetchRes.text();
            const rawMatch = text.match(/global\.data = (\[.+\]);/);
            const rawSongs = rawMatch ? JSON.parse(rawMatch[1]) :[];
            // 将普通网页的基础歌曲也转换一下全音质
            const hashes = rawSongs.map(s => s.Hash || s.hash).filter(h => h);
            const detailedSongs = await this.getMusicInfos(hashes);
            return {
                request: { url: link },
                raw: { rawSongs },
                parsed: { songs: detailedSongs.map(formatters.parseSongItem) }
            };
        }

        // 4. 处理短链/Chain链跳转
        try {
            const res = await fetch(link, { redirect: 'follow', headers: { 'User-Agent': this.userAgentMobile } });
            const finalUrl = res.url;
            if (finalUrl !== link) return this.importPlaylist(finalUrl); // 发生重定向，递归处理
            
            const html = await res.text();
            // 尝试从网页 Meta 中挖取隐藏的 ID
            const match = html.match(/"global_collection_id":"(\w+)"/) || html.match(/"encode_gic":"(\w+)"/) || html.match(/"encode_src_gid":"(\w+)"/);
            if (match) {
                let id = match[1];
                if (html.includes("encode_gic") || html.includes("encode_src_gid")) {
                    id = await this.decodeGcid(id); // 需要解码
                }
                if (id) return await this.getPlaylistByGlobalId(id);
            }
        } catch(e) { }

        return { raw: { error: "无法识别或解析该分享链接，可能是VIP专享或格式已变更", link } };
    }

    // --- 其他常规接口全部继承 ---
    async search(keyword, page = 1, limit = 20) {
        const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&platform=WebFilter`;
        const res = await this._request(url);
        if (res.raw?.data?.lists) res.parsed = res.raw.data.lists.map(formatters.parseSongItem);
        return res;
    }

    async searchPlaylist(keyword, page = 1, limit = 20) {
        const url = `http://msearchretry.kugou.com/api/v3/search/special?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&showtype=10&filter=0&version=7910&sver=2`;
        const res = await this._request(url);
        if (res.raw?.data?.info) res.parsed = res.raw.data.info.map(formatters.parsePlaylistItem);
        return res;
    }

    async getComments(hash, type = 'newest', page = 1, limit = 20) {
        const infoUrl = 'http://gateway.kugou.com/v3/album_audio/audio';
        const infoBody = { data: [{ hash }], appid: 1005, clientver: 11451, mid: "1", clienttime: Date.now(), key: "OIlwieks28dk2k092lksi2UIkp" };
        const infoData = await (await fetch(infoUrl, { method: 'POST', body: JSON.stringify(infoBody), headers: {'KG-RC': '1', 'x-router': 'kmr.service.kugou.com'} })).json();
        const resId = infoData.data?.[0]?.[0]?.classification?.[0]?.res_id || 0;

        const timestamp = Date.now();
        const params = `appid=1005&clienttime=${timestamp}&clienttoken=0&clientver=11409&code=fc4be23b4e972707f36b8a828a93ba8a&dfid=0&extdata=${hash}&kugouid=0&mid=16249512204336365674023395779019&mixsongid=${type === 'newest' ? resId : 0}&p=${page}&pagesize=${limit}&uuid=0&ver=10`;
        const signature = this._signature(params);
        const path = type === 'newest' ? 'r/v1/rank/newest' : 'v1/weightlist';
        const url = `http://m.comment.service.kugou.com/${path}?${params}&signature=${signature}`;
        
        const res = await this._request(url);
        if (res.raw?.list) {
            res.parsed = res.raw.list.map(c => ({
                userName: c.user_name, content: c.content, liked: c.like?.likenum, time: c.addtime
            }));
        }
        return res;
    }

    async getLyric(keyword, hash, timeLength) {
        const searchUrl = `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(keyword)}&hash=${hash}&timelength=${timeLength}`;
        const searchResult = await this._request(searchUrl);
        if (searchResult.raw?.candidates?.length > 0) {
            const lrcInfo = searchResult.raw.candidates[0];
            const dlUrl = `http://lyrics.kugou.com/download?ver=1&client=pc&id=${lrcInfo.id}&accesskey=${lrcInfo.accesskey}&fmt=lrc&charset=utf8`;
            const dlResult = await this._request(dlUrl);
            let decodedLyrics = dlResult.raw?.content ? Buffer.from(dlResult.raw.content, 'base64').toString('utf8') : '';
            return {
                request: { searchReq: searchResult.request, dlReq: dlResult.request },
                raw: { searchRaw: searchResult.raw, dlRaw: dlResult.raw },
                parsed: { lyric: decodedLyrics }
            };
        }
        return searchResult;
    }

    async getLeaderboards() { return await this._request('http://mobilecdnbj.kugou.com/api/v5/rank/list?version=9108&plat=0&showtype=2&parentid=0&apiver=6&area_code=1&withsong=1'); }
    async getLeaderboardDetail(bangid, page = 1, limit = 100) {
        const res = await this._request(`http://mobilecdnbj.kugou.com/api/v3/rank/song?version=9108&ranktype=1&plat=0&pagesize=${limit}&page=${page}&rankid=${bangid}`);
        if (res.raw?.data?.info) {
            const hashes = res.raw.data.info.map(s => s.hash);
            const detailedSongs = await this.getMusicInfos(hashes);
            res.parsed = detailedSongs.map(formatters.parseSongItem);
        }
        return res;
    }
    async getSingerInfo(singerId) { return await this._request(`http://mobiles.kugou.com/api/v5/singer/info?singerid=${singerId}`); }
    async getAlbumDetail(albumId, page = 1, limit = 100) {
        const res = await this._request(`http://mobiles.kugou.com/api/v3/album/song?version=9108&albumid=${albumId}&plat=0&pagesize=${limit}&page=${page}`);
        if (res.raw?.data?.info) res.parsed = res.raw.data.info.map(formatters.parseSongItem);
        return res;
    }
    async tipSearch(keyword) {
        const res = await this._request(`https://searchtip.kugou.com/getSearchTip?MusicTipCount=10&keyword=${encodeURIComponent(keyword)}`, { headers: { referer: 'https://www.kugou.com/' } });
        if (Array.isArray(res.raw) && res.raw.length > 0) res.parsed = res.raw[0].RecordDatas.map(r => r.HintInfo);
        return res;
    }
    async getHotSearch() {
        const res = await this._request('http://gateway.kugou.com/api/v3/search/hot_tab?signature=ee44edb9d7155821412d220bcaf509dd&appid=1005&plat=0', { headers: { 'kg-rc': '1', 'x-router': 'msearch.kugou.com' } });
        if (res.raw?.data?.list) res.parsed = res.raw.data.list.flatMap(item => item.keywords.map(k => k.keyword));
        return res;
    }
}

// ---------------------------------------------------------
// 3. Electron IPC 桥接
// ---------------------------------------------------------
const api = new KgApi();
ipcMain.handle('kg-api-call', async (event, { method, args }) => {
    try { 
        return await api[method](...args); 
    } catch (e) { 
        console.error("IPC Error:", e);
        return { error: e.message }; 
    }
});