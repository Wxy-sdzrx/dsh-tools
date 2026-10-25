/* 便捷插件 · 版本清单
   本文件由 release.ps1 自动生成，直接上传覆盖即可。 */

var DSH_LATEST = {
    version: '1.14.2',
    date: '2026-10-25',
    url: 'https://wxy-sdzrx.github.io/dsh-tools/BianjieTools-v1.14.2.zip',
    note: '三项可用性修复：① 分裂按钮上的序号格式现在会随选择实时更新（splitButton 子控件的 getLabel 需刷新根节点 dshSeqSplit 才生效，另加整表 Invalidate 兜底）。② 选完格式后等效执行一次填充序号：有选区立即按新格式填充/统一，无选区只记格式不插号（避免意外改动光标所在段）。③「清除回车空格」移入序号组，显示在填充序号正下方。',
    base: 'https://wxy-sdzrx.github.io/dsh-tools/',
    files: ['index.html', 'main.js', 'ribbon.xml', 'dialog_sum.html', 'dialog_update.html', 'updater.ps1', 'update.bat', 'update.vbs']
};