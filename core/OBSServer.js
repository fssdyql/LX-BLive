const express = require('express');
const path = require('path');

class OBSServer {
    constructor() {
        this.app = express();
        this.clients = new Set();
        this.server = null;
    }

    start(port = 8888) {
        // 挂载静态文件目录
        const staticPath = path.join(__dirname, '../obs-display');
        this.app.use(express.static(staticPath));

        // 修复直接访问根目录报错，并给出明确提示
        this.app.get('/', (req, res) => {
            res.send(`
                <meta charset="utf-8">
                <div style="font-family: sans-serif; padding: 40px;">
                    <h2 style="color: #28a745;">✅ OBS 推送服务运行正常！</h2>
                    <p>您直接访问了根目录，请在 OBS 的【浏览器源】中填写以下具体组件的链接：</p>
                    <ul style="line-height: 2; background: #f4f4f4; padding: 20px 40px; border-radius: 8px;">
                        <li>播放器卡片: <b style="color: #007bff;">http://127.0.0.1:${port}/player.html</b></li>
                        <li>待播队列: <b style="color: #007bff;">http://127.0.0.1:${port}/queue.html</b></li>
                    </ul>
                </div>
            `);
        });

        this.app.get('/events', (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*' // 允许跨域
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
}

module.exports = OBSServer;