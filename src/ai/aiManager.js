const ZhipuAI = require('./zhipuAI');
const Config = require('../config');
const fs = require('fs');
const path = require('path');

class AIManager {
    constructor() {
        this.ai = null;
    }

    initialize() {
        if (Config.aiEnable && Config.aiApiKey) {
            switch (Config.aiProvider) {
                case 'zhipu':
                    this.ai = new ZhipuAI(Config.aiApiKey);
                    break;
                default:
                    throw new Error('Unsupported AI provider');
            }
        }
    }

    async generateDirectoryComment(dirPath, rootPath) {
        if (!this.ai) {
            throw new Error('AI service not initialized');
        }

        // 获取目录内容
        const files = await this._scanDirectory(dirPath);
        
        // 生成相对路径
        const relativePath = path.relative(rootPath, dirPath);

        // 生成注释
        return await this.ai.generateComment(relativePath, files);
    }

    _scanDirectory(dirPath) {
        const items = fs.readdirSync(dirPath);
        const result = {
            files: [],
            directories: []
        };

        for (const item of items) {
            if (Config.excludePatterns.includes(item)) {
                continue;
            }

            const fullPath = path.join(dirPath, item);
            const stats = fs.statSync(fullPath);

            if (stats.isDirectory()) {
                result.directories.push(item);
            } else {
                result.files.push(item);
            }
        }

        return result;
    }
}

module.exports = new AIManager(); 