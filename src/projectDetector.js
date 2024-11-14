// 项目类型检测相关功能
const fs = require('fs');
const path = require('path');

async function detectProjectType(rootPath) {
    try {
        const packageJsonPath = path.join(rootPath, 'package.json');
        const pubspecPath = path.join(rootPath, 'pubspec.yaml');
        const pomPath = path.join(rootPath, 'pom.xml');
        const gradlePath = path.join(rootPath, 'build.gradle');
        
        // 检查 package.json
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
            
            // 检查 Vue 版本
            if (dependencies['vue']) {
                const vueVersion = dependencies['vue'];
                if (vueVersion.startsWith('^3') || vueVersion.startsWith('~3')) {
                    return 'Vue 3';
                } else if (vueVersion.startsWith('^2') || vueVersion.startsWith('~2')) {
                    return 'Vue 2';
                }
            }
            
            // 检查 uni-app
            if (dependencies['@dcloudio/uni-app'] || dependencies['uni-app']) {
                return 'uni-app';
            }
            
            // 检查 React
            if (dependencies['react']) {
                return 'React';
            }

            // 检查 Angular
            if (dependencies['@angular/core']) {
                return 'Angular';
            }

            // 检查 Nuxt
            if (dependencies['nuxt'] || dependencies['nuxt3']) {
                return 'Nuxt';
            }

            // 检查 Next.js
            if (dependencies['next']) {
                return 'Next.js';
            }

            // 检查 Electron
            if (dependencies['electron']) {
                return 'Electron';
            }

            return 'JavaScript/Node.js';
        }
        
        // 检查 Flutter/Dart
        if (fs.existsSync(pubspecPath)) {
            return 'Flutter';
        }
        
        // 检查 Java
        if (fs.existsSync(pomPath)) {
            return 'Java (Maven)';
        }
        if (fs.existsSync(gradlePath)) {
            return 'Java (Gradle)';
        }

        // 进一步检查其他文件特征
        const files = fs.readdirSync(rootPath);
        if (files.some(file => file.endsWith('.go'))) {
            return 'Go';
        }
        if (files.some(file => file.endsWith('.py'))) {
            return 'Python';
        }
        if (files.some(file => file.endsWith('.php'))) {
            return 'PHP';
        }
        
        return 'Unknown';
    } catch (error) {
        console.error('Error detecting project type:', error);
        return 'Unknown';
    }
}

function getProjectTypeIcon(projectType) {
    switch (projectType.toLowerCase()) {
        case 'vue 2':
        case 'vue 3':
            return '$(vm)';
        case 'uni-app':
            return '$(device-mobile)';
        case 'react':
            return '$(react)';
        case 'angular':
            return '$(circuit-board)';
        case 'nuxt':
        case 'next.js':
            return '$(server)';
        case 'electron':
            return '$(desktop-download)';
        case 'flutter':
            return '$(layers)';
        case 'java (maven)':
        case 'java (gradle)':
            return '$(coffee)';
        case 'go':
            return '$(go)';
        case 'python':
            return '$(symbol-namespace)';
        case 'php':
            return '$(symbol-method)';
        case 'javascript/node.js':
            return '$(nodejs)';
        default:
            return '$(code)';
    }
}

module.exports = {
    detectProjectType,
    getProjectTypeIcon
}; 