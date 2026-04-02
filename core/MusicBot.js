const { EventEmitter } = require('events');
const { KeepLiveWS } = require('tiny-bilibili-ws');
const { exec } = require('child_process');
const axios = require('axios');
const ConfigManager = require('./ConfigManager');

class MusicBot extends EventEmitter {
    constructor() {
        super();
        this.queue =[];
        this.currentSong = null;
        this.userRecords = {};
        this.biliWS = null;
        this.statusInterval = null;
    }

    async reloadConfig() {
        this.config = ConfigManager.get();
        await this.connectBilibili();
        const mode = parseInt(this.config.general.playMode) || 1;
        if (mode === 1 || mode === 2) this.startLXMonitor();
        else if (this.statusInterval) clearInterval(this.statusInterval);
    }

    async connectBilibili() {
        if (this.biliWS) this.biliWS.close();
        if (!this.config.blive.roomId) return;

        const options = {};
        let rawCookie = this.config.blive.cookie || '';
        let cookieStr = '';
        let loginUid = 0;

        if (rawCookie.trim().startsWith('[')) {
            try {
                const parsed = JSON.parse(rawCookie);
                const needed =['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'];
                const extracted = {};
                parsed.forEach(c => { if (c.name && needed.includes(c.name)) extracted[c.name] = c.value; });
                cookieStr = Object.entries(extracted).map(([k, v]) => `${k}=${v}`).join('; ');
                if (extracted.DedeUserID) loginUid = parseInt(extracted.DedeUserID);
            } catch(e) {
                this.emit('log', '[错误] Cookie JSON 解析失败，将尝试作为普通字符串读取');
                cookieStr = rawCookie.trim();
            }
        } else {
            cookieStr = rawCookie.trim();
            const match = cookieStr.match(/DedeUserID=(\d+)/);
            if (match) loginUid = parseInt(match[1]);
        }

        cookieStr = cookieStr.replace(/\r?\n|\r/g, '').replace(/[^\x20-\x7E]/g, '');

        if (cookieStr) {
            options.headers = { Cookie: cookieStr };
            if (loginUid > 0) options.uid = loginUid;
            try {
                const res = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
                    headers: { 'Cookie': cookieStr, 'User-Agent': 'Mozilla/5.0' }, timeout: 5000
                });
                if (res.data.code === 0 && res.data.data.isLogin) {
                    this.emit('log', `[系统] Cookie验证成功！登录账号: ${res.data.data.uname}`);
                }
            } catch (error) {}
        }

        this.biliWS = new KeepLiveWS(parseInt(this.config.blive.roomId), options);
        this.biliWS.on('live', () => {
            this.emit('bili-status', '已连接');
            this.emit('log', `[系统] 成功连接直播间: ${this.config.blive.roomId}`);
        });
        this.biliWS.on('error', () => this.emit('bili-status', '连接失败'));
        this.biliWS.on('DANMU_MSG', (data) => {
            const info = data.data.info;
            const msg = info[1].trim();
            const prefix = this.config.commands?.prefix || '!点歌';
            if (msg.startsWith(prefix)) {
                const songName = msg.substring(prefix.length).trim();
                if (songName) this.handleSongRequest(info[2][0].toString(), info[2][1], info[2][2] === 1, info[7], songName);
            }
        });
    }

    handleSongRequest(uid, uname, isAdmin, guardLevel, songName) {
        const perms = this.config.permissions;
        let role = isAdmin || uid === perms.streamerId ? 'admin' : (guardLevel > 0 ? 'guard' : 'user');
        const userRec = this.userRecords[uid] || { count: 0, lastTime: 0 };
        if (Date.now() - userRec.lastTime < perms.roles[role].cd * 1000) return;
        if (this.queue.filter(s => s.uid === uid).length >= perms.roles[role].max) return;

        userRec.lastTime = Date.now();
        userRec.count += 1;
        this.userRecords[uid] = userRec;

        this.queue.push({ id: Date.now(), uid, user: uname, name: songName, role, isAccurate: false });
        this.emit('queue-update', this.queue);
        this.emit('log', `[弹幕点歌][${role}] ${uname}: ${songName}`);
        
        this.emit('alert', { type: 'add', user: uname, song: songName });

        if (!this.currentSong) this.playNext();
    }

    manualAdd(songName, userName) {
        this.queue.push({ id: Date.now(), uid: 'manual', user: userName, name: songName, role: 'admin', isAccurate: false });
        this.emit('queue-update', this.queue);
        this.emit('log', `[手动添加] ${userName}: ${songName}`);
        
        this.emit('alert', { type: 'add', user: userName, song: songName });
        
        if (!this.currentSong) this.playNext();
    }

    manualAddDirect(songObj, userName) {
        this.queue.push({ 
            id: Date.now(), uid: 'manual', user: userName, name: songObj.name, role: 'admin', 
            isAccurate: true, exactData: songObj.rawData, source: songObj.source
        });
        this.emit('queue-update', this.queue);
        this.emit('log', `[精准点播] ${userName}: ${songObj.name} (${songObj.source.toUpperCase()})`);
        
        this.emit('alert', { type: 'add', user: userName, song: songObj.name });
        
        if (!this.currentSong) this.playNext();
    }

    async playNext() {
        if (this.queue.length === 0) {
            this.currentSong = null;
            this.emit('playing-update', null);
            const mode = parseInt(this.config.general.playMode) || 1;
            if ([3, 4].includes(mode)) {
                this.emit('lx-progress', { progress: 0, duration: 0 });
            } else {
                this.sendSchemeUrl('lxmusic://player/pause');
            }
            return;
        }

        this.currentSong = this.queue.shift();
        this.emit('queue-update', this.queue);
        this.emit('playing-update', this.currentSong);

        const mode = parseInt(this.config.general.playMode) || 1;

        if (this.currentSong.isAccurate) {
            if (mode === 2) {
                const formattedData = this.formatPluginSongInfo(this.currentSong.exactData, this.currentSong.source);
                const encoded = encodeURIComponent(JSON.stringify(formattedData));
                this.sendSchemeUrl(`lxmusic://music/play?data=${encoded}`);
            } else if (mode === 3) {
                this.emit('trigger-plugin-resolve', { platform: this.currentSong.source, songInfo: this.currentSong.exactData });
            } else if (mode === 4) {
                this.emit('trigger-mf-resolve', { platform: this.currentSong.source, songInfo: this.currentSong.exactData });
            }
            return;
        }

        if (mode === 1) {
            this.sendSchemeUrl(`lxmusic://music/searchPlay/${encodeURIComponent(this.currentSong.name)}`);
        } else if (mode === 2 || mode === 3) {
            this.emit('trigger-internal-search', this.currentSong);
        } else if (mode === 4) {
            this.emit('trigger-mf-search-match', this.currentSong);
        }
    }

    async handleInternalSearchResult(songItem) {
        const mode = parseInt(this.config.general.playMode);
        if (!songItem) {
            this.emit('log', `[系统] 后台未搜索到匹配的歌曲: ${this.currentSong.name}，自动跳过`);
            this.playNext();
            return;
        }
        
        this.emit('log', `[后台匹配] 找到匹配项: ${songItem.name || songItem.songname} - ${songItem._platform}`);
        
        if (mode === 2) {
            const formattedData = this.formatPluginSongInfo(songItem, songItem._platform);
            const encoded = encodeURIComponent(JSON.stringify(formattedData));
            this.sendSchemeUrl(`lxmusic://music/play?data=${encoded}`);
        } else if (mode === 3) {
            this.emit('trigger-plugin-resolve', { platform: songItem._platform, songInfo: songItem });
        }
    }

    // 🌟 核心改进：针对 wy (网易云) "quality no match" 重新清洗对象格式
    formatPluginSongInfo(song, forceSource) {
        let source = String(forceSource || song._platform || song.source || 'kw');

        let interval = song.interval || song.duration || '00:00';
        if (typeof interval === 'number') {
            let m = Math.floor(interval / 60).toString().padStart(2, '0');
            let s = (interval % 60).toString().padStart(2, '0');
            interval = `${m}:${s}`;
        } else if (typeof interval === 'string' && !interval.includes(':')) {
            let num = parseInt(interval);
            if (!isNaN(num)) {
                let m = Math.floor(num / 60).toString().padStart(2, '0');
                let s = (num % 60).toString().padStart(2, '0');
                interval = `${m}:${s}`;
            }
        }

        let coreId = String(song.songId || song.songid || song.id || song.songmid || song.MUSICRID || song.hash || song.FileHash || Date.now());
        if (source === 'kw') coreId = coreId.replace('MUSIC_', '');

        // 🌟 彻底清洗 types 和 _types 数据结构，确保 LX 校验 100% 通过
        let rawTypes = song.types || [];
        let cleanTypes =[];
        let clean_Types = {};

        if (Array.isArray(rawTypes)) {
            rawTypes.forEach(t => {
                if (typeof t === 'string') {
                    // 如果源返回的是 ['128k', '320k'] 这种脏字符串，强制转为对象
                    cleanTypes.push({ type: t, size: '3MB' });
                    clean_Types[t] = { size: '3MB' };
                } else if (typeof t === 'object' && t.type) {
                    cleanTypes.push({ type: t.type, size: t.size || '3MB', hash: t.hash || '' });
                    clean_Types[t.type] = { size: t.size || '3MB', hash: t.hash || '' };
                }
            });
        }

        // 如果清洗后啥也没有（比如 wy 有时压根没返回这个字段），强制注入 128k
        if (cleanTypes.length === 0) {
            cleanTypes.push({ type: '128k', size: '3MB' });
            clean_Types['128k'] = { size: '3MB' };
        }

        // 合并原有的 _types (如果有更详细的 hash 信息)
        if (song._types && typeof song._types === 'object') {
            for (let k in song._types) {
                if (song._types[k]) clean_Types[k] = song._types[k];
            }
        }

        // 酷狗独立 HASH 修复
        let kgHash = String(song.FileHash || song.hash || coreId);
        if (source === 'kg') {
            cleanTypes.forEach(t => { t.hash = String(t.hash || kgHash); });
            Object.keys(clean_Types).forEach(k => { clean_Types[k].hash = String(clean_Types[k].hash || kgHash); });
        }

        let data = {
            name: String(song.name || song.songname || song.filename || '未知'),
            singer: String(song.singer || song.singername || song.author_name || '未知'),
            source: source,
            songmid: coreId,
            interval: String(interval),
            albumId: String(song.albumId || song.albumid || song.album_id || ''),
            albumName: String(song.albumName || song.album || song.remark || ''),
            img: String(song.img || song.pic || ''),
            types: cleanTypes,   // 必须为对象数组
            _types: clean_Types, // 必须为键值对
            meta: {
                songId: coreId,
                albumName: String(song.albumName || song.album || song.remark || ''),
                picUrl: String(song.img || song.pic || '')
            }
        };

        if (source === 'kg') {
            data.hash = kgHash;
            data.meta.hash = kgHash;
        } else if (source === 'tx') { 
            data.strMediaMid = String(song.strMediaMid || song.songmid || coreId); 
            data.albumMid = String(song.albumMid || song.albummid || song.albumId || ''); 
            data.meta.strMediaMid = data.strMediaMid;
            data.meta.albumMid = data.albumMid;
        } else if (source === 'mg') {
            data.copyrightId = String(song.copyrightId || song.copyright_id || coreId);
            data.meta.copyrightId = data.copyrightId;
            data.meta.lrcUrl = String(song.lrcUrl || '');
            data.meta.mrcUrl = String(song.mrcUrl || '');
            data.meta.trcUrl = String(song.trcUrl || '');
        }
        
        return data;
    }

    removeFromQueue(id) { 
        this.queue = this.queue.filter(s => s.id !== id); 
        this.emit('queue-update', this.queue); 
    }

    sendSchemeUrl(url) { 
        exec(process.platform === 'win32' ? `rundll32 url.dll,FileProtocolHandler "${url}"` : `open "${url}"`); 
    }
    
    startLXMonitor() {
        if (this.statusInterval) clearInterval(this.statusInterval);
        const interval = this.config.api?.refreshInterval || 1000;
        const advanceSec = (this.config.api?.advanceTime || 1500) / 1000;
        
        this.statusInterval = setInterval(async () => {
            try {
                const res = await axios.get(`http://127.0.0.1:${this.config.api.lxPort}/status`, { timeout: 1000 });
                const status = res.data;
                this.emit('lx-status', '已连接');
                this.emit('lx-progress', status);
                
                if (status.status === 'playing' && status.duration > 0 && (status.duration - status.progress) < advanceSec) { 
                    if (this.queue.length > 0) { 
                        clearInterval(this.statusInterval); 
                        this.playNext(); 
                        setTimeout(() => { this.startLXMonitor(); }, 3000); 
                    } else if (this.config.general.autoStop) { 
                        this.sendSchemeUrl('lxmusic://player/pause'); 
                        this.currentSong = null; 
                        this.emit('playing-update', null); 
                    }
                }
            } catch (e) { 
                this.emit('lx-status', '未连接'); 
            }
        }, interval);
    }
}
module.exports = MusicBot;