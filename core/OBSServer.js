const express = require('express');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class OBSServer {
    constructor() {
        this.app = express();
        this.clients = new Set();
        this.server = null;
    }

    start(port = 8888) {
        // 🌟 将静态文件目录映射到用户的 userData (支持用户自定义修改HTML)
        const userDataPath = app.getPath('userData');
        const obsDir = path.join(userDataPath, 'obs-templates');
        
        if (!fs.existsSync(obsDir)) {
            fs.mkdirSync(obsDir, { recursive: true });
        }
        
        this.generateModernTemplates(obsDir);

        this.app.use(express.static(obsDir));

        this.app.get('/', (req, res) => {
            res.send(`
                <meta charset="utf-8">
                <div style="font-family: sans-serif; padding: 40px; background: #1e1e2e; color: #cdd6f4; height: 100vh;">
                    <h2 style="color: #a6e3a1;">✅ OBS 推送服务运行正常！</h2>
                    <p>OBS 模板目录位于：<b style="color: #f9e2af;">${obsDir}</b> （您可以随时去这个文件夹里修改 HTML/CSS 样式，刷新 OBS 即可生效）</p>
                    <p>请在 OBS 的【浏览器源】中填写以下具体组件的链接（建议勾选"控制音频通过OBS"）：</p>
                    <ul style="line-height: 2.5; background: #313244; padding: 20px 40px; border-radius: 8px;">
                        <li>【点歌成功通知】: <b style="color: #89b4fa;">http://127.0.0.1:${port}/alert.html</b></li>
                        <li>【当前播放器卡片】: <b style="color: #89b4fa;">http://127.0.0.1:${port}/player.html</b></li>
                        <li>【待播队列列表】: <b style="color: #89b4fa;">http://127.0.0.1:${port}/queue.html</b></li>
                    </ul>
                </div>
            `);
        });

        this.app.get('/events', (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            this.clients.add(res);
            req.on('close', () => this.clients.delete(res));
        });

        if (this.server) this.server.close();
        this.server = this.app.listen(port);
    }

    broadcast(type, data) {
        const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
        this.clients.forEach(client => client.write(msg));
    }

    generateModernTemplates(dir) {
        // 如果文件不存在则释放默认现代化模板，保证用户修改的不被覆盖
        const files = {
            'modern.css': `
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Microsoft YaHei', sans-serif; overflow: hidden; background: transparent; color: white; }
                .glass-card { background: rgba(30, 30, 46, 0.7); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
                .text-accent { color: #89b4fa; }
                .text-muted { color: #a6adc8; font-size: 13px; }
            `,
            'alert.html': `
                <!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="modern.css">
                <style>
                    .toast-container { position: fixed; top: 20px; right: 20px; display: flex; flex-direction: column; gap: 10px; }
                    .toast { background: rgba(166, 227, 161, 0.9); color: #111; padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-weight: bold; transform: translateX(120%); transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); }
                    .toast.show { transform: translateX(0); }
                </style></head><body>
                <div class="toast-container" id="toast-box"></div>
                <script>
                    const evtSource = new EventSource('/events');
                    evtSource.addEventListener('alert', (e) => {
                        const data = JSON.parse(e.data);
                        const toast = document.createElement('div');
                        toast.className = 'toast show';
                        toast.innerHTML = '🎵 ' + data.user + ' 点了：' + data.song;
                        document.getElementById('toast-box').appendChild(toast);
                        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 5000);
                    });
                </script></body></html>
            `,
            'player.html': `
                <!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="modern.css">
                <style>
                    .player-wrapper { display: flex; align-items: center; gap: 15px; }
                    .disk { width: 50px; height: 50px; border-radius: 50%; background: linear-gradient(135deg, #89b4fa, #cba6f7); animation: spin 4s linear infinite; display: none; }
                    @keyframes spin { 100% { transform: rotate(360deg); } }
                    .info { flex: 1; }
                    h2 { font-size: 18px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;}
                    .progress-bar { height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; margin-top: 8px; overflow: hidden; }
                    .progress-fill { height: 100%; background: #a6e3a1; width: 0%; transition: width 0.3s linear; }
                </style></head><body>
                <div id="widget" class="glass-card" style="display: none; max-width: 350px;">
                    <div class="player-wrapper">
                        <div class="disk" id="disk"></div>
                        <div class="info">
                            <h2 id="song-name" class="text-accent">等待播放</h2>
                            <div class="text-muted" id="song-req">-</div>
                            <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
                        </div>
                    </div>
                </div>
                <script>
                    const evtSource = new EventSource('/events');
                    const widget = document.getElementById('widget'), sName = document.getElementById('song-name'), sReq = document.getElementById('song-req'), prog = document.getElementById('progress'), disk = document.getElementById('disk');
                    evtSource.addEventListener('nowPlaying', (e) => {
                        const data = JSON.parse(e.data);
                        if (!data) { widget.style.display = 'none'; disk.style.display = 'none'; return; }
                        widget.style.display = 'block'; disk.style.display = 'block';
                        sName.textContent = data.song; sReq.textContent = "点歌人: " + data.requester;
                    });
                    evtSource.addEventListener('progress', (e) => {
                        const data = JSON.parse(e.data);
                        if (data.duration > 0) prog.style.width = ((data.progress / data.duration) * 100) + '%';
                    });
                </script></body></html>
            `,
            'queue.html': `
                <!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="modern.css">
                <style>
                    h3 { font-size: 16px; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; color: #cba6f7;}
                    ul { list-style: none; }
                    li { font-size: 14px; margin-bottom: 8px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; }
                </style></head><body>
                <div class="glass-card" style="max-width: 300px;">
                    <h3>待播队列 (<span id="q-count">0</span>)</h3>
                    <ul id="q-list"></ul>
                </div>
                <script>
                    const evtSource = new EventSource('/events');
                    evtSource.addEventListener('queueUpdate', (e) => {
                        const data = JSON.parse(e.data);
                        document.getElementById('q-count').textContent = data.queue.length;
                        document.getElementById('q-list').innerHTML = data.queue.slice(0, 6).map((s, i) => '<li><span class="text-accent">' + (i+1) + '. ' + s.name + '</span> <span class="text-muted">(' + s.user + ')</span></li>').join('');
                    });
                </script></body></html>
            `
        };

        for (const [filename, content] of Object.entries(files)) {
            const filepath = path.join(dir, filename);
            if (!fs.existsSync(filepath)) {
                fs.writeFileSync(filepath, content, 'utf8');
            }
        }
    }
}

module.exports = OBSServer;