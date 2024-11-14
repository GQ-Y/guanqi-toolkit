// 树视图提供者相关功能
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { readUniappPages } = require('./fileUtils');

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
        
        // 检测是否是 Cursor
        this.isCursorEditor = vscode.env.appName.includes('Cursor');
        console.log('Is Cursor Editor:', this.isCursorEditor);
    }

    async refresh() {
        if (this.isRefreshing) {
            return;
        }

        this.isRefreshing = true;
        try {
            const timeout = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Refresh timeout')), 5000)
            );

            await Promise.race([
                this._refresh(),
                timeout
            ]);
        } catch (error) {
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
            if (item === 'node_modules' || 
                item === '.git' || 
                item === '.DS_Store') {
                continue;
            }

            const fullPath = path.join(currentPath, item);
            const stats = fs.statSync(fullPath);
            
            const treeItem = await this._createTreeItem(fullPath, item, stats);
            if (treeItem) {
                children.push(treeItem);
            }
        }

        return children.sort((a, b) => {
            const aIsDir = a.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed;
            const bIsDir = b.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed;
            if (aIsDir !== bIsDir) {
                return aIsDir ? -1 : 1;
            }
            return a.label.localeCompare(b.label);
        });
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

            if (stats.isDirectory()) {
                treeItem.iconPath = new vscode.ThemeIcon('folder');
            } else {
                treeItem.iconPath = this._getFileIcon(name);
            }

            if (comment) {
                if (this.isCursorEditor) {
                    treeItem.description = '';
                } else {
                    treeItem.description = comment;
                }

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

### ${stats.isDirectory() ? '目录说明' : '文件说明'}

---

**路径：** \`${relativePath}\`

**说明：** ${comment}

</div>
`);
                tooltipContent.supportHtml = true;
                tooltipContent.isTrusted = true;
                treeItem.tooltip = tooltipContent;
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
}

module.exports = DirectoryTreeProvider; 