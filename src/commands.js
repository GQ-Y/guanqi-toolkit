const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const constants = require('./constants');
const { detectProjectType } = require('./projectDetector');
const { initializeOrUpdateConfig } = require('./configManager');

function registerCommands(context, treeDataProvider, rootPath) {
    // 注册所有命令
    const commands = [
        // 刷新命令
        vscode.commands.registerCommand('guanqi-toolkit.refresh', () => {
            treeDataProvider.refresh();
        }),

        // 新建文件命令
        vscode.commands.registerCommand('guanqi-toolkit.newFile', async (node) => {
            const dirPath = node ? node.resourceUri.fsPath : rootPath;
            const fileName = await vscode.window.showInputBox({
                prompt: '输入文件名',
                placeHolder: 'example.js'
            });

            if (fileName) {
                const filePath = path.join(dirPath, fileName);
                try {
                    if (!fs.existsSync(filePath)) {
                        fs.writeFileSync(filePath, '');
                        const doc = await vscode.workspace.openTextDocument(filePath);
                        await vscode.window.showTextDocument(doc);
                    } else {
                        vscode.window.showErrorMessage('文件已存在！');
                    }
                } catch (err) {
                    vscode.window.showErrorMessage(`创建文件失败: ${err.message}`);
                }
            }
        }),

        // 新建文件夹命令
        vscode.commands.registerCommand('guanqi-toolkit.newFolder', async (node) => {
            const parentPath = node ? node.resourceUri.fsPath : rootPath;
            const folderName = await vscode.window.showInputBox({
                prompt: '输入文件夹名',
                placeHolder: 'newfolder'
            });

            if (folderName) {
                const folderPath = path.join(parentPath, folderName);
                try {
                    if (!fs.existsSync(folderPath)) {
                        fs.mkdirSync(folderPath);
                        await initializeOrUpdateConfig(rootPath, treeDataProvider);
                        treeDataProvider.refresh();
                    } else {
                        vscode.window.showErrorMessage('文件夹已存在！');
                    }
                } catch (err) {
                    vscode.window.showErrorMessage(`创建文件夹失败: ${err.message}`);
                }
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

        // 删除
        vscode.commands.registerCommand('guanqi-toolkit.delete', async (node) => {
            if (node && node.resourceUri) {
                const isDirectory = fs.statSync(node.resourceUri.fsPath).isDirectory();
                const choice = await vscode.window.showWarningMessage(
                    `确定要删除${isDirectory ? '文件夹' : '文件'} "${path.basename(node.resourceUri.fsPath)}" 吗？`,
                    { modal: true },
                    '删除'
                );

                if (choice === '删除') {
                    try {
                        if (isDirectory) {
                            fs.rmdirSync(node.resourceUri.fsPath, { recursive: true });
                        } else {
                            fs.unlinkSync(node.resourceUri.fsPath);
                        }
                        await initializeOrUpdateConfig(rootPath, treeDataProvider);
                        treeDataProvider.refresh();
                    } catch (err) {
                        vscode.window.showErrorMessage(`删除失败: ${err.message}`);
                    }
                }
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
                        '取消'
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
        )
    ];

    // 将所有命令添加到订阅列表
    context.subscriptions.push(...commands);
}

module.exports = {
    registerCommands
}; 