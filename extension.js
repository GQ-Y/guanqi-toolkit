const vscode = require('vscode');
const DirectoryTreeProvider = require('./src/treeDataProvider');
const { detectProjectType, getProjectTypeIcon } = require('./src/projectDetector');
const { initializeOrUpdateConfig } = require('./src/configManager');
const { registerCommands } = require('./src/commands');
const path = require('path');
const fs = require('fs');
const Config = require('./src/config');

async function activate(context) {
    try {
        console.log('Activating extension...');

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showInformationMessage('请先打开一个工作区文件夹！');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const treeDataProvider = new DirectoryTreeProvider(rootPath);
        
        // 创建状态栏项
        const statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );

        // 检测并显示项目类型
        const updateProjectType = async () => {
            try {
                const projectType = await detectProjectType(rootPath);
                const icon = getProjectTypeIcon(projectType);
                
                statusBarItem.text = `${icon} ${projectType}`;
                statusBarItem.tooltip = `项目类型: ${projectType}\n点击查看详情`;
                statusBarItem.command = 'guanqi-toolkit.showProjectInfo';
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                statusBarItem.show();
            } catch (error) {
                console.error('Error updating project type:', error);
                statusBarItem.text = '$(warning) 未知项目类型';
                statusBarItem.tooltip = '项目类型检测失败';
            }
        };

        // 创建文件系统监听器
        const fileWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(rootPath, '**/*')
        );

        // 添加防抖控制
        let refreshTimeout = null;
        let lastRefreshTime = 0;
        const REFRESH_INTERVAL = 1000; // 1秒的刷新间隔

        const debounceRefresh = async () => {
            if (refreshTimeout) {
                clearTimeout(refreshTimeout);
            }

            // 检查是否需要跳过刷新
            const now = Date.now();
            if (now - lastRefreshTime < REFRESH_INTERVAL) {
                console.log('跳过短时间内的重复刷新');
                return;
            }

            refreshTimeout = setTimeout(async () => {
                await initializeOrUpdateConfig(rootPath, treeDataProvider);
                lastRefreshTime = Date.now();
                refreshTimeout = null;
            }, 500);
        };

        // 监听文件变化
        fileWatcher.onDidChange(async uri => {
            const fileName = path.basename(uri.fsPath);
            if (['package.json', 'pubspec.yaml', 'pom.xml', 'build.gradle'].includes(fileName)) {
                updateProjectType();
            }
            if (fileName === 'directory-config.json') {
                // 避免重复刷新
                if (!refreshTimeout) {
                    console.log('配置文件变更，准备刷新');
                    await debounceRefresh();
                }
            }
        });

        fileWatcher.onDidCreate(async uri => {
            const fileName = path.basename(uri.fsPath);
            if (['package.json', 'pubspec.yaml', 'pom.xml', 'build.gradle'].includes(fileName)) {
                updateProjectType();
            }
        });

        fileWatcher.onDidDelete(async uri => {
            const fileName = path.basename(uri.fsPath);
            if (['package.json', 'pubspec.yaml', 'pom.xml', 'build.gradle'].includes(fileName)) {
                updateProjectType();
            }
        });

        // 注册命令和事件监听
        registerCommands(context, treeDataProvider, rootPath);

        // 创建树视图
        const treeView = vscode.window.createTreeView('directoryExplorer', {
            treeDataProvider,
            canSelectMany: false
        });

        // 设置视图标题
        treeView.title = path.basename(rootPath);

        // 检查并初始化配置文件
        const configPath = path.join(rootPath, 'directory-config.json');
        if (!fs.existsSync(configPath)) {
            try {
                // 自动创建初始配置
                await initializeOrUpdateConfig(rootPath, treeDataProvider);
                vscode.window.showInformationMessage('已自动创建目录配置文件');
            } catch (error) {
                vscode.window.showErrorMessage(`创建配置文件失败: ${error.message}`);
            }
        }

        // 初始化和刷新
        await Promise.all([
            treeDataProvider.refresh(),
            updateProjectType()
        ]);

        // 将监听器、状态栏和树视图添加到订阅列表
        context.subscriptions.push(fileWatcher, statusBarItem, treeView);

        // 监听配置变化
        Config.onConfigChange(context, () => {
            treeDataProvider.refresh();
        });

    } catch (error) {
        console.error('Activation error:', error);
        vscode.window.showErrorMessage(`扩展激活失败: ${error.message}`);
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
