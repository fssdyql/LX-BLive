const platformSelect = document.getElementById('platformSelect');
const qualitySelect = document.getElementById('qualitySelect');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const importBtn = document.getElementById('importBtn');
const songList = document.getElementById('songList');

const pagination = document.getElementById('pagination');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');

const audioPlayer = document.getElementById('audioPlayer');
const coverImg = document.getElementById('coverImg');
const playingTitle = document.getElementById('playingTitle');
const playingSinger = document.getElementById('playingSinger');

let currentSearchResult =[];
let currentPage = 1;
let currentKeyword = '';
let currentPlatform = 'tx';

// --- 搜索事件 ---
searchBtn.addEventListener('click', () => {
    const keyword = searchInput.value.trim();
    if (!keyword) return;
    currentKeyword = keyword;
    currentPlatform = platformSelect.value;
    currentPage = 1;
    performSearch();
});

// --- 翻页事件 ---
prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; performSearch(); }
});
nextPageBtn.addEventListener('click', () => {
    currentPage++; performSearch();
});

// --- 执行搜索 API ---
// --- 执行搜索 API ---
// --- 执行搜索 API ---
async function performSearch() {
    // 1. 初始化 UI 状态
    songList.innerHTML = '<div class="msg">努力搜索中... 🎵</div>';
    pagination.style.display = 'none';
    prevPageBtn.disabled = (currentPage === 1);
    pageInfo.innerText = `第 ${currentPage} 页`;

    try {
        // 2. 调用 Preload 暴露的搜索接口
        // 这里的 res 包含了我们在 lx-kg.js 等文件中返回的 { request, raw, parsed }
        const res = await window.api.search(currentPlatform, currentKeyword, currentPage);
        console.log(`[${currentPlatform}] 搜索原始返回:`, res);

        // 3. 错误校验
        if (!res) {
            throw new Error("平台返回数据为空，请检查网络或源码逻辑。");
        }
        if (res.error) {
            throw new Error("音源内部错误: " + res.error);
        }

        // 4. 核心提取逻辑：兼容不同源的数据结构
        let list = [];

        // 情况 A: 已经在后端（lx-kg.js 等）通过 parsed 字段格式化好了数组
        if (Array.isArray(res.parsed)) {
            list = res.parsed;
        } 
        // 情况 B: 网易云等源可能把数组放在 res.parsed.list 里
        else if (res.parsed && Array.isArray(res.parsed.list)) {
            list = res.parsed.list;
        }
        // 情况 C: 酷狗原始搜索接口的数据在 raw.data.lists 中
        else if (res.raw && res.raw.data && Array.isArray(res.raw.data.lists)) {
            list = res.raw.data.lists;
        }
        // 情况 D: 某些接口直接返回了数组
        else if (Array.isArray(res)) {
            list = res;
        }

        // 5. 保存结果供播放逻辑使用
        currentSearchResult = list;

        // 6. 渲染界面
        if (list.length === 0) {
            songList.innerHTML = `
                <div class="msg">
                    未找到相关歌曲。<br>
                    <small style="color:gray">平台: ${currentPlatform} | 关键字: ${currentKeyword}</small>
                </div>`;
        } else {
            renderList(list, currentPlatform);
            pagination.style.display = 'flex';
        }

    } catch (err) {
        console.error("搜索逻辑崩溃:", err);
        songList.innerHTML = `
            <div class="msg" style="color:#ff4d4f; text-align:left; font-family:monospace; font-size:13px; padding:15px; border:1px solid #ff4d4f; background:#fff1f0;">
                <strong>❌ 搜索异常</strong><br>
                平台: ${currentPlatform}<br>
                错误详情: ${err.message}<br><br>
                <small>建议：请检查 lx-kg.js 是否有语法错误，或按下 F12 查看 Console 里的详细堆栈信息。</small>
            </div>`;
    }
}

// --- 渲染列表函数 ---
function renderList(list, platform) {
    songList.innerHTML = '';
    list.forEach((song, index) => {
        const li = document.createElement('div');
        li.className = 'song-item';
        
        // 兼容处理：有些源字段叫 name，有些叫 songname，有些叫 filename
        const name = song.name || song.songname || song.filename || '未知歌曲';
        const singer = song.singer || song.singername || song.author_name || '未知歌手';
        const album = song.albumName || song.album || song.remark || '无专辑';
        
        li.innerHTML = `
            <span class="col-name" title="${name}">${name}</span>
            <span class="col-singer" title="${singer}">${singer}</span>
            <span class="col-album" title="${album}">${album}</span>
            <span class="col-action">
                <button onclick="playSong(${index}, '${platform}')">播放</button>
            </span>
        `;
        songList.appendChild(li);
    });
}

// --- 播放逻辑：请求真实播放 URL ---
window.playSong = async (index, platform) => {
    const song = currentSearchResult[index];
    const quality = qualitySelect.value;
    
    // 更新播放栏信息
    playingTitle.innerText = song.name || song.songname || song.filename || '正在解析...';
    playingSinger.innerText = song.singer || song.singername || song.author_name || '-';
    
    // 封面图预览 (kg 源通常有 img 字段)
    let cover = song.img || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    if (typeof cover === 'string' && cover.startsWith('//')) cover = 'https:' + cover;
    coverImg.src = cover;

    audioPlayer.pause();
    
    try {
        // 1. 调用主进程，主进程会把请求转发给您导入的【音源脚本】
        const res = await window.api.getMusicUrl(platform, song, quality);
        
        // 2. 解析音源脚本返回的 URL
        let finalUrl = "";
        if (typeof res === 'string') {
            finalUrl = res;
        } else if (res && res.url) {
            finalUrl = res.url;
        }
        
        if (finalUrl && finalUrl.startsWith('http')) {
            console.log("成功获取播放链接:", finalUrl);
            audioPlayer.src = finalUrl;
            // audioPlayer 设置了 autoplay，会自动开始播放
        } else {
            throw new Error(res?.msg || "音源脚本未返回有效的播放地址，请检查脚本或尝试切换音质。");
        }
    } catch (e) {
        console.error("播放失败:", e);
        alert('解析播放链接失败:\n' + e.message + '\n\n提示：请确保您已经点击【导入音源脚本】并选择了正确的 .js 文件！');
    }
}

// --- 脚本导入按钮 ---
importBtn.addEventListener('click', async () => {
    const res = await window.api.importSource();
    if (res && res.success) {
        alert('✅ 音源脚本加载成功！\n现在您可以搜索并点击【播放】了。');
    } else if (res && res.msg) {
        alert('❌ 导入失败: ' + res.msg);
    }
});