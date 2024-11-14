const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// 读取 uniapp pages.json 文件
async function readUniappPages(rootPath) {
    const pagesPath = path.join(rootPath, 'pages.json');
    
    // 如果文件不存在，直接返回 null，不显示错误
    if (!fs.existsSync(pagesPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(pagesPath, 'utf-8');
        
        // 尝试解析 JSON
        let pagesConfig;
        try {
            pagesConfig = JSON.parse(content);
        } catch (parseError) {
            // 只在开发模式下显示警告
            if (process.env.NODE_ENV === 'development') {
                console.warn('Pages.json parse error:', parseError.message);
            }
            return null;
        }

        // 创建页面路径到标题的映射
        const pageMap = new Map();

        // 处理主包页面
        if (pagesConfig.pages && Array.isArray(pagesConfig.pages)) {
            pagesConfig.pages.forEach(page => {
                if (page && page.path && page.style && page.style.navigationBarTitleText) {
                    pageMap.set(page.path, page.style.navigationBarTitleText);
                }
            });
        }

        // 处理分包页面
        if (pagesConfig.subPackages && Array.isArray(pagesConfig.subPackages)) {
            pagesConfig.subPackages.forEach(subPackage => {
                if (subPackage && subPackage.root) {
                    const root = subPackage.root;
                    if (subPackage.pages && Array.isArray(subPackage.pages)) {
                        subPackage.pages.forEach(page => {
                            if (page && page.path && page.style && page.style.navigationBarTitleText) {
                                const fullPath = path.join(root, page.path);
                                pageMap.set(fullPath, page.style.navigationBarTitleText);
                            }
                        });
                    }
                }
            });
        }

        return pageMap;
    } catch (error) {
        // 只在开发模式下显示警告
        if (process.env.NODE_ENV === 'development') {
            console.warn('Error reading pages.json:', error.message);
        }
        return null;
    }
}

// 添加版本检测函数
function isCursor() {
    // 检查是否是 Cursor 环境
    return vscode.env.appName.includes('Cursor');
}

class DirectoryTreeProvider {
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.pageMap = null;
        this.commentMap = new Map();
        this.isCreatingNew = false;
        this.creatingParentPath = null;
        this.creatingType = null;
        this.inputItem = null;
        this.isRefreshing = false;  // 添加刷新状态标记
        
        // 检测是否是 Cursor
        this.isCursorEditor = isCursor();
        console.log('Is Cursor Editor:', this.isCursorEditor);
    }

    async refresh() {
        // 防止重复刷新
        if (this.isRefreshing) {
            return;
        }

        this.isRefreshing = true;
        try {
            // 使用 Promise.race 添加超时处理
            const timeout = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Refresh timeout')), 5000)
            );

            await Promise.race([
                this._refresh(),
                timeout
            ]);
        } catch (error) {
            // 只在开发模式下显示警告
            if (process.env.NODE_ENV === 'development') {
                console.warn('Refresh error:', error.message);
            }
        } finally {
            this.isRefreshing = false;
        }
    }

    async _refresh() {
        try {
            this.pageMap = await readUniappPages(this.workspaceRoot);
            const configPath = path.join(this.workspaceRoot, 'directory-config.json');
            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(content);
                
                // 将配置文件中的注释转换为 Map
                const updateCommentMap = (directories) => {
                    for (const dir of directories) {
                        if (dir.comment) {
                            this.commentMap.set(dir.path, dir.comment);
                        }
                        if (dir.children && dir.children.length > 0) {
                            updateCommentMap(dir.children);
                        }
                    }
                };

                if (config.directories) {
                    updateCommentMap(config.directories);
                }
            }
            this._onDidChangeTreeData.fire();
        } catch (error) {
            console.warn('Refresh error:', error);
        }
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
                    command: 'guanqi-toolkit.handleNewInput',
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
            // 添加 .DS_Store 到过滤列表
            if (item === 'node_modules' || 
                item === '.git' || 
                item === '.DS_Store') {  // 添加这一项
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
        try {
            // 首先验证参数
            if (!fullPath || !name || !stats) {
                console.warn('Invalid parameters for _createTreeItem:', { fullPath, name, stats });
                return null;
            }

            // 创建并验证 URI
            const uri = vscode.Uri.file(fullPath);
            if (!uri || !uri.scheme) {
                console.warn('Failed to create valid URI for:', fullPath);
                return null;
            }

            const relativePath = path.relative(this.workspaceRoot, fullPath);
            
            // 获取注释内容
            let comment = '';
            if (this.commentMap && this.commentMap.has(relativePath)) {
                comment = this.commentMap.get(relativePath);
            } else if (this.pageMap) {
                const pathWithoutExt = relativePath.replace(/\.vue$/, '');
                for (const [pagePath, title] of this.pageMap.entries()) {
                    if (pathWithoutExt.includes(pagePath)) {
                        comment = title;
                        break;
                    }
                }
            }

            // 使用验证过的 URI 创建 TreeItem
            const treeItem = new vscode.TreeItem(
                uri,  // 直接使用 URI 作为第一个参数
                stats.isDirectory() 
                    ? vscode.TreeItemCollapsibleState.Collapsed 
                    : vscode.TreeItemCollapsibleState.None
            );

            // 设置显示名称
            treeItem.label = name;

            // 设置图标
            if (stats.isDirectory()) {
                treeItem.iconPath = new vscode.ThemeIcon('folder');
            } else {
                treeItem.iconPath = this._getFileIcon(name);
            }

            // 设置注释和提示
            if (comment) {
                if (this.isCursorEditor) {
                    treeItem.description = '';
                } else {
                    treeItem.description = comment;
                }
                treeItem.tooltip = comment;
            }

            // 为文件设置打开命令
            if (!stats.isDirectory()) {
                treeItem.command = {
                    command: 'vscode.open',
                    title: 'Open File',
                    arguments: [uri]  // 使用验证过的 URI
                };
            }

            // 设置上下文值
            treeItem.contextValue = stats.isDirectory() ? 'directory' : 'file';

            return treeItem;
        } catch (error) {
            console.error('Error creating tree item:', {
                error: error.message,
                fullPath,
                name,
                stats: stats ? 'exists' : 'null'
            });
            return null;
        }
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

async function activate(context) {
    try {
        console.log('Activating extension...');

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const treeDataProvider = new DirectoryTreeProvider(rootPath);
        
        // 使用 Promise.all 处理并发操作
        await Promise.all([
            initializeOrUpdateConfig(rootPath, treeDataProvider).catch(error => {
                console.warn('Config initialization error:', error.message);
            }),
            treeDataProvider.refresh().catch(error => {
                console.warn('Initial refresh error:', error.message);
            })
        ]);

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
        let refreshCommand = vscode.commands.registerCommand('guanqi-toolkit.refresh', () => {
            treeDataProvider.refresh();
        });

        // 修改新建文件命令
        let newFileCommand = vscode.commands.registerCommand('guanqi-toolkit.newFile', async (node) => {
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

        // 修改新建文件��命令
        let newFolderCommand = vscode.commands.registerCommand('guanqi-toolkit.newFolder', async (node) => {
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
        let revealInFinderCommand = vscode.commands.registerCommand('guanqi-toolkit.revealInFinder', (node) => {
            if (node && node.resourceUri) {
                vscode.commands.executeCommand('revealFileInOS', node.resourceUri);
            }
        });

        // 在集成终端中打开
        let openInTerminalCommand = vscode.commands.registerCommand('guanqi-toolkit.openInIntegratedTerminal', (node) => {
            if (node && node.resourceUri) {
                const terminal = vscode.window.createTerminal({
                    cwd: node.resourceUri.fsPath
                });
                terminal.show();
            }
        });

        // 在文件夹中查找
        let findInFolderCommand = vscode.commands.registerCommand('guanqi-toolkit.findInFolder', async (node) => {
            if (node && node.resourceUri) {
                await vscode.commands.executeCommand('workbench.action.findInFiles', {
                    query: '',
                    filesToInclude: node.resourceUri.fsPath
                });
            }
        });

        // 复制路径
        let copyPathCommand = vscode.commands.registerCommand('guanqi-toolkit.copyPath', (node) => {
            if (node && node.resourceUri) {
                vscode.env.clipboard.writeText(node.resourceUri.fsPath);
            }
        });

        // 复制相对路径
        let copyRelativePathCommand = vscode.commands.registerCommand('guanqi-toolkit.copyRelativePath', (node) => {
            if (node && node.resourceUri) {
                const relativePath = path.relative(workspaceFolders[0].uri.fsPath, node.resourceUri.fsPath);
                vscode.env.clipboard.writeText(relativePath);
            }
        });

        // 重命名
        let renameCommand = vscode.commands.registerCommand('guanqi-toolkit.rename', async (node) => {
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
        let deleteCommand = vscode.commands.registerCommand('guanqi-toolkit.delete', async (node) => {
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

        // 用于存剪切/复制的文件信息
        let clipboardItem = null;
        let isCut = false;

        // 剪切命令
        let cutCommand = vscode.commands.registerCommand('guanqi-toolkit.cut', (node) => {
            if (node && node.resourceUri) {
                clipboardItem = node.resourceUri;
                isCut = true;
            }
        });

        // 复制命令
        let copyCommand = vscode.commands.registerCommand('guanqi-toolkit.copy', (node) => {
            if (node && node.resourceUri) {
                clipboardItem = node.resourceUri;
                isCut = false;
            }
        });

        // 粘贴命令
        let pasteCommand = vscode.commands.registerCommand('guanqi-toolkit.paste', async (node) => {
            if (!clipboardItem || !node || !node.resourceUri) {
                return;
            }

            const sourceUri = clipboardItem;
            const targetDir = node.resourceUri.fsPath;
            const sourcePath = sourceUri.fsPath;
            const fileName = path.basename(sourcePath);
            const targetPath = path.join(targetDir, fileName);

            try {
                // 检查目标路径是否已
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

                // 复制移动文件/目录
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
            'guanqi-toolkit.projectHeader.newFile',
            () => vscode.commands.executeCommand('guanqi-toolkit.newFile')
        );

        let projectHeaderNewFolderCommand = vscode.commands.registerCommand(
            'guanqi-toolkit.projectHeader.newFolder',
            () => vscode.commands.executeCommand('guanqi-toolkit.newFolder')
        );

        let projectHeaderRefreshCommand = vscode.commands.registerCommand(
            'guanqi-toolkit.projectHeader.refresh',
            () => vscode.commands.executeCommand('guanqi-toolkit.refresh')
        );

        // 注册理新建输入的命令
        let handleNewInputCommand = vscode.commands.registerCommand(
            'guanqi-toolkit.handleNewInput',
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
                                        // Enter 键被按
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

        // 注册初始化配置文件命令
        let initConfigCommand = vscode.commands.registerCommand('guanqi-toolkit.initConfig', async () => {
            try {
                console.log('Executing initConfig command...');
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    vscode.window.showErrorMessage('请先打开一个工作区文夹！');
                    return;
                }

                const rootPath = workspaceFolders[0].uri.fsPath;
                const configPath = path.join(rootPath, 'directory-config.json');

                // 检查配置文件是否存在
                if (fs.existsSync(configPath)) {
                    const choice = await vscode.window.showWarningMessage(
                        '配置文件已存在，是否要重新创建？',
                        '是',
                        '否'
                    );
                    if (choice !== '是') {
                        return;
                    }
                }

                // 扫描目录结构
                let directoryStructure;
                try {
                    directoryStructure = await scanDirectory(rootPath);
                } catch (scanError) {
                    console.error('Error scanning directory:', scanError);
                    vscode.window.showErrorMessage(`扫描目录失败: ${scanError.message}`);
                    return;
                }

                // 创建配置文件
                const config = {
                    version: '1.0',
                    directories: directoryStructure || []
                };

                // 写配置文件
                try {
                    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                    console.log('Config file created successfully');
                    vscode.window.showInformationMessage('配置文件已创建成功！');
                    
                    // 延迟刷新树视图
                    setTimeout(() => {
                        try {
                            treeDataProvider.refresh();
                        } catch (refreshError) {
                            console.warn('Error refreshing tree view:', refreshError);
                        }
                    }, 100);
                } catch (writeError) {
                    console.error('Error writing config file:', writeError);
                    vscode.window.showErrorMessage(`创建配置文件失败: ${writeError.message}`);
                    return;
                }
            } catch (error) {
                console.error('Error in initConfig command:', error);
                vscode.window.showErrorMessage(`初始化配置失败: ${error.message}`);
            }
        });

        // 目录扫描函数
        async function scanDirectory(rootPath) {
            try {
                async function scan(currentPath, relativePath) {
                    const items = fs.readdirSync(currentPath);
                    const directories = [];

                    for (const item of items) {
                        // 忽略隐藏文件和特定目录
                        if (item.startsWith('.') || 
                            item === 'node_modules' || 
                            item === 'dist' || 
                            item === 'build') {
                            continue;
                        }

                        const fullPath = path.join(currentPath, item);
                        const itemRelativePath = path.join(relativePath, item);
                        
                        try {
                            const stats = fs.statSync(fullPath);
                            if (stats.isDirectory()) {
                                const children = await scan(fullPath, itemRelativePath);
                                directories.push({
                                    path: itemRelativePath,
                                    comment: '',
                                    children: children
                                });
                            }
                        } catch (err) {
                            console.warn(`Skipping ${fullPath}: ${err.message}`);
                        }
                    }

                    return directories;
                }

                return await scan(rootPath, '');
            } catch (error) {
                console.error('Error scanning directory:', error);
                return [];
            }
        }

        // 添加目录结构合并函数
        function mergeDirectories(existing, current) {
            const mergedDirs = [];
            const existingMap = new Map(existing.map(dir => [dir.path, dir]));

            for (const currentDir of current) {
                const existingDir = existingMap.get(currentDir.path);
                if (existingDir) {
                    // 保留现有注释
                    mergedDirs.push({
                        path: currentDir.path,
                        comment: existingDir.comment || '',
                        children: existingDir.children && currentDir.children ? 
                            mergeDirectories(existingDir.children, currentDir.children) : 
                            currentDir.children
                    });
                } else {
                    // 添加新目录
                    mergedDirs.push(currentDir);
                }
            }

            return mergedDirs;
        }

        // 添加配置文件初始化或更新函数
        async function initializeOrUpdateConfig(rootPath, treeDataProvider) {
            const configPath = path.join(rootPath, 'directory-config.json');
            
            try {
                let config;
                if (fs.existsSync(configPath)) {
                    // 读取现有配置
                    const content = fs.readFileSync(configPath, 'utf8');
                    config = JSON.parse(content);
                    
                    // 扫描当前目录结构
                    const currentStructure = await scanDirectory(rootPath);
                    
                    // 更新配置，保留现有注释
                    config.directories = mergeDirectories(config.directories, currentStructure);
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
                treeDataProvider.refresh();
            } catch (error) {
                console.error('Error initializing/updating config:', error);
                vscode.window.showErrorMessage(`配置文件初始化/更新失败: ${error.message}`);
            }
        }

        // 注册所有命令
        let commands = [
            // 基本操作命令
            vscode.commands.registerCommand('guanqi-toolkit.refresh', () => {
                treeDataProvider.refresh();
            }),

            // 文件操作命令
            vscode.commands.registerCommand('guanqi-toolkit.revealInFinder', (node) => {
                if (node && node.resourceUri) {
                    vscode.commands.executeCommand('revealFileInOS', node.resourceUri);
                }
            }),

            vscode.commands.registerCommand('guanqi-toolkit.openInIntegratedTerminal', (node) => {
                if (node && node.resourceUri) {
                    const terminal = vscode.window.createTerminal({
                        cwd: node.resourceUri.fsPath
                    });
                    terminal.show();
                }
            }),

            vscode.commands.registerCommand('guanqi-toolkit.findInFolder', async (node) => {
                if (node && node.resourceUri) {
                    await vscode.commands.executeCommand('workbench.action.findInFiles', {
                        query: '',
                        filesToInclude: node.resourceUri.fsPath
                    });
                }
            }),

            // 剪贴板操作命令
            vscode.commands.registerCommand('guanqi-toolkit.copyPath', (node) => {
                if (node && node.resourceUri) {
                    vscode.env.clipboard.writeText(node.resourceUri.fsPath);
                }
            }),

            vscode.commands.registerCommand('guanqi-toolkit.copyRelativePath', (node) => {
                if (node && node.resourceUri) {
                    const relativePath = path.relative(workspaceFolders[0].uri.fsPath, node.resourceUri.fsPath);
                    vscode.env.clipboard.writeText(relativePath);
                }
            }),

            // 编辑操作命令
            vscode.commands.registerCommand('guanqi-toolkit.rename', async (node) => {
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
            }),

            vscode.commands.registerCommand('guanqi-toolkit.delete', async (node) => {
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
            }),

            // 剪切、复制、粘贴命令
            vscode.commands.registerCommand('guanqi-toolkit.cut', (node) => {
                if (node && node.resourceUri) {
                    clipboardItem = node.resourceUri;
                    isCut = true;
                }
            }),

            vscode.commands.registerCommand('guanqi-toolkit.copy', (node) => {
                if (node && node.resourceUri) {
                    clipboardItem = node.resourceUri;
                    isCut = false;
                }
            }),

            vscode.commands.registerCommand('guanqi-toolkit.paste', async (node) => {
                if (!clipboardItem || !node || !node.resourceUri) {
                    return;
                }

                const sourceUri = clipboardItem;
                const targetDir = node.resourceUri.fsPath;
                const sourcePath = sourceUri.fsPath;
                const fileName = path.basename(sourcePath);
                const targetPath = path.join(targetDir, fileName);

                try {
                    // 检查目标路径是否已
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

                    // 复制移动文件/目录
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
            })
        ];

        // 将所有命令添加到订阅列表
        context.subscriptions.push(...commands);

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

        // 添加错误处理的监听器
        process.on('unhandledRejection', (reason, promise) => {
            console.warn('Unhandled Rejection at:', promise, 'reason:', reason);
        });

    } catch (error) {
        console.error('Activation error:', error.message);
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
}
