// 存放全局变量
let clipboardItem = null;  // 用于存储剪切/复制的文件
let isCut = false;        // 标记是剪切还是复制操作

// 导出变量的 getter 和 setter
module.exports = {
    get clipboardItem() {
        return clipboardItem;
    },
    set clipboardItem(value) {
        clipboardItem = value;
    },
    get isCut() {
        return isCut;
    },
    set isCut(value) {
        isCut = value;
    }
}; 