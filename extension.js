const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// 读取 uniapp pages.json 文件
async function readUniappPages(rootPath) {
    const pagesPath = path.join(rootPath, 'pages.json');
    if (!fs.existsSync(pagesPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(pagesPath, 'utf-8');
        const pagesConfig = JSON.parse(content);
        
        // 创建页面路径到标题的映射
        const pageMap = new Map();

        // 处理主包页面
        if (pagesConfig.pages) {
            pagesConfig.pages.forEach(page => {
                if (page.path && page.style && page.style.navigationBarTitleText) {
                    pageMap.set(page.path, page.style.navigationBarTitleText);
                }
            });
        }

        // 处理分包页面
        if (pagesConfig.subPackages) {
            pagesConfig.subPackages.forEach(subPackage => {
                const root = subPackage.root;
                if (subPackage.pages) {
                    subPackage.pages.forEach(page => {
                        if (page.path && page.style && page.style.navigationBarTitleText) {
                            const fullPath = path.join(root, page.path);
                            pageMap.set(fullPath, page.style.navigationBarTitleText);
                        }
                    });
                }
            });
        }

        return pageMap;
    } catch (error) {
        console.error('Error reading pages.json:', error);
        return null;
    }
}

// 读取配置文件
async function readConfigFile(rootPath) {
    const configPath = path.join(rootPath, 'directory-config.json');
    if (!fs.existsSync(configPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);
        
        // 创建路径到注释的映射
        const commentMap = new Map();

        function processDirectories(directories, parentPath = '') {
            directories.forEach(dir => {
                const fullPath = dir.path;
                if (dir.comment) {
                    commentMap.set(fullPath, dir.comment);
                }
                if (dir.children) {
                    processDirectories(dir.children, fullPath);
                }
            });
        }

        if (config.directories) {
            processDirectories(config.directories);
        }

        return commentMap;
    } catch (error) {
        console.error('Error reading config file:', error);
        return null;
    }
}

class DirectoryTreeProvider {
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.pageMap = null;
        this.commentMap = null;
        this.isCreatingNew = false;
        this.creatingParentPath = null;
        this.creatingType = null;
        this.inputItem = null;
    }

    async refresh() {
        // 重新读取配置
        this.pageMap = await readUniappPages(this.workspaceRoot);
        this.commentMap = await readConfigFile(this.workspaceRoot);
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        return element;
    }

    async getChildren(element) {
        if (!this.workspaceRoot) {
            return [];
        }

        try {
            // 如果是根节点，添加项目名称栏
            if (!element) {
                const projectNameItem = new vscode.TreeItem('');
                projectNameItem.label = {
                    label: path.basename(this.workspaceRoot),
                    highlights: []
                };
                projectNameItem.contextValue = 'project-header';
                projectNameItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                projectNameItem.iconPath = new vscode.ThemeIcon('root-folder');
                projectNameItem.resourceUri = vscode.Uri.file(this.workspaceRoot);
                return [projectNameItem];
            }

            // 获取当前路径
            const currentPath = element.resourceUri.fsPath;

            // 如果正在创建新项目且在目标目录中
            if (this.isCreatingNew && currentPath === this.creatingParentPath) {
                const children = await this._getChildren(currentPath);
                
                // 创建可编辑的输入项
                const inputItem = new vscode.TreeItem('');
                inputItem.label = {
                    label: '',  // 空标签，显示为输入框
                    highlights: [[0, 0]]  // 高亮整个文本
                };
                inputItem.contextValue = 'creating-new';
                inputItem.iconPath = new vscode.ThemeIcon(
                    this.creatingType === 'file' ? 'new-file' : 'new-folder'
                );
                inputItem.command = {
                    command: 'catalog-annotations.handleNewInput',
                    title: 'Input Name',
                    arguments: [currentPath, this.creatingType]
                };

                // 将输入框放在列表最前面
                return [inputItem, ...children];
            }

            // 正常显示子项目
            if (element.contextValue === 'project-header') {
                return await this._getChildren(this.workspaceRoot);
            }

            return await this._getChildren(currentPath);
        } catch (error) {
            console.error('Error getting children:', error);
            return [];
        }
    }

    async _getChildren(currentPath) {
        const items = fs.readdirSync(currentPath);
        const children = [];

        for (const item of items) {
            if (item === 'node_modules' || item === '.git') {
                continue;
            }

            const fullPath = path.join(currentPath, item);
            const stats = fs.statSync(fullPath);
            
            // 创建 TreeItem
            const treeItem = await this._createTreeItem(fullPath, item, stats);
            if (treeItem) {
                children.push(treeItem);
            }
        }

        // 按类型和名称排序
        return children.sort((a, b) => {
            // 目录优先
            const aIsDir = a.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed;
            const bIsDir = b.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed;
            if (aIsDir !== bIsDir) {
                return aIsDir ? -1 : 1;
            }
            // 按名称排序
            return a.label.localeCompare(b.label);
        });
    }

    async _createTreeItem(fullPath, name, stats) {
        const relativePath = path.relative(this.workspaceRoot, fullPath);
        const treeItem = new vscode.TreeItem(
            name,
            stats.isDirectory() 
                ? vscode.TreeItemCollapsibleState.Collapsed 
                : vscode.TreeItemCollapsibleState.None
        );

        treeItem.resourceUri = vscode.Uri.file(fullPath);
        
        // 设置图标
        if (stats.isDirectory()) {
            treeItem.iconPath = new vscode.ThemeIcon('folder');
        } else {
            treeItem.iconPath = this._getFileIcon(name);
        }

        // 为文件设置命令（点击打开）
        if (!stats.isDirectory()) {
            treeItem.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [treeItem.resourceUri]
            };
        }

        // 设置上下文值
        treeItem.contextValue = stats.isDirectory() ? 'directory' : 'file';

        // 设置注释（优先使用配置文件中的注释）
        let comment = '';
        
        // 检查配置文件中的注释
        if (this.commentMap) {
            comment = this.commentMap.get(relativePath) || '';
        }

        // 如果没有配置文件注释，检查 pages.json 中的标题
        if (!comment && this.pageMap) {
            const pathWithoutExt = relativePath.replace(/\.vue$/, '');
            for (const [pagePath, title] of this.pageMap.entries()) {
                if (pathWithoutExt.includes(pagePath)) {
                    comment = title;
                    break;
                }
            }
        }

        if (comment) {
            treeItem.description = comment;
        }

        return treeItem;
    }

    _getFileIcon(filename) {
        const ext = path.extname(filename).toLowerCase();
        const name = filename.toLowerCase();

        // 特殊文件名匹配
        switch (name) {
            case 'package.json':
            case 'package-lock.json':
                return new vscode.ThemeIcon('package');
            case '.gitignore':
                return new vscode.ThemeIcon('source-control');
            case 'readme.md':
                return new vscode.ThemeIcon('book');
            case '.env':
            case '.env.local':
            case '.env.development':
            case '.env.production':
                return new vscode.ThemeIcon('key');
            case 'dockerfile':
                return new vscode.ThemeIcon('container');
            case 'manifest.json':
                return new vscode.ThemeIcon('preview');
            case 'pages.json':
                return new vscode.ThemeIcon('layout');
        }

        // 扩展名匹配
        switch (ext) {
            // Web 相关
            case '.vue':
                return new vscode.ThemeIcon('symbol-event');
            case '.jsx':
            case '.tsx':
                return new vscode.ThemeIcon('symbol-misc');
            case '.html':
                return new vscode.ThemeIcon('symbol-structure');
            case '.css':
                return new vscode.ThemeIcon('symbol-color');
            case '.scss':
            case '.sass':
                return new vscode.ThemeIcon('symbol-color');
            case '.less':
                return new vscode.ThemeIcon('symbol-color');
            
            // 脚本语言
            case '.js':
                return new vscode.ThemeIcon('symbol-method');
            case '.ts':
                return new vscode.ThemeIcon('symbol-class');
            case '.py':
                return new vscode.ThemeIcon('symbol-namespace');
            case '.php':
                return new vscode.ThemeIcon('symbol-method');
            case '.rb':
                return new vscode.ThemeIcon('symbol-method');
            
            // 配置文件
            case '.json':
                return new vscode.ThemeIcon('bracket');
            case '.xml':
                return new vscode.ThemeIcon('symbol-structure');
            case '.yaml':
            case '.yml':
                return new vscode.ThemeIcon('list-tree');
            case '.toml':
                return new vscode.ThemeIcon('settings');
            
            // 样式文件
            case '.svg':
                return new vscode.ThemeIcon('type-hierarchy');
            case '.png':
            case '.jpg':
            case '.jpeg':
            case '.gif':
            case '.ico':
            case '.webp':
                return new vscode.ThemeIcon('symbol-file');
            
            // 字体文件
            case '.ttf':
            case '.otf':
            case '.woff':
            case '.woff2':
            case '.eot':
                return new vscode.ThemeIcon('text-size');
            
            // 文档
            case '.md':
                return new vscode.ThemeIcon('markdown');
            case '.pdf':
                return new vscode.ThemeIcon('file-pdf');
            case '.doc':
            case '.docx':
                return new vscode.ThemeIcon('file-text');
            case '.xls':
            case '.xlsx':
                return new vscode.ThemeIcon('table');
            case '.ppt':
            case '.pptx':
                return new vscode.ThemeIcon('preview');
            
            // 压缩文件
            case '.zip':
            case '.rar':
            case '.7z':
            case '.tar':
            case '.gz':
                return new vscode.ThemeIcon('archive');
            
            // 其他开发相关
            case '.sql':
                return new vscode.ThemeIcon('database');
            case '.sh':
            case '.bash':
                return new vscode.ThemeIcon('terminal');
            case '.bat':
            case '.cmd':
                return new vscode.ThemeIcon('terminal-cmd');
            case '.log':
                return new vscode.ThemeIcon('output');
            
            // 锁定文件
            case '.lock':
                return new vscode.ThemeIcon('lock');

            // 默认文件图标
            default:
                if (filename.startsWith('.')) {
                    return new vscode.ThemeIcon('gear');
                }
                return new vscode.ThemeIcon('file');
        }
    }

    startCreating(parentPath, type) {
        this.isCreatingNew = true;
        this.creatingParentPath = parentPath;
        this.creatingType = type;
        this.inputItem = null;
        this._onDidChangeTreeData.fire();
    }

    stopCreating() {
        this.isCreatingNew = false;
        this.creatingParentPath = null;
        this.creatingType = null;
        this.inputItem = null;
        this._onDidChangeTreeData.fire();
    }
}

function activate(context) {
    console.log('Activating extension...');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const rootPath = workspaceFolders[0].uri.fsPath;
        const treeDataProvider = new DirectoryTreeProvider(rootPath);
        
        // 初始化配置
        treeDataProvider.refresh();

        // 创建树视图
        const treeView = vscode.window.createTreeView('directoryExplorer', {
            treeDataProvider,
            canSelectMany: false
        });

        // 设置视图标题为项目名称
        const projectName = path.basename(rootPath);
        treeView.title = projectName;

        // 监听工作区变化
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) {
                const newRootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const newProjectName = path.basename(newRootPath);
                treeView.title = newProjectName;
                treeDataProvider.workspaceRoot = newRootPath;
                treeDataProvider.refresh();
            }
        });

        // 注册刷新命令
        let refreshCommand = vscode.commands.registerCommand('catalog-annotations.refresh', () => {
            treeDataProvider.refresh();
        });

        // 修改新建文件命令
        let newFileCommand = vscode.commands.registerCommand('catalog-annotations.newFile', async (node) => {
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
        });

        // 修改新建文件夹命令
        let newFolderCommand = vscode.commands.registerCommand('catalog-annotations.newFolder', async (node) => {
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
                        treeDataProvider.refresh();
                    } else {
                        vscode.window.showErrorMessage('文件夹已存在！');
                    }
                } catch (err) {
                    vscode.window.showErrorMessage(`创建文件夹失败: ${err.message}`);
                }
            }
        });

        // 在 Finder 中显示
        let revealInFinderCommand = vscode.commands.registerCommand('catalog-annotations.revealInFinder', (node) => {
            if (node && node.resourceUri) {
                vscode.commands.executeCommand('revealFileInOS', node.resourceUri);
            }
        });

        // 在集成终端中打开
        let openInTerminalCommand = vscode.commands.registerCommand('catalog-annotations.openInIntegratedTerminal', (node) => {
            if (node && node.resourceUri) {
                const terminal = vscode.window.createTerminal({
                    cwd: node.resourceUri.fsPath
                });
                terminal.show();
            }
        });

        // 在文件夹中查找
        let findInFolderCommand = vscode.commands.registerCommand('catalog-annotations.findInFolder', async (node) => {
            if (node && node.resourceUri) {
                await vscode.commands.executeCommand('workbench.action.findInFiles', {
                    query: '',
                    filesToInclude: node.resourceUri.fsPath
                });
            }
        });

        // 复制路径
        let copyPathCommand = vscode.commands.registerCommand('catalog-annotations.copyPath', (node) => {
            if (node && node.resourceUri) {
                vscode.env.clipboard.writeText(node.resourceUri.fsPath);
            }
        });

        // 复制相对路径
        let copyRelativePathCommand = vscode.commands.registerCommand('catalog-annotations.copyRelativePath', (node) => {
            if (node && node.resourceUri) {
                const relativePath = path.relative(workspaceFolders[0].uri.fsPath, node.resourceUri.fsPath);
                vscode.env.clipboard.writeText(relativePath);
            }
        });

        // 重命名
        let renameCommand = vscode.commands.registerCommand('catalog-annotations.rename', async (node) => {
            if (node && node.resourceUri) {
                const oldPath = node.resourceUri.fsPath;
                const oldName = path.basename(oldPath);
                const dirPath = path.dirname(oldPath);

                const newName = await vscode.window.showInputBox({
                    prompt: '输入新名称',
                    value: oldName,
                    validateInput: (value) => {
                        if (!value) return '名称不能为空';
                        if (value === oldName) return null;
                        const newPath = path.join(dirPath, value);
                        if (fs.existsSync(newPath)) return '文件/文件夹已存在';
                        return null;
                    }
                });

                if (newName && newName !== oldName) {
                    try {
                        const newPath = path.join(dirPath, newName);
                        fs.renameSync(oldPath, newPath);
                        treeDataProvider.refresh();
                    } catch (err) {
                        vscode.window.showErrorMessage(`重命名失败: ${err.message}`);
                    }
                }
            }
        });

        // 删除
        let deleteCommand = vscode.commands.registerCommand('catalog-annotations.delete', async (node) => {
            if (node && node.resourceUri) {
                const isDirectory = fs.statSync(node.resourceUri.fsPath).isDirectory();
                const confirmMessage = `确定要删除${isDirectory ? '文件夹' : '文件'} "${path.basename(node.resourceUri.fsPath)}" 吗？`;
                
                const choice = await vscode.window.showWarningMessage(
                    confirmMessage,
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
                        treeDataProvider.refresh();
                    } catch (err) {
                        vscode.window.showErrorMessage(`删除失败: ${err.message}`);
                    }
                }
            }
        });

        // 用于存储剪切/复制的文件信息
        let clipboardItem = null;
        let isCut = false;

        // 剪切命令
        let cutCommand = vscode.commands.registerCommand('catalog-annotations.cut', (node) => {
            if (node && node.resourceUri) {
                clipboardItem = node.resourceUri;
                isCut = true;
            }
        });

        // 复制命令
        let copyCommand = vscode.commands.registerCommand('catalog-annotations.copy', (node) => {
            if (node && node.resourceUri) {
                clipboardItem = node.resourceUri;
                isCut = false;
            }
        });

        // 粘贴命令
        let pasteCommand = vscode.commands.registerCommand('catalog-annotations.paste', async (node) => {
            if (!clipboardItem || !node || !node.resourceUri) {
                return;
            }

            const sourceUri = clipboardItem;
            const targetDir = node.resourceUri.fsPath;
            const sourcePath = sourceUri.fsPath;
            const fileName = path.basename(sourcePath);
            const targetPath = path.join(targetDir, fileName);

            try {
                // 检查目标路径是否已存
                if (fs.existsSync(targetPath)) {
                    const result = await vscode.window.showWarningMessage(
                        `${fileName} 已存在，是否替？`,
                        { modal: true },
                        '替换',
                        '取消'
                    );
                    if (result !== '替换') {
                        return;
                    }
                }

                const isDirectory = fs.statSync(sourcePath).isDirectory();

                // 复制或移动文件/目录
                if (isDirectory) {
                    // 使用递归函数复制目录
                    const copyDir = (src, dest) => {
                        if (!fs.existsSync(dest)) {
                            fs.mkdirSync(dest);
                        }
                        const entries = fs.readdirSync(src);
                        for (const entry of entries) {
                            const srcPath = path.join(src, entry);
                            const destPath = path.join(dest, entry);
                            const stat = fs.statSync(srcPath);
                            if (stat.isDirectory()) {
                                copyDir(srcPath, destPath);
                            } else {
                                fs.copyFileSync(srcPath, destPath);
                            }
                        }
                    };

                    if (isCut) {
                        // 移动目录
                        fs.renameSync(sourcePath, targetPath);
                    } else {
                        // 复制目录
                        copyDir(sourcePath, targetPath);
                    }
                } else {
                    if (isCut) {
                        // 移动文件
                        fs.renameSync(sourcePath, targetPath);
                    } else {
                        // 复制文件
                        fs.copyFileSync(sourcePath, targetPath);
                    }
                }

                // 如果是剪切操作，清除剪贴板
                if (isCut) {
                    clipboardItem = null;
                    isCut = false;
                }

                // 刷新树视图
                treeDataProvider.refresh();
            } catch (err) {
                vscode.window.showErrorMessage(`${isCut ? '移动' : '复制'}失败: ${err.message}`);
            }
        });

        // 注册项目名称栏的命令
        let projectHeaderNewFileCommand = vscode.commands.registerCommand(
            'catalog-annotations.projectHeader.newFile',
            () => vscode.commands.executeCommand('catalog-annotations.newFile')
        );

        let projectHeaderNewFolderCommand = vscode.commands.registerCommand(
            'catalog-annotations.projectHeader.newFolder',
            () => vscode.commands.executeCommand('catalog-annotations.newFolder')
        );

        let projectHeaderRefreshCommand = vscode.commands.registerCommand(
            'catalog-annotations.projectHeader.refresh',
            () => vscode.commands.executeCommand('catalog-annotations.refresh')
        );

        // 注册处理新建输入的命令
        let handleNewInputCommand = vscode.commands.registerCommand(
            'catalog-annotations.handleNewInput',
            async (parentPath, type) => {
                // 创建一个内联的输入框
                const inputBox = vscode.window.createTextEditorDecorationType({
                    before: {
                        contentText: type === 'file' ? '新建文件: ' : '新建文件夹: ',
                        color: new vscode.ThemeColor('foreground')
                    },
                    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
                });

                // 创建一个临时文档来处理输入
                const document = await vscode.workspace.openTextDocument({
                    content: '',
                    language: 'plaintext'
                });

                const editor = await vscode.window.showTextDocument(document, {
                    viewColumn: vscode.ViewColumn.Active,
                    preserveFocus: false,
                    preview: false
                });

                // 设置装饰器
                editor.setDecorations(inputBox, [new vscode.Range(0, 0, 0, 0)]);

                // 处理输入
                const disposables = [];
                try {
                    const name = await new Promise((resolve, reject) => {
                        // 处理文本变化
                        disposables.push(
                            vscode.workspace.onDidChangeTextDocument(e => {
                                if (e.document === document) {
                                    const text = e.document.getText().trim();
                                    if (text.includes('\n')) {
                                        // Enter 键被按下
                                        resolve(text.replace('\n', ''));
                                    }
                                }
                            })
                        );

                        // 处理编辑器关闭
                        disposables.push(
                            vscode.workspace.onDidCloseTextDocument(doc => {
                                if (doc === document) {
                                    reject();
                                }
                            })
                        );
                    });

                    if (name) {
                        const newPath = path.join(parentPath, name);
                        if (fs.existsSync(newPath)) {
                            vscode.window.showErrorMessage('已存在同名文件/文件夹');
                            return;
                        }

                        try {
                            if (type === 'file') {
                                fs.writeFileSync(newPath, '');
                                const doc = await vscode.workspace.openTextDocument(newPath);
                                await vscode.window.showTextDocument(doc);
                            } else {
                                fs.mkdirSync(newPath);
                            }
                        } catch (err) {
                            vscode.window.showErrorMessage(`创建失败: ${err.message}`);
                        }
                    }
                } finally {
                    // 清理
                    disposables.forEach(d => d.dispose());
                    inputBox.dispose();
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    treeDataProvider.stopCreating();
                    treeDataProvider.refresh();
                }
            }
        );

        // 将新命令添加到订阅列表
        context.subscriptions.push(
            treeView,
            refreshCommand,
            newFileCommand,
            newFolderCommand,
            revealInFinderCommand,
            openInTerminalCommand,
            findInFolderCommand,
            copyPathCommand,
            copyRelativePathCommand,
            renameCommand,
            deleteCommand,
            cutCommand,
            copyCommand,
            pasteCommand,
            projectHeaderNewFileCommand,
            projectHeaderNewFolderCommand,
            projectHeaderRefreshCommand,
            handleNewInputCommand
        );

        // 监听文件系统变化
        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        fileWatcher.onDidCreate(() => treeDataProvider.refresh());
        fileWatcher.onDidDelete(() => treeDataProvider.refresh());
        fileWatcher.onDidChange(() => treeDataProvider.refresh());

        // 监听 pages.json 和 directory-config.json 文件变化
        const configWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(rootPath, '{pages.json,directory-config.json}')
        );

        configWatcher.onDidChange(() => {
            console.log('Configuration file changed, refreshing tree view...');
            treeDataProvider.refresh();
        });

        context.subscriptions.push(fileWatcher, configWatcher);
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
}
