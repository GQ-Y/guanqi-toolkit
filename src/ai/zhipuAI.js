const https = require('https');
const vscode = require('vscode');
const path = require('path');
const Config = require('../config');

class ZhipuAI {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.outputChannel = vscode.window.createOutputChannel('智谱 AI');
    }

    _log(message) {
        if (Config.aiShowLogs) {
            this.outputChannel.appendLine(message);
        }
    }

    async generateComment(dirPath, files) {
        if (Config.aiShowLogs) {
            this.outputChannel.show(true);
            this._log(`\n[${new Date().toLocaleString()}] 开始生成注释`);
            this._log(`目录路径: ${dirPath}`);
            this._log(`目录内容: ${JSON.stringify(files, null, 2)}`);
        }

        const prompt = this._generatePrompt(dirPath, files);
        this.currentPrompt = prompt[1].content;
        
        try {
            this._log('\n发送请求到智谱 AI...');
            this._log(`系统提示词: ${prompt[0].content}`);
            this._log(`用户提示词: ${prompt[1].content}`);

            const response = await this._makeRequest(prompt);
            this._log('\n收到 AI 响应:');
            this._log(JSON.stringify(response, null, 2));

            const comment = this._parseResponse(response);
            this._log(`\n生成的注释: ${comment}`);
            return comment;
        } catch (error) {
            this._log(`\n错误: ${error.message}`);
            this._log(error.stack);
            console.error('AI comment generation error:', error);
            throw new Error(`生成注释失败: ${error.message}`);
        }
    }

    _generatePrompt(dirPath, files) {
        // 系统角色设定
        const systemPrompt = {
            role: "system",
            content: `你是一位精通各类编程语言和框架的目录结构专家，需要为代码目录生成简短的中文注释。

严格要求：
1. 必须是中文注释
2. 最多8个汉字
3. 不带任何标点符号
4. 直接返回注释文本
5. 突出技术特点

目录命名规范参考：
- api/apis => 接口定义目录
- src => 源码主目录
- components => 组件目录
- utils => 工具函数库
- assets => 资源文件夹
- config => 配置目录
- test => 测试目录
- store/stores => 状态管理库
- hooks => 钩子函数库
- types => 类型定义库
- services => 服务层目录
- models => 数据模型层
- controllers => 控制器层
- middleware => 中间件目录
- routes => 路由配置层
- views => 视图模板层
- public => 公共资源库
- libs => 基础类库层
- plugins => 插件扩展层
- static => 静态资源库
- common => 通用代码库
- shared => 共享资源层
- core => 核心功能层
- modules => 功能模块层
- pages => 页面组件层
- layouts => 布局模板层
- styles => 样式资源层
- scripts => 脚本工具层
- docs => 文档资源层
- locales => 国际化配置
- constants => 常量定义层
- helpers => 辅助工具层
- interceptors => 拦截器层
- decorators => 装饰器层
- providers => 服务提供层
- repositories => 数据仓库层
- migrations => 数据迁移层
- seeds => 数据种子层
- schemas => 数据模式层
- dto => 数据传输层
- entities => 实体定义层
- guards => 守卫配置层
- filters => 过滤器层
- validators => 验证器层
- transformers => 转换器层
- subscribers => 订阅者层
- events => 事件处理层
- tasks => 任务处理层
- queues => 队列处理层
- cache => 缓存处理层
- logs => 日志处理层`
        };

        // 用户提示内容
        const userPrompt = {
            role: "user",
            content: `目录信息：
目录名称：${path.basename(dirPath)}
完整路径：${dirPath}
文件数量：${files.files.length}
子目录数量：${files.directories.length}

请根据目录名称和结构生成一个最多8个汉字的专业注释。

示例格式：
接口定义目录
状态管理仓库
工具函数集合
组件库目录
配置文件层
数据模型层

直接返回注释文本：`
        };

        return [systemPrompt, userPrompt];
    }

    async _makeRequest(messages) {
        const data = JSON.stringify({
            model: "glm-4",
            messages: [
                {
                    role: "system",
                    content: "你是一个专业的代码目录分析专家，需要为目录生成简短的中文注释。"
                },
                {
                    role: "user",
                    content: `请为以下目录生成注释：${messages[1].content}\n注意：直接返回注释文本，不要有任何额外说明。`
                }
            ],
            temperature: 0.7,
            max_tokens: 100,
            top_p: 0.95,
            stream: false
        });

        this._log('\n请求详情:');
        this._log(`URL: https://open.bigmodel.cn/api/paas/v4/chat/completions`);
        this._log(`Headers: Authorization: Bearer ${this.apiKey.substring(0, 8)}...`);
        this._log(`Body: ${data}`);

        const options = {
            hostname: 'open.bigmodel.cn',
            path: '/api/paas/v4/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                this._log(`\n响应状态码: ${res.statusCode}`);
                
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                    this._log(`收到数据块: ${chunk}`);
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        this._log('\n完整响应:');
                        this._log(JSON.stringify(response, null, 2));

                        if (response.error) {
                            reject(new Error(`API Error: ${response.error.message}`));
                            return;
                        }

                        resolve(response);
                    } catch (error) {
                        this._log(`\n解析响应失败: ${error.message}`);
                        reject(error);
                    }
                });
            });

            req.on('error', (error) => {
                this._log(`\n请求错误: ${error.message}`);
                reject(error);
            });

            req.write(data);
            req.end();
        });
    }

    _parseResponse(response) {
        this._log('\n解析响应...');
        
        if (response.choices && response.choices[0] && response.choices[0].message) {
            let comment = response.choices[0].message.content.trim();
            
            // 清理注释内容
            comment = comment
                // 移除引号
                .replace(/["""]/g, '')
                // 移除标点符号
                .replace(/[.。,，!！?？;；\s]/g, '')
                // 移除 markdown 标记
                .replace(/[*_`]/g, '')
                // 移除任何剩余的特殊字符
                .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');

            this._log(`原始注释: ${comment}`);
            
            // 如果清理后为空，使用默认注释
            if (!comment) {
                const defaultComments = {
                    'api': 'API接口定义目录',
                    'apis': 'REST API接口集合',
                    'src': '源代码主目录',
                    'components': '组件库目录',
                    'utils': '工具函数集合',
                    'assets': '静态资源文件',
                    'config': '配置文件目录',
                    'test': '测试用例目录',
                    'docs': '文档资源目录',
                    'styles': '样式文件目录',
                    'models': '数据模型定义',
                    'services': '服务层实现',
                    'controllers': '控制器目录',
                    'middleware': '中间件目录',
                    'routes': '路由配置目录',
                    'views': '视图模板目录',
                    'public': '公共资源目录',
                    'scripts': '脚本文件目录',
                    'lib': '库文件目录',
                    'vendor': '第三方依赖',
                    'dist': '构建输出目录',
                    'build': '构建配置目录'
                };

                const pathParts = this._getPathParts(this.currentPrompt || '');
                for (const part of pathParts) {
                    if (defaultComments[part.toLowerCase()]) {
                        comment = defaultComments[part.toLowerCase()];
                        break;
                    }
                }

                if (!comment) {
                    comment = '项目功能目录';
                }
            }

            // 确保注释长度不超过24个字符
            if (comment.length > 24) {
                comment = comment.substring(0, 24);
            }

            this._log(`处理后注释: ${comment}`);
            return comment;
        }
        
        this._log('响应格式无效');
        throw new Error('Invalid AI response');
    }

    _postProcessComment(comment) {
        this._log('\n后处理注释...');
        this._log(`处理前: ${comment}`);
        
        comment = comment.replace(/[.。,，!！?？;；\s]/g, '');
        this._log(`移除标点后: ${comment}`);
        
        if (comment.length > 20) {
            comment = comment.substring(0, 20);
            this._log(`截断长度后: ${comment}`);
        }
        
        comment = comment.replace(/[.。,，!！?？;；\s]$/, '');
        this._log(`最终结果: ${comment}`);
        
        return comment;
    }

    _getPathParts(content) {
        const pathMatch = content.match(/路径：([^\n]+)/);
        if (pathMatch) {
            return pathMatch[1].split('/').filter(Boolean);
        }
        return [];
    }
}

module.exports = ZhipuAI; 