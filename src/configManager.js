// 配置文件管理相关功能
const fs = require('fs');
const path = require('path');
const { scanDirectory, mergeDirectories } = require('./fileUtils');

async function initializeOrUpdateConfig(rootPath, treeDataProvider) {
    if (!rootPath || !treeDataProvider) {
        console.warn('Invalid parameters for initializeOrUpdateConfig');
        return;
    }

    const configPath = path.join(rootPath, 'directory-config.json');
    
    try {
        let config;
        if (fs.existsSync(configPath)) {
            // 读取现有配置
            const content = fs.readFileSync(configPath, 'utf8');
            try {
                config = JSON.parse(content);
            } catch (parseError) {
                console.warn('Error parsing config file:', parseError);
                config = { version: '1.0', directories: [] };
            }
            
            // 扫描当前目录结构
            const currentStructure = await scanDirectory(rootPath);
            
            // 更新配置，保留现有注释
            config.directories = mergeDirectories(config.directories || [], currentStructure);
        } else {
            // 创建新配置
            const directoryStructure = await scanDirectory(rootPath);
            config = {
                version: '1.0',
                directories: directoryStructure
            };
        }

        // 写入配置文件
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        console.log('Config file initialized/updated successfully');
        
        // 刷新树视图
        await treeDataProvider.refresh();

        return config;
    } catch (error) {
        console.error('Error initializing/updating config:', error);
        throw new Error(`配置文件初始化/更新失败: ${error.message}`);
    }
}

// 读取配置文件
function readConfig(rootPath) {
    const configPath = path.join(rootPath, 'directory-config.json');
    if (!fs.existsSync(configPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn('Error reading config file:', error);
        return null;
    }
}

// 保存配置文件
function saveConfig(rootPath, config) {
    const configPath = path.join(rootPath, 'directory-config.json');
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error saving config file:', error);
        return false;
    }
}

// 更新目录注释
async function updateDirectoryComment(rootPath, directoryPath, comment) {
    const config = readConfig(rootPath);
    if (!config) {
        return false;
    }

    function updateComment(directories) {
        for (const dir of directories) {
            if (dir.path === directoryPath) {
                dir.comment = comment;
                return true;
            }
            if (dir.children && dir.children.length > 0) {
                if (updateComment(dir.children)) {
                    return true;
                }
            }
        }
        return false;
    }

    if (updateComment(config.directories)) {
        return saveConfig(rootPath, config);
    }
    return false;
}

module.exports = {
    initializeOrUpdateConfig,
    readConfig,
    saveConfig,
    updateDirectoryComment
}; 