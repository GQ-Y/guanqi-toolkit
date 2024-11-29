const vscode = require('vscode');
const DirectoryTreeProvider = require('./src/treeDataProvider');
const { detectProjectType, getProjectTypeIcon } = require('./src/projectDetector');
const { initializeOrUpdateConfig } = require('./src/configManager');
const { registerCommands } = require('./src/commands');
const path = require('path');
const fs = require('fs');
const Config = require('./src/config');
const { exec } = require('child_process');

async function activate(context) {
    try {
        console.log('Activating extension...');

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showInformationMessage('请先打开一个工作区文件夹！');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        let treeDataProvider;
        try {
            const configPath = path.join(rootPath, 'directory-config.json');
            if (!fs.existsSync(configPath)) {
                await initializeOrUpdateConfig(rootPath);
                vscode.window.showInformationMessage('已自动创建目录配置文件');
            } else {
                await initializeOrUpdateConfig(rootPath);
            }
            
            treeDataProvider = new DirectoryTreeProvider(rootPath);
            await treeDataProvider.initialize();
        } catch (error) {
            console.error('Configuration initialization error:', error);
            vscode.window.showErrorMessage(`配置初始化失败: ${error.message}`);
            return;
        }
        
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

        // 检查并更新Docker目录状态
        const updateDockerButtonVisibility = () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (workspaceFolder) {
                const dockerDir = path.join(workspaceFolder, 'docker');
                const hasDockerDir = fs.existsSync(dockerDir);
                vscode.commands.executeCommand('setContext', 'guanqi-toolkit:hasDockerDir', hasDockerDir);
            }
        };
        
        // 初始检查
        updateDockerButtonVisibility();
        
        // 监听文件系统变化
        const dockerWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolders[0], '**/docker/**')
        );
        
        dockerWatcher.onDidCreate(() => updateDockerButtonVisibility());
        dockerWatcher.onDidDelete(() => updateDockerButtonVisibility());
        
        context.subscriptions.push(dockerWatcher);

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
            // 检查docker目录变化
            if (path.dirname(uri.fsPath).includes('docker')) {
                updateDockerButtonVisibility();
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

        // 注册强制刷新命令
        let forceRefreshCmd = vscode.commands.registerCommand('guanqi-toolkit.forceRefreshTree', async () => {
            try {
                vscode.window.showInformationMessage('正在刷新目录树视图...');
                await treeDataProvider.forceRefresh();
                vscode.window.showInformationMessage('目录树视图已刷新');
            } catch (error) {
                vscode.window.showErrorMessage(`刷新失败: ${error.message}`);
            }
        });
        
        context.subscriptions.push(forceRefreshCmd);

        // 创建树视图
        const treeView = vscode.window.createTreeView('directoryExplorer', {
            treeDataProvider,
            canSelectMany: false
        });

        // 设置视图标题
        treeView.title = path.basename(rootPath);

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

        // 注册Docker构建命令
        let dockerBuildCmd = vscode.commands.registerCommand('extension.dockerBuild', async () => {
            let statusBar;
            let config;
            let dockerDir;
            let logsDir;
            let versionFile;
            let buildLogFile;
            let logBuildInfo;
            
            try {
                // 检查是否需要sudo
                const checkDockerGroup = process.platform !== 'win32' 
                    ? await execCommand('groups').then(output => output.includes('docker'))
                    : true;
                
                // 获取sudo密码（如果需要）
                let sudoPassword;
                if (!checkDockerGroup && process.platform !== 'win32') {
                    sudoPassword = await vscode.window.showInputBox({
                        prompt: '需要sudo权限来执行Docker命令',
                        placeHolder: '请输入sudo密码',
                        password: true
                    });
                    
                    if (!sudoPassword) {
                        throw new Error('需要sudo密码才能继续操作');
                    }
                }
                
                // 分别处理需要sudo和不需要sudo的命令
                const useSudo = (cmd) => {
                    if (checkDockerGroup || process.platform === 'win32') {
                        return cmd;
                    }
                    return `echo '${sudoPassword}' | sudo -S ${cmd}`;
                };
                
                // 读取配置
                config = {
                    registry: {
                        url: vscode.workspace.getConfiguration('guanqi-toolkit.docker.registry').get('url'),
                        namespace: vscode.workspace.getConfiguration('guanqi-toolkit.docker.registry').get('namespace'),
                        repository: vscode.workspace.getConfiguration('guanqi-toolkit.docker.registry').get('repository'),
                        username: vscode.workspace.getConfiguration('guanqi-toolkit.docker.registry').get('username'),
                        password: vscode.workspace.getConfiguration('guanqi-toolkit.docker.registry').get('password')
                    },
                    build: {
                        dockerfile: vscode.workspace.getConfiguration('guanqi-toolkit.docker.build').get('dockerfile'),
                        context: vscode.workspace.getConfiguration('guanqi-toolkit.docker.build').get('context')
                    }
                };
                
                // 验证必要配置
                if (!config.registry.url || !config.registry.namespace || 
                    !config.registry.repository || !config.registry.username) {
                    throw new Error('请先在设置中配置Docker Registry信息');
                }

                // 检查工作区
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                if (!workspaceFolder) {
                    throw new Error('请先打开一个工作区文件夹');
                }
                
                // 检查Dockerfile是否存在
                const dockerfilePath = path.join(workspaceFolder, config.build.dockerfile || 'Dockerfile');
                if (!fs.existsSync(dockerfilePath)) {
                    throw new Error(
                        `找不到Dockerfile文件！\n` +
                        `期望路径: ${dockerfilePath}\n\n` +
                        `请确保Dockerfile文件存在，或在设置中修改Dockerfile路径。\n` +
                        `当前工作目录: ${workspaceFolder}`
                    );
                }
                
                // 创建docker目录结构
                dockerDir = path.join(workspaceFolder, 'docker');
                logsDir = path.join(dockerDir, 'logs');
                versionFile = path.join(dockerDir, 'version.json');
                buildLogFile = path.join(logsDir, 'build_logs.txt');
                
                if (!fs.existsSync(dockerDir)) {
                    fs.mkdirSync(dockerDir);
                }
                if (!fs.existsSync(logsDir)) {
                    fs.mkdirSync(logsDir);
                }
                
                // 定义日志记录函数
                logBuildInfo = (message) => {
                    try {
                        const timestamp = new Date().toISOString();
                        const logMessage = `[${timestamp}] ${message}\n`;
                        fs.appendFileSync(buildLogFile, logMessage);
                    } catch (error) {
                        console.error('写入日志失败:', error);
                    }
                };
                
                // 读取历史版本信息
                let lastVersion = '';
                if (fs.existsSync(versionFile)) {
                    try {
                        const versionContent = fs.readFileSync(versionFile, 'utf8');
                        
                        // 验证JSON内容是否为空
                        if (!versionContent.trim()) {
                            throw new Error('version.json文件为空');
                        }

                        // 尝试解析JSON
                        const versionInfo = JSON.parse(versionContent);
                        
                        // 验证必要字段
                        if (!versionInfo || typeof versionInfo !== 'object') {
                            throw new Error('version.json格式无效');
                        }

                        lastVersion = versionInfo.lastVersion;
                        
                        // 如果没有buildHistory字段,初始化它
                        if (!Array.isArray(versionInfo.buildHistory)) {
                            versionInfo.buildHistory = [];
                            // 重写文件以修复结构
                            fs.writeFileSync(versionFile, JSON.stringify(versionInfo, null, 2));
                        }

                    } catch (error) {
                        console.error('读取版本信息失败:', error);
                        logBuildInfo(`版本文件读取错误: ${error.message}`);
                        
                        // 如果文件损坏,创建新的版本文件
                        const initialVersionInfo = {
                            lastVersion: '',
                            lastBuildTime: '',
                            imageInfo: {},
                            buildHistory: []
                        };
                        
                        try {
                            fs.writeFileSync(versionFile, JSON.stringify(initialVersionInfo, null, 2));
                            logBuildInfo('已重新初始化版本文件');
                            vscode.window.showInformationMessage('版本文件已重新初始化');
                        } catch (writeError) {
                            logBuildInfo(`重新初始化版本文件失败: ${writeError.message}`);
                            throw new Error(`无法创建或修复版本文件: ${writeError.message}`);
                        }
                    }
                }
                
                // 获取版本号
                const version = await vscode.window.showInputBox({
                    prompt: '请输入版本号',
                    placeHolder: lastVersion ? `上次版本: ${lastVersion}，例如: 1.0.0或latest` : '例如: 1.0.0或latest'
                });
                
                if (!version) return;
                
                // 保存新版本信息
                const fullImageTag = `${config.registry.url}/${config.registry.namespace}/${config.registry.repository}:${version}`;
                const pullCommand = `docker pull ${fullImageTag}`;
                
                try {
                    const newVersionInfo = {
                        lastVersion: version,
                        lastBuildTime: new Date().toISOString(),
                        imageInfo: {
                            repository: config.registry.repository,
                            fullTag: fullImageTag,
                            pullCommand: pullCommand
                        },
                        buildHistory: [
                            {
                                version: version,
                                buildTime: new Date().toISOString(),
                                imageTag: fullImageTag,
                                pullCommand: pullCommand
                            }
                        ]
                    };

                    // 如果存在旧的构建历史,则合并
                    if (fs.existsSync(versionFile)) {
                        try {
                            const oldInfo = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
                            if (Array.isArray(oldInfo.buildHistory)) {
                                newVersionInfo.buildHistory = newVersionInfo.buildHistory.concat(
                                    oldInfo.buildHistory
                                ).slice(0, 10);
                            }
                        } catch (error) {
                            logBuildInfo(`读取旧构建历史失败: ${error.message}`);
                        }
                    }

                    // 写入新版本信息
                    fs.writeFileSync(versionFile, JSON.stringify(newVersionInfo, null, 2));
                    logBuildInfo('版本信息已更新');

                } catch (error) {
                    logBuildInfo(`保存版本信息失败: ${error.message}`);
                    throw new Error(`无法保存版本信息: ${error.message}`);
                }

                // 在日志中记录完整信息
                logBuildInfo('版本信息:');
                logBuildInfo(`- 版本号: ${version}`);
                logBuildInfo(`- 镜像标签: ${fullImageTag}`);
                logBuildInfo(`- 拉取命令: ${pullCommand}`);
                
                // 创建状态栏
                statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
                statusBar.show();
                
                // 构建镜像
                statusBar.text = "$(sync~spin) 正在构建Docker镜像...";
                const buildCmd = useSudo(`docker build -t ${config.registry.repository}:${version} -f "${dockerfilePath}" "${path.join(workspaceFolder, config.build.context || '.')}"`);
                const buildOutput = await execCommand(buildCmd);
                logBuildInfo(`构建镜像: ${config.registry.repository}:${version}`);
                vscode.window.showInformationMessage(`Docker镜像构建成功: ${config.registry.repository}:${version}`);
                
                // 登录Registry
                statusBar.text = "$(sync~spin) 正在登录Registry...";
                const password = config.registry.password;
                if (password) {
                    const loginCmd = `echo "${password}" | docker login --username=${config.registry.username} --password-stdin ${config.registry.url}`;
                    await execCommand(loginCmd);
                    logBuildInfo(`登录Registry: ${config.registry.url}`);
                    vscode.window.showInformationMessage(`成功登录到 Registry: ${config.registry.url}`);
                } else {
                    const manualLoginCmd = `docker login --username=${config.registry.username} ${config.registry.url}`;
                    await execCommand(manualLoginCmd);
                    logBuildInfo(`手动登录Registry: ${config.registry.url}`);
                    vscode.window.showInformationMessage(`成功登录到 Registry: ${config.registry.url}`);
                }
                
                // 打标签
                statusBar.text = "$(sync~spin) 正在打标签...";
                const imageTag = `${config.registry.url}/${config.registry.namespace}/${config.registry.repository}:${version}`;
                const tagCmd = `docker tag ${config.registry.repository}:${version} ${imageTag}`;
                await execCommand(tagCmd);
                logBuildInfo(`打标签: ${imageTag}`);
                vscode.window.showInformationMessage(`成功为镜像打标签: ${imageTag}`);
                
                // 推送镜像
                statusBar.text = "$(sync~spin) 正在推送镜像...";
                const pushCmd = `docker push "${imageTag}"`;
                await execCommand(pushCmd);
                logBuildInfo(`推送镜像: ${imageTag}`);
                vscode.window.showInformationMessage(`镜像推送成功: ${imageTag}`);
                
                // 最终成功提示
                const finalMessage = `操作完成！\n` + 
                                   `✓ 镜像已构建: ${config.registry.repository}:${version}\n` +
                                   `✓ 已推送到: ${config.registry.url}/${config.registry.namespace}/${config.registry.repository}:${version}`;
                logBuildInfo('操作完成！');
                vscode.window.showInformationMessage(finalMessage, { modal: true });
                
            } catch (error) {
                // 记录错误信息
                if (logBuildInfo) {
                    logBuildInfo(`错误: ${error.message}`);
                }
                
                // 显示更详细的错误信息
                let errorMessage = `操作失败！\n${error.message}\n\n`;
                
                if (error.message.includes('denied: requested access to the resource is denied')) {
                    errorMessage += '可能的原因：\n' +
                        '1. Registry登录失败\n' +
                        '2. 用户名或密码错误\n' +
                        '3. 没有推送权限\n\n' +
                        '建议操作：\n' +
                        '1. 检查Registry的用户名和密码是否正确\n' +
                        '2. 确认是否有推送权限\n' +
                        '3. 尝试手动执行：docker login ' + (config?.registry?.url || 'registry.cn-hangzhou.aliyuncs.com');
                } else if (error.message.includes('permission denied')) {
                    errorMessage += '如果遇到权限问题，请尝试执行:\nsudo usermod -aG docker $USER';
                }
                
                vscode.window.showErrorMessage(errorMessage, { modal: true });
            } finally {
                // 确保状态栏始终会被清理
                if (statusBar) {
                    statusBar.dispose();
                }
            }
        });

        context.subscriptions.push(dockerBuildCmd);

    } catch (error) {
        console.error('Activation error:', error);
        vscode.window.showErrorMessage(`扩展激活失败: ${error.message}`);
    }
}

function deactivate() {}

// 执行shell命令的Promise包装
function execCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

module.exports = {
    activate,
    deactivate
};
