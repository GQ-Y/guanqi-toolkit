// 树视图提供者相关功能
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { readUniappPages } = require('./fileUtils');
const Config = require('./config');

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
        this.isRefreshing = false;
        this.refreshTimeout = null;
        this.lastRefreshTime = 0;
        
        // 检测是否是 Cursor
        this.isCursorEditor = vscode.env.appName.includes('Cursor');
        
        // 设置文件系统监听器
        this._setupFileWatcher();
    }

    _setupFileWatcher() {
        // 创建文件系统监听器
        const fileWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, '**/*')
        );

        // 监听文件变化
        fileWatcher.onDidChange(uri => {
            // 移除对 directory-config.json 的监听，因为已经在 extension.js 中处理了
            // 这里只处理其他文件的变化
            const fileName = path.basename(uri.fsPath);
            if (fileName !== 'directory-config.json') {
                this.debounceRefresh();
            }
        });
    }

    // 新增：防抖刷新方法
    debounceRefresh() {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }

        // 检查距离上次刷新的时间间隔
        const now = Date.now();
        if (now - this.lastRefreshTime < 1000) { // 1秒内不重复刷新
            console.log('跳过频繁刷新');
            return;
        }

        this.refreshTimeout = setTimeout(async () => {
            console.log('执行延迟刷新');
            await this.loadConfig();
            this._onDidChangeTreeData.fire();
            this.lastRefreshTime = Date.now();
        }, 500);  // 500ms 的防抖延迟
    }

    // 新增：加载配置文件
    async loadConfig() {
        if (this.isRefreshing) {
            console.log('配置加载正在进行中，跳过');
            return;
        }

        this.isRefreshing = true;
        console.log('开始加载配置');

        try {
            // 重新加载 uniapp 页面配置
            this.pageMap = await readUniappPages(this.workspaceRoot);

            // 重新加载目录配置
            const configPath = path.join(this.workspaceRoot, 'directory-config.json');
            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(content);
                console.log('已加载配置文件:', config);
                
                // 更新注释映射
                this.commentMap.clear();
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
                console.log('已更新注释映射:', this.commentMap);
            }
        } catch (error) {
            console.error('加载配置失败:', error);
        } finally {
            this.isRefreshing = false;
        }
    }

    async refresh() {
        // 如果已经在刷新中，直接返回
        if (this.isRefreshing) {
            console.log('刷新操作正在进行中，跳过');
            return;
        }

        // 检查刷新间隔
        const now = Date.now();
        if (now - this.lastRefreshTime < 1000) {
            console.log('跳过短时间内的重复刷新');
            return;
        }

        this.isRefreshing = true;
        console.log('开始刷新目录树');

        try {
            await this.loadConfig();
            this._onDidChangeTreeData.fire();
            this.lastRefreshTime = now;
        } catch (error) {
            console.error('刷新过程中发生错误:', error);
        } finally {
            this.isRefreshing = false;
        }
    }

    // 强制刷新方法
    async forceRefresh() {
        console.log('开始强制刷新目录树');
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }

        try {
            // 清除缓存
            this.commentMap.clear();
            this.pageMap = null;

            // 立即执行刷新
            await this.loadConfig();
            this._onDidChangeTreeData.fire();
            this.lastRefreshTime = Date.now();
            
            console.log('强制刷新完成');
        } catch (error) {
            console.error('强制刷新过程中发生错误:', error);
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

            if (!element.resourceUri || !element.resourceUri.scheme) {
                console.warn('Invalid URI or missing scheme:', element);
                return [];
            }

            const currentPath = element.resourceUri.fsPath;
            
            if (!currentPath) {
                console.warn('Invalid path:', element);
                return [];
            }

            if (this.isCreatingNew && currentPath === this.creatingParentPath) {
                const children = await this._getChildren(currentPath);
                
                const inputItem = new vscode.TreeItem('');
                inputItem.label = {
                    label: '',
                    highlights: [[0, 0]]
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

                return [inputItem, ...children];
            }

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
            // 根据配置过滤文件
            if (!Config.showHiddenFiles && item.startsWith('.')) {
                continue;
            }

            if (Config.excludePatterns.includes(item)) {
                continue;
            }

            const fullPath = path.join(currentPath, item);
            const stats = fs.statSync(fullPath);
            
            const treeItem = await this._createTreeItem(fullPath, item, stats);
            if (treeItem) {
                children.push(treeItem);
            }
        }

        // 根据配置排序
        return this._sortItems(children);
    }

    _sortItems(items) {
        const config = vscode.workspace.getConfiguration('guanqi-toolkit');
        const sortOrder = config.get('sortOrder');

        switch (sortOrder) {
            case 'type':
                return items.sort((a, b) => {
                    // 首先按目录/文件类型排序
                    const aIsDir = a.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed 
                        || a.collapsibleState === vscode.TreeItemCollapsibleState.Expanded;
                    const bIsDir = b.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed 
                        || b.collapsibleState === vscode.TreeItemCollapsibleState.Expanded;
                    
                    if (aIsDir !== bIsDir) {
                        return aIsDir ? -1 : 1;  // 目录排在前面
                    }
                    
                    // 如果都是文件，按扩展名排序
                    if (!aIsDir && !bIsDir) {
                        const aExt = path.extname(a.label || '').toLowerCase();
                        const bExt = path.extname(b.label || '').toLowerCase();
                        if (aExt !== bExt) {
                            return aExt.localeCompare(bExt);
                        }
                    }
                    
                    // 最后按名称排序
                    return a.label.localeCompare(b.label);
                });
            case 'name':
                return items.sort((a, b) => a.label.localeCompare(b.label));
            case 'size':
                // 实现按大小排序的逻辑
                return items;
            case 'date':
                // 实现按日期排序的逻辑
                return items;
            default:
                return items;
        }
    }

    async _createTreeItem(fullPath, name, stats) {
        if (!fullPath || !name) {
            console.warn('Invalid parameters for _createTreeItem:', { fullPath, name });
            return null;
        }

        try {
            const uri = vscode.Uri.file(fullPath);
            if (!uri || !uri.scheme) {
                console.warn('Failed to create valid URI for:', fullPath);
                return null;
            }

            const relativePath = path.relative(this.workspaceRoot, fullPath);
            
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

            const treeItem = new vscode.TreeItem(
                uri,
                stats.isDirectory() 
                    ? vscode.TreeItemCollapsibleState.Collapsed 
                    : vscode.TreeItemCollapsibleState.None
            );

            treeItem.label = name;

            // 根据配置设置图标
            if (Config.showFileIcons) {
                if (stats.isDirectory()) {
                    treeItem.iconPath = new vscode.ThemeIcon('folder');
                } else {
                    treeItem.iconPath = this._getFileIcon(name);
                }
            }

            // 根据配置设置注释
            if (Config.showComments && comment) {
                switch (Config.commentPosition) {
                    case 'tooltip':
                        treeItem.tooltip = comment;
                        break;
                    case 'inline':
                        treeItem.description = comment;
                        break;
                    case 'both':
                        treeItem.description = comment;
                        treeItem.tooltip = this._createTooltip(relativePath, comment, stats.isDirectory());
                        break;
                }
            }

            if (!stats.isDirectory()) {
                treeItem.command = {
                    command: 'vscode.open',
                    title: 'Open File',
                    arguments: [uri, {
                        preview: false,  // 不使用预览模式
                        viewColumn: vscode.ViewColumn.Active  // 在当前活动编辑器列打开
                    }]
                };
            }

            treeItem.contextValue = stats.isDirectory() ? 'directory' : 'file';

            return treeItem;
        } catch (error) {
            console.error('Error creating tree item:', error);
            return null;
        }
    }

    _getFileIcon(filename) {
        const ext = path.extname(filename).toLowerCase();
        const name = filename.toLowerCase();

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

        switch (ext) {
            case '.vue':
                return new vscode.ThemeIcon('symbol-event');
            case '.jsx':
            case '.tsx':
                return new vscode.ThemeIcon('symbol-misc');
            case '.html':
                return new vscode.ThemeIcon('symbol-structure');
            case '.css':
            case '.scss':
            case '.sass':
            case '.less':
                return new vscode.ThemeIcon('symbol-color');
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
            case '.json':
                return new vscode.ThemeIcon('bracket');
            case '.xml':
                return new vscode.ThemeIcon('symbol-structure');
            case '.yaml':
            case '.yml':
                return new vscode.ThemeIcon('list-tree');
            case '.toml':
                return new vscode.ThemeIcon('settings');
            case '.svg':
                return new vscode.ThemeIcon('type-hierarchy');
            case '.png':
            case '.jpg':
            case '.jpeg':
            case '.gif':
            case '.ico':
            case '.webp':
                return new vscode.ThemeIcon('symbol-file');
            case '.ttf':
            case '.otf':
            case '.woff':
            case '.woff2':
            case '.eot':
                return new vscode.ThemeIcon('text-size');
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
            case '.zip':
            case '.rar':
            case '.7z':
            case '.tar':
            case '.gz':
                return new vscode.ThemeIcon('archive');
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
            case '.lock':
                return new vscode.ThemeIcon('lock');
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

    _createTooltip(relativePath, comment, isDirectory) {
        const tooltipContent = new vscode.MarkdownString();
        tooltipContent.appendMarkdown(`
<div style="
    padding: 10px;
    border-radius: 6px;
    background-color: var(--vscode-editor-background);
    border: 1px solid var(--vscode-widget-border);
    box-shadow: 0 2px 8px var(--vscode-widget-shadow);
    min-width: 300px;
">

### ${isDirectory ? '目录说明' : '文件说明'}

---

**路径：** \`${relativePath}\`

**说明：** ${comment}

</div>
`);
        tooltipContent.supportHtml = true;
        tooltipContent.isTrusted = true;
        return tooltipContent;
    }
}

module.exports = DirectoryTreeProvider; 