const vscode = require('vscode');

class Config {
    static get configuration() {
        return vscode.workspace.getConfiguration('guanqi-toolkit');
    }

    static get excludePatterns() {
        return this.configuration.get('excludePatterns');
    }

    static get showHiddenFiles() {
        return this.configuration.get('showHiddenFiles');
    }

    static get sortOrder() {
        return this.configuration.get('sortOrder');
    }

    static get showFileIcons() {
        return this.configuration.get('showFileIcons');
    }

    static get showComments() {
        return this.configuration.get('showComments');
    }

    static get autoRefresh() {
        return this.configuration.get('autoRefresh');
    }

    static get commentPosition() {
        return this.configuration.get('commentPosition');
    }

    static get aiEnable() {
        return this.configuration.get('ai.enable');
    }

    static get aiProvider() {
        return this.configuration.get('ai.provider');
    }

    static get aiApiKey() {
        return this.configuration.get('ai.apiKey');
    }

    static get aiShowLogs() {
        return this.configuration.get('ai.showLogs');
    }

    // 监听配置变化
    static onConfigChange(context, callback) {
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('guanqi-toolkit')) {
                    callback();
                }
            })
        );
    }
}

module.exports = Config; 