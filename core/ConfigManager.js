const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class ConfigManager {
    constructor() {
        this.configPath = path.join(app.getPath('userData'), 'config.json');
        this.defaultConfig = {
            general: { 
                autoStop: true,
                playMode: 1, // 1:被动 2:半主动 3:全主动(LX插件) 4:全主动(MF插件)
                searchSources: ['tx', 'wy', 'kg', 'kw', 'mg']
            },
            api: { lxPort: 23330, refreshInterval: 1000, advanceTime: 1500 },
            blive: { roomId: '', cookie: '' },
            commands: { prefix: '!点歌' },
            permissions: {
                streamerId: '', customUsers: '',
                roles: {
                    admin: { max: 10, cd: 0 },
                    guard: { max: 5, cd: 30 },
                    user:  { max: 2, cd: 120 }
                }
            },
            plugins:[],    // LX 沙盒插件
            mfPlugins:[]   // 新增: MusicFree 插件
        };
        this.config = this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                return { 
                    ...this.defaultConfig, ...data, 
                    general: { ...this.defaultConfig.general, ...(data.general || {}) },
                    api: { ...this.defaultConfig.api, ...(data.api || {}) }, 
                    commands: { ...this.defaultConfig.commands, ...(data.commands || {}) },
                    permissions: { ...this.defaultConfig.permissions, ...(data.permissions || {}) } 
                };
            }
        } catch (e) {}
        return this.defaultConfig;
    }

    save(newConfig) {
        this.config = { ...this.config, ...newConfig };
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        return this.config;
    }

    get() { return this.config; }
}

module.exports = new ConfigManager();