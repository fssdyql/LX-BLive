const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');

// =======================
// TX API 核心解析集成模块
// =======================

// 1. 签名算法集成 (zzcSign)
const PART_1_INDEXES =[23, 14, 6, 36, 16, 40, 7, 19];
const PART_2_INDEXES =[16, 1, 32, 12, 19, 27, 8, 5];
const SCRAMBLE_VALUES =[89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];

function hashSHA1(text) {
    const sha1Inst = crypto.createHash('sha1');
    sha1Inst.update(Buffer.from(text, 'utf-8'));
    return sha1Inst.digest().toString('hex').toUpperCase();
}

function zzcSign(text) {
    const hash = hashSHA1(text);
    const part1 = PART_1_INDEXES.map(idx => hash[idx]).join('');
    const part2 = PART_2_INDEXES.map(idx => hash[idx]).join('');
    const part3 = SCRAMBLE_VALUES.map((value, i) => value ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16));
    const b64Part = Buffer.from(part3).toString('base64').replace(/[\\/+=]/g, '');
    return `zzc${part1}${b64Part}${part2}`.toLowerCase();
}

// 2. HTTP 请求封装
async function httpFetch(url, options = {}) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
        ...options.headers
    };
    const fetchOptions = {
        method: options.method || 'GET',
        headers,
        redirect: 'follow'
    };
    if (options.body) {
        fetchOptions.body = typeof options.body === 'object' ? JSON.stringify(options.body) : options.body;
        if (!headers['Content-Type'] && typeof options.body === 'object') {
            headers['Content-Type'] = 'application/json';
        }
    } else if (options.form) {
        fetchOptions.body = new URLSearchParams(options.form).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const res = await fetch(url, fetchOptions);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch (e) { body = text; }
    
    return {
        statusCode: res.status,
        url: res.url, // 包含跳转后的url
        headers: Object.fromEntries(res.headers.entries()),
        body,
        requestOptions: { url, ...fetchOptions }
    };
}

// 辅助方法
const getSearchId = () => {
    const e = Math.floor(Math.random() * 20) + 1;
    const t = Number(e * Number('18014398509481984'));
    const n = Math.floor(Math.random() * 4194304) * 4294967296;
    return String(t + n + (Math.round(Date.now() * 1000) % (24 * 60 * 60 * 1000)));
};

// 3. API 服务类
class TxApi {
    // 歌曲搜索
// 歌曲搜索
    async search(str, page = 1, limit = 20) {
        // 必须携带完整的设备指纹，否则服务器会返回空数组
        const data = {
            comm: {
                ct: '11',
                cv: '14090508',
                v: '14090508',
                tmeAppID: 'qqmusic',
                phonetype: 'EBG-AN10',
                deviceScore: '553.47',
                devicelevel: '50',
                newdevicelevel: '20',
                rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
                os_ver: '12',
                OpenUDID: '0',
                OpenUDID2: '0',
                QIMEI36: '0',
                udid: '0',
                chid: '0',
                aid: '0',
                oaid: '0',
                taid: '0',
                tid: '0',
                wid: '0',
                uid: '0',
                sid: '0',
                modeSwitch: '6',
                teenMode: '0',
                ui_mode: '2',
                nettype: '1020',
                v4ip: ''
            },
            req: {
                module: 'music.search.SearchCgiService',
                method: 'DoSearchForQQMusicMobile',
                param: {
                    search_type: 0,
                    searchid: getSearchId(),
                    query: str,
                    page_num: page,
                    num_per_page: limit,
                    highlight: 0,
                    nqc_flag: 0,
                    multi_zhida: 0,
                    cat: 2,
                    grp: 1,
                    sin: 0,
                    sem: 0
                }
            }
        };
        const sign = zzcSign(JSON.stringify(data));
        const url = `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`;
        
        const res = await httpFetch(url, { 
            method: 'POST', 
            body: data,
            headers: {
                // 必须严格伪装成 QQ音乐 Android 客户端
                'User-Agent': 'QQMusic 14090508(android 12)'
            }
        });
        
        let parsedList =[];
        // 修复解析路径：原先漏了 `.body.`
        const item_song = res.body?.req?.data?.body?.item_song;
        
        if (item_song && Array.isArray(item_song)) {
            parsedList = item_song.map(item => ({
                songmid: item.mid, 
                songId: item.id,
                name: item.name + (item.title_extra ?? ''),
                singer: item.singer?.map(s => s.name).join('、'),
                albumName: item.album?.name,
                albumMid: item.album?.mid,
                strMediaMid: item.file?.media_mid
            }));
        }

        return { request: res.requestOptions, raw: res.body, parsed: parsedList };
    }

    // 热门搜索词库 (同样补全必要的参数)
    async getHotSearch() {
        const data = {
            comm: { 
                ct: '19', cv: '1803', guid: '0', patch: '118',
                psrf_access_token_expiresAt: 0, psrf_qqaccess_token: '',
                psrf_qqopenid: '', psrf_qqunionid: '', tmeAppID: 'qqmusic',
                tmeLoginType: 0, uin: '0', wid: '0' 
            },
            hotkey: { 
                module: 'tencent_musicsoso_hotkey.HotkeyService', 
                method: 'GetHotkeyForQQMusicPC', 
                param: { search_id: '', uin: 0 } 
            }
        };
        const res = await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', { 
            method: 'POST', 
            body: data, 
            headers: { Referer: 'https://y.qq.com/' } 
        });
        return {
            request: res.requestOptions, raw: res.body,
            parsed: res.body?.hotkey?.data?.vec_hotkey?.map(item => item.query) ||[]
        };
    }

    // 榜单列表
    async getLeaderboards() {
        const res = await httpFetch('https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg?g_tk=1928093487&inCharset=utf-8&outCharset=utf-8&notice=0&format=json&uin=0&needNewCode=1&platform=h5');
        const parsed = (res.body?.data?.topList ||[]).filter(b => b.id != 201).map(b => ({
            id: b.id, name: b.topTitle, listenCount: b.listenCount
        }));
        return { request: res.requestOptions, raw: res.body, parsed };
    }

    // 榜单详情
    async getLeaderboardDetail(id) {
        // 为了简化测试，直接请求榜单最新数据，不带 period 也会返回最新
        const data = {
            comm: { uin: 0, format: 'json', ct: 20, cv: 1859 },
            toplist: { module: 'musicToplist.ToplistInfoServer', method: 'GetDetail', param: { topid: parseInt(id), num: 100 } }
        };
        const res = await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', body: data });
        const parsed = res.body?.toplist?.data?.songInfoList?.map(item => ({
            songmid: item.mid, name: item.title, singer: item.singer?.map(s => s.name).join('、')
        })) ||[];
        return { request: res.requestOptions, raw: res.body, parsed };
    }

    // 解析并导入歌单
    async importPlaylist(link) {
        let id = link;
        if (/[?&:/]/.test(id)) {
            // 如果是短链，跟随重定向获取真实URL
            if (!/\/playlist\/(\d+)/.test(id)) {
                const headRes = await httpFetch(id, { method: 'HEAD' });
                id = headRes.url;
            }
            let match = /\/playlist\/(\d+)/.exec(id) || /id=(\d+)/.exec(id);
            if (match) id = match[1];
        }

        const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${id}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`;
        const res = await httpFetch(url, { headers: { Origin: 'https://y.qq.com', Referer: `https://y.qq.com/n/yqq/playsquare/${id}.html` } });
        
        const cdlist = res.body?.cdlist?.[0] || {};
        const parsed = {
            playlistId: id, name: cdlist.dissname, author: cdlist.nickname, desc: cdlist.desc,
            songs: cdlist.songlist?.map(item => ({ songmid: item.mid, name: item.title, singer: item.singer?.map(s => s.name).join('、') })) ||[]
        };
        return { request: res.requestOptions, raw: res.body, parsed };
    }

    // 搜索歌单
    async searchPlaylist(query, page = 1, limit = 20) {
        const url = `http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?page_no=${page - 1}&num_per_page=${limit}&format=json&query=${encodeURIComponent(query)}&remoteplace=txt.yqq.playlist&inCharset=utf8&outCharset=utf-8`;
        const res = await httpFetch(url, { headers: { Referer: 'http://y.qq.com/portal/search.html' } });
        const parsed = res.body?.data?.list?.map(item => ({
            playlistId: item.dissid, name: item.dissname, author: item.creator?.name, songCount: item.song_count
        })) ||[];
        return { request: res.requestOptions, raw: res.body, parsed };
    }

    // 获取歌手基本信息及歌曲
    async getSingerInfo(singerMid) {
        const data = {
            comm: { cv: 4747474, ct: 24, format: 'json', uin: 0 },
            req_1: { module: 'music.musichallSinger.SingerInfoInter', method: 'GetSingerDetail', param: { singer_mid: [singerMid], ex_singer: 1, wiki_singer: 1, pic: 1 } },
            req_3: { module: 'musichall.song_list_server', method: 'GetSingerSongList', param: { singerMid: singerMid, order: 1, begin: 0, num: 50 } }
        };
        const res = await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', body: data });
        
        const info = res.body?.req_1?.data?.singer_list?.[0] || {};
        const parsed = {
            name: info.basic_info?.name, desc: info.ex_info?.desc,
            songs: res.body?.req_3?.data?.songList?.map(s => ({ songmid: s.songInfo.mid, name: s.songInfo.title })) ||[]
        };
        return { request: res.requestOptions, raw: res.body, parsed };
    }

    // 获取单曲详情 (用来查 songId)
    async getMusicInfo(songmid) {
        const data = {
            comm: { ct: '19', cv: '1859', uin: '0' },
            req: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: { song_type: 0, song_mid: songmid } }
        };
        const res = await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', body: data });
        return { request: res.requestOptions, raw: res.body, parsed: res.body?.req?.data?.track_info };
    }

    // 评论获取
    async getComments(songmid, type = 'newest') {
        // 先获取 songId
        const infoRes = await this.getMusicInfo(songmid);
        const songId = infoRes.parsed?.id;
        if (!songId) throw new Error('无法解析歌曲对应的 SongId');

        if (type === 'newest') {
            const form = { uin: '0', format: 'json', cid: '205360772', reqtype: '2', biztype: '1', topid: songId, cmd: '8', needmusiccrit: '1', pagenum: 0, pagesize: 20 };
            const res = await httpFetch('http://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', { method: 'POST', form });
            const parsed = res.body?.comment?.commentlist?.map(c => ({ user: c.rootcommentnick, text: c.rootcommentcontent, time: c.time })) ||[];
            return { request: res.requestOptions, raw: res.body, parsed };
        } else {
            const data = {
                comm: { cv: 4747474, ct: 24, format: 'json', platform: 'yqq.json', uin: 0 },
                req: { module: 'music.globalComment.CommentRead', method: 'GetHotCommentList', param: { BizType: 1, BizId: String(songId), PageSize: 20, PageNum: 0, HotType: 1 } }
            };
            const res = await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', body: data, headers: { Referer: 'https://y.qq.com/' } });
            const parsed = res.body?.req?.data?.CommentList?.Comments?.map(c => ({ user: c.Nick, text: c.Content, time: c.PubTime })) ||[];
            return { request: res.requestOptions, raw: res.body, parsed };
        }
    }

    // 歌词获取与解码
    async getLyric(songmid) {
        const infoRes = await this.getMusicInfo(songmid);
        const songId = infoRes.parsed?.id;
        if (!songId) throw new Error('无法解析歌曲对应的 SongId');

        const data = {
            comm: { ct: '19', cv: '1859', uin: '0' },
            req: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: { format: 'json', crypt: 1, ct: 19, cv: 1873, songID: songId, trans: 1, roma: 1, type: -1 } }
        };
        const res = await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', body: data, headers: { referer: 'https://y.qq.com' } });
        
        // 此处返回原文字符串，如果在实际SDK中有特殊解密则显示在此
        const lyricRaw = res.body?.req?.data?.lyric;
        const transRaw = res.body?.req?.data?.trans;
        
        const parsed = {
            lyric_hex_or_raw: lyricRaw,
            trans_hex_or_raw: transRaw,
            note: '注意: 若返回数据为加密hex，在原版SDK中由 C++ Node 拓展解密。此处原样展示。'
        };
        return { request: res.requestOptions, raw: res.body, parsed };
    }
}

const api = new TxApi();

// =======================
// Electron 主进程生命周期
// =======================

function createWindow() {
    const mainWindow = new BrowserWindow({
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

// IPC 路由中转
ipcMain.handle('tx-api', async (event, method, ...args) => {
    if (typeof api[method] === 'function') {
        try {
            return await api[method](...args);
        } catch (err) {
            console.error(err);
            throw new Error(err.message);
        }
    }
    throw new Error(`Method ${method} not found in TxApi`);
});