// --- 基础 UI 元素 ---
const biliStatusEl = document.getElementById('bili-status');
const lxStatusEl = document.getElementById('lx-status');
const currentNameEl = document.getElementById('current-name');
const currentUserEl = document.getElementById('current-user');
const progressFillEl = document.getElementById('progress-fill');
const logBoxEl = document.getElementById('log-box');
const queueListEl = document.getElementById('queue-list');
const queueCountEl = document.getElementById('queue-count');

// --- 弹窗与设置 ---
const settingsModal = document.getElementById('settings-modal');
const searchModal = document.getElementById('search-modal');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnManualSearch = document.getElementById('btn-manual-search');
const btnCloseSearch = document.getElementById('btn-close-search');
const btnSkip = document.getElementById('btn-skip');
const searchResultTbody = document.getElementById('search-result-tbody');
const searchLoading = document.getElementById('search-loading');

const menuItems = document.querySelectorAll('.settings-menu li');
const tabs = document.querySelectorAll('.settings-tab');
const cfgPlayMode = document.getElementById('cfg-playMode');

// --- 播放器 (用于模式 3/4 本地输出) ---
const localAudio = new Audio();
localAudio.autoplay = true;

// ======= 1. 模式切换显示逻辑 =======
cfgPlayMode.addEventListener('change', () => {
    const val = parseInt(cfgPlayMode.value);
    document.getElementById('section-lx-config').style.display = (val === 2 || val === 3) ? 'block' : 'none';
    document.getElementById('section-mf-config').style.display = (val === 4) ? 'block' : 'none';
    
    // 动态修改搜索框提示语和按钮文字
    if (val === 1) {
        document.getElementById('manual-add-input').placeholder = "输入歌名直接模糊添加点歌 (模式 1)...";
        btnManualSearch.textContent = "➕ 直接添加";
    } else {
        document.getElementById('manual-add-input').placeholder = "输入歌名全网搜索并精准点歌...";
        btnManualSearch.textContent = "🔍 全网搜索";
    }
});

// ======= 2. 插件列表渲染 =======
function renderLxList(plugins) {
    const container = document.getElementById('lx-list-container');
    container.innerHTML = '';
    if (!plugins || plugins.length === 0) {
        container.innerHTML = '<span style="color:#565f89; font-size:12px;">未导入 LX 插件</span>';
        return;
    }
    plugins.forEach(p => {
        const name = p.split(/[/\\]/).pop();
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:13px;";
        div.innerHTML = `<span><span style="color:#a6e3a1">●</span> ${name}</span><button class="btn-danger" style="width:auto; padding:2px 8px; font-size:11px;" onclick="window.removeLx('${p.replace(/\\/g, '\\\\')}')">移除</button>`;
        container.appendChild(div);
    });
}

function renderMfList(plugins) {
    const container = document.getElementById('mf-list-container');
    container.innerHTML = '';
    if (!plugins || plugins.length === 0) {
        container.innerHTML = '<span style="color:#565f89; font-size:12px;">未导入 MF 插件</span>';
        return;
    }
    plugins.forEach(p => {
        const name = p.split(/[/\\]/).pop();
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:13px;";
        div.innerHTML = `<span><span style="color:#7aa2f7">♫</span> ${name}</span><button class="btn-danger" style="width:auto; padding:2px 8px; font-size:11px;" onclick="window.removeMf('${p.replace(/\\/g, '\\\\')}')">移除</button>`;
        container.appendChild(div);
    });
}

window.removeLx = async (path) => { await window.api.removePlugin(path); loadConfigToUI(); };
window.removeMf = async (path) => { await window.api.removeMfPlugin(path); loadConfigToUI(); };

document.getElementById('btn-import-lx').addEventListener('click', async () => {
    const res = await window.api.importSource();
    if (res?.success) loadConfigToUI();
});

document.getElementById('btn-import-mf').addEventListener('click', async () => {
    const res = await window.api.importMfPlugin();
    if (res?.success) { addLog("系统", `MF插件导入成功: ${res.platform}`); loadConfigToUI(); }
    else if (res?.msg) alert("MF导入失败: " + res.msg);
});

// ======= 3. 设置保存与加载 =======
async function loadConfigToUI() {
    const config = await window.api.getConfig();
    if (!config) return;

    document.getElementById('cfg-autoStop').checked = config.general?.autoStop || false;
    cfgPlayMode.value = config.general?.playMode || 1;
    cfgPlayMode.dispatchEvent(new Event('change'));

    const sources = config.general?.searchSources ||['tx', 'wy', 'kg', 'kw', 'mg'];
    document.querySelectorAll('.source-cb').forEach(cb => cb.checked = sources.includes(cb.value));

    renderLxList(config.plugins ||[]);
    renderMfList(config.mfPlugins ||[]);

    document.getElementById('cfg-prefix').value = config.commands?.prefix || '!点歌';
    document.getElementById('cfg-lxPort').value = config.api?.lxPort || 23330;
    document.getElementById('cfg-refreshInterval').value = config.api?.refreshInterval || 1000;
    document.getElementById('cfg-advanceTime').value = config.api?.advanceTime || 1500;
    document.getElementById('cfg-roomId').value = config.blive?.roomId || '';
    document.getElementById('cfg-cookie').value = config.blive?.cookie || '';
    document.getElementById('cfg-streamerId').value = config.permissions?.streamerId || '';

    const roles = config.permissions?.roles || {};
    document.getElementById('cfg-admin-max').value = roles.admin?.max || 10;
    document.getElementById('cfg-admin-cd').value = roles.admin?.cd || 0;
    document.getElementById('cfg-guard-max').value = roles.guard?.max || 5;
    document.getElementById('cfg-guard-cd').value = roles.guard?.cd || 30;
    document.getElementById('cfg-user-max').value = roles.user?.max || 2;
    document.getElementById('cfg-user-cd').value = roles.user?.cd || 120;
}

btnSaveSettings.addEventListener('click', async () => {
    const sources = Array.from(document.querySelectorAll('.source-cb')).filter(cb => cb.checked).map(cb => cb.value);
    const newConfig = {
        general: { autoStop: document.getElementById('cfg-autoStop').checked, playMode: parseInt(cfgPlayMode.value), searchSources: sources },
        commands: { prefix: document.getElementById('cfg-prefix').value },
        api: { lxPort: parseInt(document.getElementById('cfg-lxPort').value), refreshInterval: parseInt(document.getElementById('cfg-refreshInterval').value), advanceTime: parseInt(document.getElementById('cfg-advanceTime').value) },
        blive: { roomId: document.getElementById('cfg-roomId').value, cookie: document.getElementById('cfg-cookie').value },
        permissions: {
            streamerId: document.getElementById('cfg-streamerId').value,
            roles: {
                admin: { max: parseInt(document.getElementById('cfg-admin-max').value), cd: parseInt(document.getElementById('cfg-admin-cd').value) },
                guard: { max: parseInt(document.getElementById('cfg-guard-max').value), cd: parseInt(document.getElementById('cfg-guard-cd').value) },
                user:  { max: parseInt(document.getElementById('cfg-user-max').value), cd: parseInt(document.getElementById('cfg-user-cd').value) }
            }
        }
    };
    await window.api.saveConfig(newConfig);
    addLog("系统", "设置已保存");
    settingsModal.classList.add('hidden');
});

// ======= 4. 核心功能：切歌与手动搜索 =======
btnSkip.addEventListener('click', () => {
    window.api.skipSong();
    addLog("控制", "已发送强制切歌指令");
});

let currentSearchResults =[];

btnManualSearch.addEventListener('click', async () => {
    const keywordInput = document.getElementById('manual-add-input');
    const keyword = keywordInput.value.trim();
    if (!keyword) return;

    const config = await window.api.getConfig();
    const mode = parseInt(config.general.playMode) || 1;

    // 模式一：直接添加，不弹出搜索框
    if (mode === 1) {
        window.api.manualAdd(keyword, "主播后台");
        keywordInput.value = '';
        return;
    }

    // 模式 2/3/4：弹出全网搜索界面
    searchModal.classList.remove('hidden');
    searchResultTbody.innerHTML = '';
    searchLoading.style.display = 'block';
    currentSearchResults =[];

    try {
        if (mode === 4) {
            const results = await window.api.mfSearchAll(keyword);
            currentSearchResults = results.map(item => ({
                name: item.title, singer: item.artist, album: item.album || '-', source: item._platform, rawData: item
            }));
        } else {
            const platforms = config.general.searchSources || ['tx', 'wy', 'kg', 'kw', 'mg'];
            await Promise.allSettled(platforms.map(async (plat) => {
                const res = await window.api.search(plat, keyword, 1);
                let list = Array.isArray(res?.parsed) ? res.parsed : (res?.parsed?.list || res?.raw?.data?.lists || (Array.isArray(res) ? res :[]));
                list.forEach(item => {
                    currentSearchResults.push({
                        name: item.name || item.songname || item.filename,
                        singer: item.singer || item.singername || item.author_name,
                        album: item.albumName || item.album || '-',
                        source: plat,
                        rawData: item
                    });
                });
            }));
        }

        searchLoading.style.display = 'none';
        if (currentSearchResults.length === 0) {
            searchResultTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#565f89;">未搜到任何结果</td></tr>';
            return;
        }

        currentSearchResults.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding:12px 10px; color:#c0caf5; font-weight:bold;">${item.name}</td>
                <td style="padding:12px 10px; color:#9aa5ce;">${item.singer}</td>
                <td style="padding:12px 10px; color:#565f89;">${item.album}</td>
                <td style="padding:12px 10px;"><span style="background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; font-size:11px;">${item.source.toUpperCase()}</span></td>
                <td style="padding:12px 10px; text-align:right;"><button class="btn-primary" style="width:auto; padding:5px 12px; font-size:12px;" onclick="addFromSearch(${index})">添加</button></td>
            `;
            searchResultTbody.appendChild(tr);
        });
    } catch (e) { 
        searchLoading.innerHTML = "搜索失败: " + e.message; 
    }
});

window.addFromSearch = (index) => {
    const item = currentSearchResults[index];
    if (item) {
        window.api.manualAddDirect(item, "主播后台");
        document.getElementById('manual-add-input').value = '';
        searchModal.classList.add('hidden');
    }
};

// ======= 5. 通信监听与后台处理 =======

// 🌟 处理 Mode 2/3 的后台跨源弹幕点歌搜索请求
window.api.onBotRequestSearch(async (data) => {
    const { reqId, keyword } = data;
    const config = await window.api.getConfig();
    const platforms = config.general.searchSources || ['tx', 'wy', 'kg', 'kw', 'mg'];
    
    let allResults =[];
    await Promise.allSettled(platforms.map(async (plat) => {
        try {
            const res = await window.api.search(plat, keyword, 1);
            let list = Array.isArray(res?.parsed) ? res.parsed : (res?.parsed?.list || res?.raw?.data?.lists || (Array.isArray(res) ? res :[]));
            list.forEach(item => {
                item._platform = plat;
                allResults.push(item);
            });
        } catch(e) {}
    }));

    let best = allResults.find(s => {
        const n = (s.name || s.songname || s.filename || '').toLowerCase();
        const si = (s.singer || s.singername || s.author_name || '').toLowerCase();
        return n.includes(keyword.toLowerCase()) || si.includes(keyword.toLowerCase());
    });
    if (!best && allResults.length > 0) best = allResults[0];

    window.api.sendBotSearchResult(reqId, best);
});

window.api.onQueueUpdate((q) => {
    queueCountEl.textContent = q.length;
    queueListEl.innerHTML = '';
    q.forEach((s) => {
        const li = document.createElement('li');
        li.className = 'queue-item';
        li.innerHTML = `<div class="queue-info"><strong>${s.name}</strong><small> - ${s.user}</small></div><button class="btn-remove" onclick="window.api.removeSong(${s.id})">移除</button>`;
        queueListEl.appendChild(li);
    });
});

window.api.onPlayingUpdate((s) => {
    currentNameEl.textContent = s ? s.name : '等待播放...';
    currentUserEl.textContent = s ? `点歌人: ${s.user}` : '点歌人: -';
    if (!s) { 
        progressFillEl.style.width = '0%'; 
        localAudio.pause(); 
        localAudio.src = ''; 
    }
});

window.api.onLxProgress((p) => { 
    if (p?.duration) {
        const pct = (p.progress / p.duration) * 100;
        progressFillEl.style.width = `${pct}%`;
    }
});

window.api.onBiliStatus((s) => { 
    biliStatusEl.textContent = s; 
    biliStatusEl.style.color = s === '已连接' ? '#a6e3a1' : '#f38ba8'; 
});

window.api.onLxStatus((s) => { 
    lxStatusEl.textContent = s; 
    lxStatusEl.style.color = s === '已连接' ? '#a6e3a1' : '#f38ba8'; 
});

window.api.onLog((m) => addLog("系统", m));

function addLog(t, m) {
    const div = document.createElement('div');
    div.innerHTML = `<span style="color:#bb9af7">[${new Date().toLocaleTimeString()}]</span> ${m}`;
    logBoxEl.appendChild(div); 
    logBoxEl.scrollTop = logBoxEl.scrollHeight;
}

// 本地播放器事件 (模式 3/4)
localAudio.addEventListener('timeupdate', () => { 
    if (localAudio.duration) {
        window.api.sendLocalAudioProgress({ 
            status: 'playing', 
            progress: localAudio.currentTime, 
            duration: localAudio.duration 
        }); 
    }
});
localAudio.addEventListener('ended', () => window.api.sendLocalAudioEnded());

window.api.onPlayLocalAudio((url) => { 
    localAudio.src = typeof url === 'string' ? url : url.url; 
});

// ======= 6. 初始化运行 =======
document.addEventListener('DOMContentLoaded', () => {
    loadConfigToUI();
    
    btnCloseSearch.onclick = () => searchModal.classList.add('hidden');
    btnCloseSettings.onclick = () => settingsModal.classList.add('hidden');
    
    btnOpenSettings.onclick = () => { 
        loadConfigToUI(); 
        settingsModal.classList.remove('hidden'); 
    };
    
    menuItems.forEach(m => m.onclick = () => {
        menuItems.forEach(i => i.classList.remove('active')); 
        m.classList.add('active');
        tabs.forEach(t => { t.classList.add('hidden'); t.classList.remove('active'); });
        const target = document.getElementById(m.getAttribute('data-tab'));
        target.classList.remove('hidden'); target.classList.add('active');
    });
});