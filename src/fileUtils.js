// 文件操作相关功能
const fs = require('fs');
const path = require('path');

async function readUniappPages(rootPath) {
    const pagesPath = path.join(rootPath, 'pages.json');
    
    if (!fs.existsSync(pagesPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(pagesPath, 'utf-8');
        
        let pagesConfig;
        try {
            pagesConfig = JSON.parse(content);
        } catch (parseError) {
            if (process.env.NODE_ENV === 'development') {
                console.warn('Pages.json parse error:', parseError.message);
            }
            return null;
        }

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
        if (process.env.NODE_ENV === 'development') {
            console.warn('Error reading pages.json:', error.message);
        }
        return null;
    }
}

async function scanDirectory(rootPath) {
    if (!rootPath) {
        console.warn('Invalid root path for scanDirectory');
        return [];
    }

    try {
        async function scan(currentPath, relativePath) {
            const items = fs.readdirSync(currentPath);
            const directories = [];

            for (const item of items) {
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

function mergeDirectories(existing, current) {
    if (!Array.isArray(existing) || !Array.isArray(current)) {
        return current || [];
    }

    const mergedDirs = [];
    const existingMap = new Map(existing.map(dir => [dir.path, dir]));

    for (const currentDir of current) {
        const existingDir = existingMap.get(currentDir.path);
        if (existingDir) {
            mergedDirs.push({
                path: currentDir.path,
                comment: existingDir.comment || '',
                children: existingDir.children && currentDir.children ? 
                    mergeDirectories(existingDir.children, currentDir.children) : 
                    currentDir.children
            });
        } else {
            mergedDirs.push(currentDir);
        }
    }

    return mergedDirs;
}

module.exports = {
    readUniappPages,
    scanDirectory,
    mergeDirectories
}; 