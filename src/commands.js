const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const constants = require('./constants');
const { detectProjectType } = require('./projectDetector');
const { initializeOrUpdateConfig, updateDirectoryComment, readConfig } = require('./configManager');
const aiManager = require('./ai/aiManager');
const Config = require('./config');

// 添加辅助函数：检查目录是否已有注释
function checkDirectoryHasComment(directories, targetPath) {
    if (!Array.isArray(directories)) {
        return false;
    }

    for (const dir of directories) {
        if (dir.path === targetPath) {
            return !!dir.comment; // 如果有注释返回 true，否则返回 false
        }
        if (dir.children && dir.children.length > 0) {
            const hasComment = checkDirectoryHasComment(dir.children, targetPath);
            if (hasComment) {
                return true;
            }
        }
    }
    return false;
}

function registerCommands(context, treeDataProvider, rootPath) {
    // 注册所有命令
    const commands = [
        // 刷新命令
        vscode.commands.registerCommand('guanqi-toolkit.refresh', () => {
            treeDataProvider.refresh();
        }),

        // 新建文件命令
        vscode.commands.registerCommand('guanqi-toolkit.newFile', async (node) => {
            try {
                const dirPath = node ? node.resourceUri.fsPath : rootPath;
                
                // 检查目标路径是否是目录
                const stats = await fs.promises.stat(dirPath);
                if (!stats.isDirectory()) {
                    vscode.window.showErrorMessage('所选位置不是一个目录！');
                    return;
                }

                const fileName = await vscode.window.showInputBox({
                    prompt: '输入文件名',
                    placeHolder: 'example.js',
                    validateInput: (value) => {
                        if (!value) {
                            return '文件名不能为空';
                        }
                        if (value.includes('/') || value.includes('\\')) {
                            return '文件名不能包含路径分隔符';
                        }
                        return null;
                    }
                });

                if (fileName) {
                    const filePath = path.join(dirPath, fileName);
                    try {
                        // 检查文件是否已存在
                        if (fs.existsSync(filePath)) {
                            vscode.window.showErrorMessage('文件已存在！');
                            return;
                        }

                        // 创建文件
                        await fs.promises.writeFile(filePath, '');
                        
                        // 打开新创建的文件
                        const doc = await vscode.workspace.openTextDocument(filePath);
                        await vscode.window.showTextDocument(doc);
                        
                        // 刷新树视图
                        await initializeOrUpdateConfig(rootPath, treeDataProvider);
                        treeDataProvider.refresh();
                        
                        vscode.window.showInformationMessage(`文件 ${fileName} 创建成功！`);
                    } catch (err) {
                        console.error('Error creating file:', err);
                        vscode.window.showErrorMessage(`创建文件失败: ${err.message}`);
                    }
                }
            } catch (error) {
                console.error('New file command error:', error);
                vscode.window.showErrorMessage(`创建文件失败: ${error.message}`);
            }
        }),

        // 新建文件夹命令
        vscode.commands.registerCommand('guanqi-toolkit.newFolder', async (node) => {
            try {
                const parentPath = node ? node.resourceUri.fsPath : rootPath;
                
                // 检查目标路径是否是目录
                const stats = await fs.promises.stat(parentPath);
                if (!stats.isDirectory()) {
                    vscode.window.showErrorMessage('所选位置不是一个目录！');
                    return;
                }

                const folderName = await vscode.window.showInputBox({
                    prompt: '输入文件夹名',
                    placeHolder: 'newfolder',
                    validateInput: (value) => {
                        if (!value) {
                            return '文件夹名不能为空';
                        }
                        if (value.includes('/') || value.includes('\\')) {
                            return '文件夹名不能包含路径分隔符';
                        }
                        return null;
                    }
                });

                if (folderName) {
                    const folderPath = path.join(parentPath, folderName);
                    try {
                        // 检查文���夹是否已存在
                        if (fs.existsSync(folderPath)) {
                            vscode.window.showErrorMessage('文件夹已存在！');
                            return;
                        }

                        // 创建文件夹
                        await fs.promises.mkdir(folderPath);
                        
                        // 刷新树视图
                        await initializeOrUpdateConfig(rootPath, treeDataProvider);
                        treeDataProvider.refresh();
                        
                        vscode.window.showInformationMessage(`文件夹 ${folderName} 创建成功！`);
                    } catch (err) {
                        console.error('Error creating folder:', err);
                        vscode.window.showErrorMessage(`创建文件夹失败: ${err.message}`);
                    }
                }
            } catch (error) {
                console.error('New folder command error:', error);
                vscode.window.showErrorMessage(`创建文件夹失败: ${error.message}`);
            }
        }),

        // 在 Finder 中显示
        vscode.commands.registerCommand('guanqi-toolkit.revealInFinder', (node) => {
            if (node && node.resourceUri) {
                vscode.commands.executeCommand('revealFileInOS', node.resourceUri);
            }
        }),

        // 在终端中打开
        vscode.commands.registerCommand('guanqi-toolkit.openInIntegratedTerminal', (node) => {
            if (node && node.resourceUri) {
                const terminal = vscode.window.createTerminal({
                    cwd: node.resourceUri.fsPath
                });
                terminal.show();
            }
        }),

        // 在文件夹中查找
        vscode.commands.registerCommand('guanqi-toolkit.findInFolder', async (node) => {
            if (node && node.resourceUri) {
                await vscode.commands.executeCommand('workbench.action.findInFiles', {
                    query: '',
                    filesToInclude: node.resourceUri.fsPath
                });
            }
        }),

        // 复制路径
        vscode.commands.registerCommand('guanqi-toolkit.copyPath', (node) => {
            if (node && node.resourceUri) {
                vscode.env.clipboard.writeText(node.resourceUri.fsPath);
            }
        }),

        // 复制相对路径
        vscode.commands.registerCommand('guanqi-toolkit.copyRelativePath', (node) => {
            if (node && node.resourceUri) {
                const relativePath = path.relative(rootPath, node.resourceUri.fsPath);
                vscode.env.clipboard.writeText(relativePath);
            }
        }),

        // 重命名
        vscode.commands.registerCommand('guanqi-toolkit.rename', async (node) => {
            if (node && node.resourceUri) {
                const oldPath = node.resourceUri.fsPath;
                const oldName = path.basename(oldPath);
                const dirPath = path.dirname(oldPath);

                const newName = await vscode.window.showInputBox({
                    prompt: '输入新名称',
                    value: oldName
                });

                if (newName && newName !== oldName) {
                    const newPath = path.join(dirPath, newName);
                    try {
                        fs.renameSync(oldPath, newPath);
                        await initializeOrUpdateConfig(rootPath, treeDataProvider);
                        treeDataProvider.refresh();
                    } catch (err) {
                        vscode.window.showErrorMessage(`重命名失败: ${err.message}`);
                    }
                }
            }
        }),

        // 删除命令
        vscode.commands.registerCommand('guanqi-toolkit.delete', async (node) => {
            if (!node || !node.resourceUri) {
                return;
            }

            try {
                const filePath = node.resourceUri.fsPath;
                const stats = fs.statSync(filePath);
                const isDirectory = stats.isDirectory();
                const fileName = path.basename(filePath);

                // 显示确认对话框
                const choice = await vscode.window.showWarningMessage(
                    `确定要删除${isDirectory ? '文件夹' : '文件'} "${fileName}" 吗？`,
                    { modal: true },
                    '删除',
                    '取消'
                );

                if (choice === '删除') {
                    try {
                        if (isDirectory) {
                            // 使用 fs.rmSync 替代 fs.rmdirSync，因为它能更好地处理非空目录
                            fs.rmSync(filePath, { recursive: true, force: true });
                        } else {
                            fs.unlinkSync(filePath);
                        }

                        // 更新配置文件
                        await initializeOrUpdateConfig(rootPath, treeDataProvider);
                        
                        // 强制刷新树视图
                        await treeDataProvider.forceRefresh();
                        
                        // 确保树视图获得焦点
                        await vscode.commands.executeCommand('workbench.view.extension.catalog-explorer');

                        vscode.window.showInformationMessage(`${isDirectory ? '文件夹' : '文件'} "${fileName}" 已删除`);
                    } catch (err) {
                        console.error('Delete error:', err);
                        vscode.window.showErrorMessage(`删除失败: ${err.message}`);
                    }
                }
            } catch (error) {
                console.error('Delete command error:', error);
                vscode.window.showErrorMessage(`删除操作失败: ${error.message}`);
            }
        }),

        // 剪切
        vscode.commands.registerCommand('guanqi-toolkit.cut', (node) => {
            if (node && node.resourceUri) {
                constants.clipboardItem = node.resourceUri;
                constants.isCut = true;
            }
        }),

        // 复制
        vscode.commands.registerCommand('guanqi-toolkit.copy', (node) => {
            if (node && node.resourceUri) {
                constants.clipboardItem = node.resourceUri;
                constants.isCut = false;
            }
        }),

        // 粘贴
        vscode.commands.registerCommand('guanqi-toolkit.paste', async (node) => {
            if (!constants.clipboardItem || !node || !node.resourceUri) {
                return;
            }

            const sourceUri = constants.clipboardItem;
            const targetDir = node.resourceUri.fsPath;
            const sourcePath = sourceUri.fsPath;
            const fileName = path.basename(sourcePath);
            const targetPath = path.join(targetDir, fileName);

            try {
                if (fs.existsSync(targetPath)) {
                    const result = await vscode.window.showWarningMessage(
                        `${fileName} 已存在，是否替换？`,
                        { modal: true },
                        '替换',
                        ''
                    );
                    if (result !== '替换') {
                        return;
                    }
                }

                const isDirectory = fs.statSync(sourcePath).isDirectory();
                if (isDirectory) {
                    if (constants.isCut) {
                        fs.renameSync(sourcePath, targetPath);
                    } else {
                        fs.cpSync(sourcePath, targetPath, { recursive: true });
                    }
                } else {
                    if (constants.isCut) {
                        fs.renameSync(sourcePath, targetPath);
                    } else {
                        fs.copyFileSync(sourcePath, targetPath);
                    }
                }

                if (constants.isCut) {
                    constants.clipboardItem = null;
                    constants.isCut = false;
                }

                await initializeOrUpdateConfig(rootPath, treeDataProvider);
                treeDataProvider.refresh();
            } catch (err) {
                vscode.window.showErrorMessage(`${constants.isCut ? '移动' : '复制'}失败: ${err.message}`);
            }
        }),

        // 显示项目信息
        vscode.commands.registerCommand('guanqi-toolkit.showProjectInfo', async () => {
            const projectType = await detectProjectType(rootPath);
            const packageJsonPath = path.join(rootPath, 'package.json');
            let detailMessage = `项目类型: ${projectType}\n`;
            
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                if (packageJson.dependencies || packageJson.devDependencies) {
                    detailMessage += '\n主要依赖:\n';
                    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
                    Object.entries(allDeps)
                        .filter(([key]) => key.includes('vue') || key.includes('react') || key.includes('angular'))
                        .forEach(([key, value]) => {
                            detailMessage += `${key}: ${value}\n`;
                        });
                }
            }
            
            vscode.window.showInformationMessage(detailMessage, { modal: true });
        }),

        // 项目头部命令
        vscode.commands.registerCommand('guanqi-toolkit.projectHeader.newFile', () => 
            vscode.commands.executeCommand('guanqi-toolkit.newFile')
        ),

        vscode.commands.registerCommand('guanqi-toolkit.projectHeader.newFolder', () => 
            vscode.commands.executeCommand('guanqi-toolkit.newFolder')
        ),

        vscode.commands.registerCommand('guanqi-toolkit.projectHeader.refresh', () => 
            vscode.commands.executeCommand('guanqi-toolkit.refresh')
        ),

        // 修改生成注释命令
        vscode.commands.registerCommand('guanqi-toolkit.generateComments', async (node) => {
            if (!node || !node.resourceUri) {
                return;
            }

            // 检查 AI 配置
            if (!Config.aiEnable) {
                const enable = await vscode.window.showWarningMessage(
                    'AI 注释功能未启用，是否现在启用？',
                    '是',
                    '否'
                );
                if (enable !== '是') {
                    return;
                }
                await vscode.workspace.getConfiguration('guanqi-toolkit').update('ai.enable', true, true);
            }

            if (!Config.aiApiKey) {
                const input = await vscode.window.showInputBox({
                    prompt: '请输入智谱 AI API 密钥',
                    password: true
                });
                if (!input) {
                    return;
                }
                await vscode.workspace.getConfiguration('guanqi-toolkit').update('ai.apiKey', input, true);
            }

            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "正在生成目录注释",
                    cancellable: false
                }, async (progress) => {
                    aiManager.initialize();

                    // 获取当前目录路径
                    const currentDirPath = node.resourceUri.fsPath;
                    const currentRelativePath = path.relative(rootPath, currentDirPath);

                    // 读取当前配置文件
                    const config = await readConfig(rootPath);
                    if (!config) {
                        throw new Error('无法读取配置文件');
                    }

                    // 检查当前目录是否已有注释
                    const currentDirHasComment = checkDirectoryHasComment(config.directories, currentRelativePath);

                    progress.report({ message: "分析目录结构..." });

                    // 只为当前目录生成注释（如果没有注释）
                    if (!currentDirHasComment) {
                        const currentComment = await aiManager.generateDirectoryComment(currentDirPath, rootPath);
                        if (currentComment) {
                            progress.report({ message: `已生成注释: ${currentComment}` });
                            
                            console.log('Updating directory comment:', {  // 添加日志
                                path: currentRelativePath,
                                comment: currentComment
                            });
                            
                            // 更新配置文件中的注释
                            const success = await updateDirectoryComment(rootPath, currentRelativePath, currentComment);
                            console.log('Update comment result:', success);  // 添加日志
                            
                            if (success) {
                                progress.report({ message: "更新目录树..." });
                                
                                console.log('Calling forceRefresh');  // 添加日志
                                await treeDataProvider.forceRefresh();
                                
                                console.log('Ensuring focus');  // 添加日志
                                await vscode.commands.executeCommand('workbench.view.extension.catalog-explorer');
                                
                                vscode.window.showInformationMessage('目录注释生成并保存成功！');
                            } else {
                                throw new Error('更新配置文件失败');
                            }
                        }
                    } else {
                        progress.report({ message: "当前目录已有注释，跳过生成" });
                        vscode.window.showInformationMessage('目录注释已存在。');
                    }
                });
            } catch (error) {
                console.error('Generate comments error:', error);  // 添加日志
                vscode.window.showErrorMessage(`生成注释失败: ${error.message}`);
            }
        }),

        // 添加辅助函数：检查目��是否已有注释
        function checkDirectoryHasComment(directories, targetPath) {
            for (const dir of directories) {
                if (dir.path === targetPath) {
                    return !!dir.comment; // 如果有注释返回 true，否则返回 false
                }
                if (dir.children && dir.children.length > 0) {
                    const hasComment = checkDirectoryHasComment(dir.children, targetPath);
                    if (hasComment) {
                        return true;
                    }
                }
            }
            return false;
        },

        // 添加打开设置命令
        vscode.commands.registerCommand('guanqi-toolkit.openSettings', async () => {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'guanqi-toolkit'
            );
        }),

        // 添加打开 GitHub 命令
        vscode.commands.registerCommand('guanqi-toolkit.openGithub', async () => {
            const config = vscode.workspace.getConfiguration('guanqi-toolkit');
            const about = config.get('about');
            if (about && about.github) {
                await vscode.env.openExternal(vscode.Uri.parse(about.github));
            }
        }),
    ];

    // 将所有命令添加到订阅��表
    context.subscriptions.push(...commands);
}

module.exports = {
    registerCommands
}; 