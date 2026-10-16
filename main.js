/* ============================================================
 * 便捷插件 · WPS 文字加载项   （根目录入口脚本）
 * 千分符 / 乘以一万 / 除以一万
 * ------------------------------------------------------------
 * 由 index.html 通过 <script src="main.js"> 引入。
 * 功能区回调必须声明在【顶层】——顶层 function 在有 <script> 的页面里
 * 会成为 window 的属性，WPS 解析 ribbon.xml 时才能按名字找到它们。
 *
 * 【重要】WPS JSAPI 的绝大多数属性访问都返回 Promise，必须 await。
 * 本文件统一通过 R()/P() 取值，不要直接点属性。
 * ============================================================ */

/* ----------------------- 可调参数 ----------------------- */
var DSH_OPTIONS = {
    decimals: 2,            // 【三个数字功能统一用它】固定保留的小数位：
                            //   2 = 千分符补/舍到两位，乘除一万也舍到两位
                            //  -1 = 千分符只加分隔符不改数值，乘除保持计算原样
                            //   0 / 4 亦可
    autoThousands: true,    // 换算后自动补千分符
    skipYear: false,        // 【默认关】把 1900-2199 的裸四位数一律当年份跳过。
                            // 默认关的理由：报告里的日期都有「年/月/日」等显式标记，
                            // 已由 skipDate 覆盖；裸四位数（2024、2026）是数字，
                            // 不该靠"区间猜测"决定动不动它。确有需要再打开。
    skipDate: true,         // 跳过日期 / 年月日
    skipDocNo: true,        // 跳过文号、第X号、第X条
    skipSection: true,      // 跳过章节号 1.2.3
    skipPercent: true,      // 跳过百分比
    skipLongDigits: true,   // 跳过长数字串（身份证 / 信用代码）
    longDigitMin: 15,       // 长数字串阈值（位数）
    skipIdLike: true,       // 证件类（身份证/统一社会信用代码/护照号）一律不动，不受选区影响
    seqStart: 1,            // 填充序号的起始值
    seqRenumberAll: false,  // true = 选区内有内容的数字格也一律重新编号；
                            // false = 保留原有数值，只重新套用选定格式
    updateCheck: true,      // 启动后检查一次新版本。失败【完全静默】，绝不影响任何功能
    useUpdater: true        // 发现新版就【自动下载并覆盖安装】，无需用户操作。
                            // 走 fetch 下载（GitHub Pages 送 ACAO:*，file:// 页面也能取）
                            // + WPS JSAPI 的 FileSystem.writeFileString 落盘。
                            // 任何一步失败即中止，绝不留下半新半旧的安装目录。
};

/* 版本与加载项目录名。改版本时必须同步改这两行、以及各安装脚本里的 $Version——
   test.js 里有断言守住这两处一致，防止升级时漏改。 */
var DSH_VERSION = '1.8.7';
var DSH_ADDON_DIR = 'BianjieTools_' + DSH_VERSION;

/* ======================= 引擎（与平台无关，可在 Node 下测试） ======================= */
var DshEngine = (function () {
    'use strict';

    function buildPatterns(o) {
        var p = [];
        if (o.skipDate) {
            p.push(/\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?/g);
            p.push(/\d{4}\s*年(?:\s*\d{1,2}\s*月)?(?:\s*\d{1,2}\s*日)?/g);
            p.push(/\d{1,2}\s*月\s*\d{1,2}\s*日/g);
        }
        if (o.skipDocNo) {
            p.push(/[〔\[（(]\s*\d{4}\s*[〕\]）)]\s*第?\s*\d+\s*号/g);
            p.push(/第\s*\d+\s*号/g);
            p.push(/第\s*[0-9一二三四五六七八九十百]+\s*[条章节款项编]/g);
        }
        if (o.skipSection) p.push(/\d+(?:\.\d+){2,}/g);

        /* 证件类一律不动，且【不受选区影响】。
           早期版本有「有选区就放开长数字串限制」的逻辑，导致选中一列
           身份证再点千分符，保护正好被关掉。选中一列 ≠ 这一列每个数字都要改格式。 */
        if (o.skipIdLike !== false) {
            p.push(/[0-9A-HJ-NPQRTUWXY]{18}/g);              // 统一社会信用代码（官方字符集）
            p.push(/\d{17}[\dXx](?![\dXx])/g);               // 18 位身份证（末位可能为 X）
            p.push(/\d{15}(?!\d)/g);                         // 15 位旧身份证
            p.push(/[A-Za-z]\d{6,}/g);                       // 字母开头的编号（护照/学号等）
        }
        if (o.skipLongDigits) {
            var n = o.longDigitMin || 15;
            p.push(new RegExp('\\d{' + n + ',}', 'g'));      // 兜底：15 位以上纯数字一律不动
            p.push(/\d{3,4}\s*[-–—]\s*\d{7,8}/g);
            p.push(/1[3-9]\d{9}/g);
        }
        if (o.skipPercent) p.push(/\d+(?:\.\d+)?\s*[%％‰]/g);
        p.push(/\d{1,3}\s*[:：]\s*\d{1,3}/g);
        return p;
    }

    function buildMask(t, o) {
        var mask = new Uint8Array(t.length);
        var pats = buildPatterns(o);
        for (var k = 0; k < pats.length; k++) {
            var rx = pats[k], m;
            rx.lastIndex = 0;
            while ((m = rx.exec(t)) !== null) {
                var end = m.index + m[0].length;
                for (var i = m.index; i < end && i < mask.length; i++) mask[i] = 1;
                if (m[0].length === 0) rx.lastIndex++;
            }
        }
        return mask;
    }

    function group(num) {
        var dot = num.indexOf('.');
        var ip = dot >= 0 ? num.slice(0, dot) : num;
        var fp = dot >= 0 ? num.slice(dot) : '';
        var sb = '', c = 0;
        for (var i = ip.length - 1; i >= 0; i--) {
            sb = ip.charAt(i) + sb;
            c++;
            if (c % 3 === 0 && i > 0) sb = ',' + sb;
        }
        return sb + fp;
    }

    function roundHalfAway(v, dec) {
        var f = Math.pow(10, dec);
        var x = v * f;
        var r = Math.floor(Math.abs(x) + 0.5);
        return (v < 0 ? -r : r) / f;
    }

    /* 十进制字符串 +1（带进位）。用于字符串层面的四舍五入，避开浮点误差 */
    function incDigits(s) {
        var a = String(s).split('');
        var i = a.length - 1;
        while (i >= 0) {
            if (a[i] === '9') { a[i] = '0'; i--; }
            else { a[i] = String.fromCharCode(a[i].charCodeAt(0) + 1); break; }
        }
        if (i < 0) a.unshift('1');
        return a.join('');
    }

    /* 把纯数字串（无符号、无逗号）固定到 dec 位小数，四舍五入。
       刻意做字符串运算而不是 Number+toFixed：14 位整数再带小数会超出
       双精度有效位，Number 路径在边界上会悄悄丢精度。 */
    function fixDecimals(numStr, dec) {
        var s = String(numStr);
        var dot = s.indexOf('.');
        var ip = dot >= 0 ? s.slice(0, dot) : s;
        var fp = dot >= 0 ? s.slice(dot + 1) : '';
        if (ip === '') ip = '0';
        if (dec <= 0) {
            if (fp && fp.charAt(0) >= '5') ip = incDigits(ip);
            return ip;
        }
        if (fp.length === dec) return ip + '.' + fp;
        if (fp.length > dec) {
            var keep = fp.slice(0, dec);
            if (fp.charAt(dec) >= '5') {
                keep = incDigits(keep);
                if (keep.length > dec) {          // 进位溢出，如 .99 -> 1.00
                    ip = incDigits(ip);
                    keep = keep.slice(1);
                }
            }
            return ip + '.' + keep;
        }
        while (fp.length < dec) fp += '0';
        return ip + '.' + fp;
    }

    function plainStr(v) {
        var s = String(v);
        if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) {
            s = v.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
        }
        return s;
    }

    function excluded(t, start, len, plain, intLen, o) {
        var before = start > 0 ? t.charAt(start - 1) : '';
        var after = start + len < t.length ? t.charAt(start + len) : '';

        if (/^[A-Za-z]$/.test(before)) return true;
        if (/^[A-Za-z]$/.test(after)) return true;

        if (o.skipPercent && (after === '%' || after === '％' || after === '‰')) return true;
        if (o.skipDate && (after === '年' || after === '月' || after === '日')) return true;
        // 注意：indexOf('') === 0，必须先判空串，否则行尾数字会被误跳过
        if (o.skipDocNo && after !== '' && '号条款项章节'.indexOf(after) >= 0) return true;

        if (o.skipYear && intLen === 4 && plain.length === 4) {
            var y = parseInt(plain, 10);
            if (y >= 1900 && y <= 2199) {
                var unitAfter = after !== '' && '元万亿千美港欧'.indexOf(after) >= 0;
                var unitBefore = before !== '' && ('¥￥$'.indexOf(before) >= 0 || before === '元');
                if (!unitAfter && !unitBefore) return true;
            }
        }
        return false;
    }

    function convertToken(t, idx, raw, mode, o) {
        var sign = '', body = raw;
        if (body.length && '–—−-'.indexOf(body.charAt(0)) >= 0) {
            sign = body.charAt(0);
            body = body.slice(1);
        }
        if (!body.length) return null;

        var plain = body.replace(/,/g, '');
        var dot = plain.indexOf('.');
        var intLen = dot >= 0 ? dot : plain.length;
        if (intLen === 0) return null;

        if (excluded(t, idx, raw.length, plain, intLen, o)) return null;

        if (mode === 'thousands') {
            if (o.decimals >= 0) {
                // 带小数的短数字也要规范：3.1415926 → 3.14、12.5 → 12.50。
                // 但不足 4 位的**纯整数**不动，否则"共123处"会变成"共123.00处"。
                // （旧版把 intLen<4 挡在最前面，3.1415926 连四舍五入都轮不到。）
                if (intLen < 4 && plain.indexOf('.') < 0) return null;
                return sign + group(fixDecimals(plain, o.decimals));
            }
            if (intLen < 4) return null;
            return sign + group(plain);          // decimals=-1：只加分隔符，不改数值
        }

        var d = Number(plain);
        if (!isFinite(d)) return null;
        var v = (mode === 'mul') ? d * 10000 : d / 10000;
        if (!isFinite(v) || Math.abs(v) > 1e15) return null;

        var out;
        if (o.decimals < 0) {
            out = plainStr(v);
            if (o.autoThousands) out = group(out);
        } else {
            v = roundHalfAway(v, o.decimals);
            out = v.toFixed(o.decimals);
            if (o.autoThousands) out = group(out);
        }
        return sign + out;
    }

    function compute(t, mode, o) {
        var res = [];
        if (!t) return res;
        var mask = buildMask(t, o);
        var rx = /[-–—−]?\d[\d,]*(?:\.\d+)?/g;
        var m;
        while ((m = rx.exec(t)) !== null) {
            var s = m.index, len = m[0].length, masked = false;
            for (var i = s; i < s + len; i++) { if (mask[i]) { masked = true; break; } }
            if (masked) continue;
            var conv = convertToken(t, s, m[0], mode, o);
            if (conv !== null && conv !== m[0]) {
                res.push({ start: s, length: len, old: m[0], neu: conv });
            }
        }
        return res;
    }

    function applyChanges(t, changes) {
        var sb = '', pos = 0;
        for (var i = 0; i < changes.length; i++) {
            var c = changes[i];
            if (pos > c.start) continue;
            sb += t.slice(pos, c.start) + c.neu;
            pos = c.start + c.length;
        }
        return sb + t.slice(pos);
    }

    /* ---------------- 序号填充（纯逻辑，可单测） ---------------- */

    var CN_DIGITS = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

    function cnFromNumber(n) {
        var d = '零一二三四五六七八九';
        if (n <= 0) return String(n);
        if (n < 10) return d.charAt(n);
        if (n === 10) return '十';
        if (n < 20) return '十' + d.charAt(n - 10);
        if (n < 100) {
            var t = Math.floor(n / 10), o = n % 10;
            return d.charAt(t) + '十' + (o ? d.charAt(o) : '');
        }
        return String(n);
    }

    function cnToNumber(s) {
        if (!/^[零一二两三四五六七八九十]+$/.test(s)) return null;
        if (s === '十') return 10;
        var i = s.indexOf('十');
        if (i < 0) return s.length === 1 ? CN_DIGITS[s] : null;
        var tens = i === 0 ? 1 : CN_DIGITS[s.charAt(i - 1)];
        var ones = i === s.length - 1 ? 0 : CN_DIGITS[s.charAt(i + 1)];
        if (tens === undefined || ones === undefined) return null;
        return tens * 10 + ones;
    }

    function alphaFromNumber(n) {
        var s = '';
        while (n > 0) {
            var r = (n - 1) % 26;
            s = String.fromCharCode(65 + r) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    /* 带圈 / 带括号 / 带点数字：①..⑳ ⑴..⒇ ⒈..⒛ */
    function circledToNumber(s) {
        if (s.length !== 1) return null;
        var c = s.charCodeAt(0);
        if (c >= 0x2460 && c <= 0x2473) return c - 0x2460 + 1;
        if (c >= 0x2474 && c <= 0x2487) return c - 0x2474 + 1;
        if (c >= 0x2488 && c <= 0x249B) return c - 0x2488 + 1;
        return null;
    }

    /* 把单元格文本解析成序号数字；解析不出返回 null（表头、说明文字等） */
    function seqParse(raw) {
        var t = String(raw == null ? '' : raw).replace(/[\s\r\n\u0007\u0001\u0002]/g, '');
        if (!t) return null;
        t = t.replace(/^[（(【\[]+/, '').replace(/[）)】\]]+$/, '');
        t = t.replace(/^第/, '').replace(/[项条号]$/, '');
        t = t.replace(/^[、.．,，:：]+/, '').replace(/[、.．,，:：]+$/, '');
        if (!t) return null;
        var cir = circledToNumber(t);
        if (cir !== null) return cir;
        // 全角数字转半角
        t = t.replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
        if (/^\d+$/.test(t)) return parseInt(t, 10);
        return cnToNumber(t);
    }

    /* 序号格式表：label 给下拉列表显示，fmt 决定第 n 项长什么样 */
    var SEQ_FORMATS = [
        { id: 'n',    label: '1   2   3',           fmt: function (n) { return String(n); } },
        { id: 'n2',   label: '01   02   03',        fmt: function (n) { return (n < 10 ? '0' : '') + n; } },
        { id: 'nd',   label: '1、  2、  3、',         fmt: function (n) { return n + '、'; } },
        { id: 'np',   label: '（1）（2）（3）',       fmt: function (n) { return '（' + n + '）'; } },
        { id: 'cn',   label: '一   二   三',         fmt: function (n) { return cnFromNumber(n); } },
        { id: 'cnp',  label: '（一）（二）（三）',     fmt: function (n) { return '（' + cnFromNumber(n) + '）'; } },
        { id: 'circ', label: '①   ②   ③',           fmt: function (n) { return (n >= 1 && n <= 20) ? String.fromCharCode(0x2460 + n - 1) : String(n); } },
        { id: 'abc',  label: 'A   B   C',           fmt: function (n) { return alphaFromNumber(n); } }
    ];

    function seqFormat(index, n) {
        var f = SEQ_FORMATS[index] || SEQ_FORMATS[0];
        return f.fmt(n);
    }

    /* 核心：给定一串单元格文本，算出哪些格该填什么值。
         · 空                    → 用计数 +1 填入
         · 非空且能解析成序号     → 按选定格式重写（默认保留原数值），
                                   这样「换了格式再点一次」就能刷新整列
         · 非空但解析不出         → 完全不动（表头、合计等文字格）
       renumberAll = true 时，有内容的数字格也一律从 seqStart 重新编号 */
    function seqPlan(texts, startValue, renumberAll) {
        var last = (startValue || 1) - 1;
        var out = [];
        for (var i = 0; i < texts.length; i++) {
            var plain = String(texts[i] == null ? '' : texts[i]).replace(/[\s\r\n\u0007\u0001\u0002]/g, '');
            if (plain === '') {
                last = last + 1;
                out.push({ index: i, value: last });
            } else {
                var n = seqParse(plain);
                if (n !== null) {
                    var v = renumberAll ? (last + 1) : n;
                    last = v;
                    out.push({ index: i, value: v });
                }
            }
        }
        return out;
    }

    /* 区域求和：与千分符共用同一套保护区，日期/文号/章节号/百分比/长数字串不参与 */
    function sumNumbers(t, o) {
        var res = { sum: 0, count: 0 };
        if (!t) return res;
        var mask = buildMask(t, o);
        var rx = /[-–—−]?\d[\d,]*(?:\.\d+)?/g;
        var m, total = 0, n = 0;
        while ((m = rx.exec(t)) !== null) {
            var s = m.index, len = m[0].length, masked = false;
            for (var i = s; i < s + len; i++) { if (mask[i]) { masked = true; break; } }
            if (masked) continue;
            var raw = m[0], sign = 1;
            if ('–—−-'.indexOf(raw.charAt(0)) >= 0) { sign = -1; raw = raw.slice(1); }
            var v = Number(raw.replace(/,/g, ''));
            if (!isFinite(v)) continue;
            total += sign * v;
            n++;
        }
        // 抹掉浮点累加噪声。注意：不能用 Math.round(sum*1e10)——
        // 金额量级的 sum*1e10 会超过 Number.MAX_SAFE_INTEGER，反而引入误差。
        res.sum = Number(total.toPrecision(15));
        res.count = n;
        return res;
    }

    function formatNumber(v) {
        return group(plainStr(v));
    }

    /* 版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0。
       必须按数字段比，不能按字符串比——'1.10.0' 字符串比会小于 '1.9.0'。 */
    function cmpVersion(a, b) {
        var pa = String(a == null ? '' : a).split('.');
        var pb = String(b == null ? '' : b).split('.');
        for (var i = 0; i < 3; i++) {
            var x = parseInt(pa[i], 10); if (isNaN(x)) x = 0;
            var y = parseInt(pb[i], 10); if (isNaN(y)) y = 0;
            if (x !== y) return x > y ? 1 : -1;
        }
        return 0;
    }

    return {
        compute: compute, applyChanges: applyChanges,
        seqPlan: seqPlan, seqFormat: seqFormat, seqParse: seqParse,
        seqFormatCount: SEQ_FORMATS.length,
        seqFormatLabel: function (i) { return (SEQ_FORMATS[i] || SEQ_FORMATS[0]).label; },
        sumNumbers: sumNumbers, formatNumber: formatNumber,
        cmpVersion: cmpVersion
    };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = DshEngine; }

/* ======================= WPS 侧胶水 ======================= */

var DSH_TAG = '[便捷插件] ';

/* 统一解包 Promise：WPS JSAPI 的属性几乎都是 Promise */
async function DSH_R(v) {
    try { return (v && typeof v.then === 'function') ? await v : v; }
    catch (e) { return undefined; }
}
async function DSH_P(obj, name) {
    if (obj === null || obj === undefined) return undefined;
    var v;
    try { v = obj[name]; } catch (e) { return undefined; }
    return await DSH_R(v);
}

function DSH_say(msg) {
    try { alert(msg); return true; } catch (e) { }
    try { if (typeof wps !== 'undefined' && wps.Alert) { wps.Alert(msg); return true; } } catch (e) { }
    try { console.log(DSH_TAG + msg); } catch (e) { }
    return false;
}

/* 完全静默：只写 console，界面零打扰。
   需要取证时在 WPS 里按 Alt+F12 打开加载项调试器，看 Console。 */
function DSH_quiet(msg) {
    try { console.log(DSH_TAG + msg); } catch (e) { }
}

function DSH_trim(s) {
    return String(s == null ? '' : s).replace(/[\r\n\u0007\u0001\u0002\s]/g, '');
}

/* 取 WPS 应用对象：逐个候选写法尝试，结果记入 diag */
async function DSH_getApp(diag) {
    var tries = [
        function () { return wps.WpsApplication(); },
        function () { return wps.WpsApplication; },
        function () { return (typeof Application !== 'undefined') ? Application : null; },
        function () { return (typeof wps !== 'undefined' && wps.Application) ? wps.Application : null; }
    ];
    for (var i = 0; i < tries.length; i++) {
        try {
            var a = await DSH_R(tries[i]());
            if (a) {
                diag.push('app[写法' + i + '] OK  name=' + (await DSH_P(a, 'Name')));
                return a;
            }
            diag.push('app[写法' + i + '] 返回空');
        } catch (e) {
            diag.push('app[写法' + i + '] 抛错: ' + (e && e.message ? e.message : e));
        }
    }
    return null;
}

/* 兜底通道：把报告写进文档正文末尾（alert 万一不可用时仍可见） */
async function DSH_emitToDoc(doc, text) {
    try {
        var c = await DSH_R(doc.Content);
        if (c && typeof c.InsertAfter === 'function') {
            await DSH_R(c.InsertAfter(text));
            return true;
        }
    } catch (e) { }
    return false;
}

async function DSH_run(mode, diagnoseOnly) {
    var diag = [];
    diag.push('版本=' + DSH_VERSION);
    diag.push('wps 对象=' + (typeof wps !== 'undefined' ? '有' : '无'));
    diag.push('回调已注册=' + (typeof window !== 'undefined' && typeof window.dshDiagnose === 'function' ? '是' : '否'));
    try {
        var app = await DSH_getApp(diag);
        if (!app) {
            DSH_say('便捷插件：拿不到 WPS 应用对象。\n\n' + diag.join('\n'));
            return;
        }

        var doc = await DSH_P(app, 'ActiveDocument');
        if (!doc) { DSH_say('请先打开一个文档，并把光标放进正文。'); return; }
        diag.push('doc=' + (await DSH_P(doc, 'Name')));

        var sel = await DSH_P(doc, 'Selection');
        if (!sel) sel = await DSH_P(app, 'Selection');
        if (!sel) { DSH_say('拿不到 Selection。\n\n' + diag.join('\n')); return; }

        var selText = String((await DSH_P(sel, 'Text')) || '');
        var hasSel = DSH_trim(selText).length > 0;
        diag.push('选区长度=' + DSH_trim(selText).length);

        // 选区横跨多个单元格 → 逐格处理。
        // 旧版是把整个选区的文本拼起来、再用一个全局偏移去定位，结果只有第一个
        // 单元格能对上：单元格结束标记在不同实现里的表示不一致，位置会整体错位。
        // 逐格处理完全不跨格做位置运算，从根上避开这个问题。
        var cells = await DSH_P(sel, 'Cells');
        var cellCount = cells ? Number((await DSH_P(cells, 'Count')) || 0) : 0;
        if (cellCount > 1) {
            diag.push('目标=表格 ' + cellCount + ' 个单元格（逐格处理）');
            return await DSH_runTable(app, doc, sel, cells, cellCount, mode, diagnoseOnly, diag);
        }

        var target, basePos = 0;
        if (hasSel) {
            target = await DSH_P(sel, 'Range');
            diag.push('目标=选区');
        } else {
            target = await DSH_P(doc, 'Content');
            diag.push('目标=整篇正文');
        }
        if (!target) { DSH_say('拿不到目标区域。\n\n' + diag.join('\n')); return; }

        var text = String((await DSH_P(target, 'Text')) || '');
        basePos = Number((await DSH_P(target, 'Start')) || 0);
        diag.push('文本长度=' + text.length);

        var changes = DshEngine.compute(text, mode, DSH_OPTIONS);
        diag.push('可处理处数=' + changes.length);

        if (diagnoseOnly) {
            diag.push('文本开头=' + JSON.stringify(text.slice(0, 40)));
            var head = changes.slice(0, 5).map(function (c) { return c.old + '→' + c.neu; });
            diag.push('预演=' + (head.join('  ') || '（无）'));
            diag.push('（自检不改文档）');
            DSH_say('便捷插件 · 自检\n\n' + diag.join('\n'));
            return;
        }

        if (!changes.length) {
            DSH_quiet('本区域没有需要处理的数字。');
            return;
        }

        var done = 0, failed = 0, samples = [];
        for (var i = changes.length - 1; i >= 0; i--) {
            var c = changes[i];
            try {
                var r = await DSH_R(doc.Range(basePos + c.start, basePos + c.start + c.length));
                if (!r) { failed++; continue; }
                var cur = String((await DSH_P(r, 'Text')) || '');
                if (cur !== c.old) { failed++; continue; }
                r.Text = c.neu;                                        // 写入
                var back = String((await DSH_P(r, 'Text')) || '');
                if (back !== c.neu) { failed++; continue; }             // 写回自检
                done++;
                if (samples.length < 3) samples.push(c.old + ' → ' + c.neu);
            } catch (e) {
                failed++;
                if (diag.length < 14) diag.push('替换异常: ' + (e && e.message ? e.message : e));
            }
        }

        var label = mode === 'thousands' ? '已加千分符' : (mode === 'mul' ? '已乘以一万' : '已除以一万');

        if (done === 0) {
            // 找到了该处理的数字却一处也没写成功 = 真出问题了，必须弹窗
            DSH_say('便捷插件：一处也没改成功。\n\n' + diag.join('\n'));
            return;
        }

        DSH_quiet(label + '：已处理 ' + done + ' 处' +
            (failed ? '，跳过 ' + failed + ' 处' : '') +
            (samples.length ? '（如 ' + samples.join('；') + '）' : ''));
    } catch (e) {
        var msg = '便捷插件出错：' + (e && e.message ? e.message : e) + '\n\n' + diag.join('\n');
        if (!DSH_say(msg)) {
            try {
                var d2 = await DSH_P(await DSH_getApp([]), 'ActiveDocument');
                if (d2) await DSH_emitToDoc(d2, '\n【便捷插件·出错】\n' + msg + '\n');
            } catch (e2) { }
        }
    }
}

/* 表格多单元格选区：每个单元格独立算、独立写。
   取「单元格范围 ∩ 选区范围」作为每格的处理范围，所以局部选中也只动选中的那部分。
   从最后一格往前写，前面的偏移不会被后面的改动带偏。 */
async function DSH_runTable(app, doc, sel, cells, count, mode, diagnoseOnly, diag) {
    var selRange = await DSH_P(sel, 'Range');
    var s0 = Number((await DSH_P(selRange, 'Start')) || 0);
    var s1 = Number((await DSH_P(selRange, 'End')) || 0);
    if (!(s1 > s0)) { s0 = 0; s1 = 2147483647; }   // 拿不到就退回"整格"

    var jobs = [], total = 0, i;
    for (i = 1; i <= count; i++) {
        var cell = await DSH_R(cells.Item(i));
        if (!cell) continue;
        var cr = await DSH_P(cell, 'Range');
        if (!cr) continue;
        var c0 = Number((await DSH_P(cr, 'Start')) || 0);
        var c1 = Number((await DSH_P(cr, 'End')) || 0);
        var a = Math.max(s0, c0), b = Math.min(s1, c1);
        if (!(b > a)) continue;
        var part = await DSH_R(doc.Range(a, b));
        if (!part) continue;
        var t = String((await DSH_P(part, 'Text')) || '');
        var ch = DshEngine.compute(t, mode, DSH_OPTIONS);
        total += ch.length;
        if (ch.length) jobs.push({ base: a, changes: ch, text: t });
    }
    diag.push('可处理处数=' + total);

    if (diagnoseOnly) {
        var head = [];
        for (i = 0; i < jobs.length && head.length < 5; i++) {
            for (var j = 0; j < jobs[i].changes.length && head.length < 5; j++) {
                head.push(jobs[i].changes[j].old + '→' + jobs[i].changes[j].neu);
            }
        }
        diag.push('预演=' + (head.join('  ') || '（无）'));
        diag.push('（自检不改文档）');
        DSH_say('便捷插件 · 自检\n\n' + diag.join('\n'));
        return;
    }

    if (!total) {
        DSH_quiet('本区域没有需要处理的数字。');
        return;
    }

    var done = 0, failed = 0, samples = [];
    for (i = jobs.length - 1; i >= 0; i--) {
        var job = jobs[i];
        for (var k = job.changes.length - 1; k >= 0; k--) {
            var c = job.changes[k];
            try {
                var rr = await DSH_R(doc.Range(job.base + c.start, job.base + c.start + c.length));
                if (!rr) { failed++; continue; }
                var cur = String((await DSH_P(rr, 'Text')) || '');
                if (cur !== c.old) { failed++; continue; }
                rr.Text = c.neu;
                var back = String((await DSH_P(rr, 'Text')) || '');
                if (back !== c.neu) { failed++; continue; }
                done++;
                if (samples.length < 3) samples.push(c.old + ' → ' + c.neu);
            } catch (e) {
                failed++;
                if (diag.length < 14) diag.push('替换异常: ' + (e && e.message ? e.message : e));
            }
        }
    }

    var label = mode === 'thousands' ? '已加千分符' : (mode === 'mul' ? '已乘以一万' : '已除以一万');
    if (done === 0) {
        DSH_say('便捷插件：一处也没改成功。\n\n' + diag.join('\n'));
        return;
    }
    DSH_quiet(label + '：已处理 ' + done + ' 处' +
        (failed ? '，跳过 ' + failed + ' 处' : '') +
        (samples.length ? '（如 ' + samples.join('；') + '）' : ''));
}

/* ======================= 填充序号 ======================= */

/* 下拉列表当前选中的格式下标；进程内记忆，重启 WPS 回到默认（纯数字） */
var DSH_SEQ_INDEX = 0;

function DSH_stripMarks(s) {
    return String(s == null ? '' : s).replace(/[\s\r\n\u0007\u0001\u0002]/g, '');
}

async function DSH_fillSequence() {
    var diag = [];
    try {
        var app = await DSH_getApp(diag);
        if (!app) { DSH_say('便捷插件 · 填充序号：拿不到 WPS 应用对象。\n\n' + diag.join('\n')); return; }

        var doc = await DSH_P(app, 'ActiveDocument');
        if (!doc) { DSH_say('请先打开一个文档。'); return; }

        var sel = await DSH_P(doc, 'Selection');
        if (!sel) sel = await DSH_P(app, 'Selection');
        if (!sel) { DSH_say('拿不到 Selection。'); return; }

        // 选区在表格里才有 Cells；不在表格里 Count 为 0
        var cells = await DSH_P(sel, 'Cells');
        var count = cells ? Number((await DSH_P(cells, 'Count')) || 0) : 0;
        if (!count) {
            DSH_say('请先在表格中选中要填序号的那一列（或一段连续单元格），再点「填充序号」。');
            return;
        }
        diag.push('选中单元格数=' + count);

        // 先把整段单元格读成文本数组，交给纯函数算方案
        var cellObjs = [], texts = [], i, cc, rr, tt;
        for (i = 1; i <= count; i++) {
            cc = await DSH_R(cells.Item(i));
            if (!cc) { cellObjs.push(null); texts.push(''); continue; }
            rr = await DSH_P(cc, 'Range');
            tt = String((await DSH_P(rr, 'Text')) || '');
            cellObjs.push(cc);
            texts.push(tt);
        }

        var plan = DshEngine.seqPlan(texts, DSH_OPTIONS.seqStart, DSH_OPTIONS.seqRenumberAll);
        diag.push('需处理=' + plan.length + ' 处，格式=' + DshEngine.seqFormatLabel(DSH_SEQ_INDEX) +
                  (DSH_OPTIONS.seqRenumberAll ? '（全量重编号）' : ''));
        if (!plan.length) {
            DSH_quiet('该选区里没有可编号的单元格。');
            return;
        }

        var done = 0, failed = 0, unchanged = 0;
        for (i = 0; i < plan.length; i++) {
            var item = plan[i];
            try {
                var val = DshEngine.seqFormat(DSH_SEQ_INDEX, item.value);
                // 内容已经一致就不写——避免无谓改动（开修订时会白产生一条修订记录）
                if (DSH_stripMarks(texts[item.index]) === DSH_stripMarks(val)) { unchanged++; continue; }
                var cell = cellObjs[item.index];
                if (!cell) { failed++; continue; }
                var cr = await DSH_P(cell, 'Range');
                if (!cr) { failed++; continue; }
                cr.Text = val;
                // 写回自检
                var back = DSH_stripMarks((await DSH_P(cr, 'Text')));
                if (back !== DSH_stripMarks(val)) { failed++; continue; }
                done++;
            } catch (e) {
                failed++;
                if (diag.length < 14) diag.push('写入异常: ' + (e && e.message ? e.message : e));
            }
        }

        if (done === 0 && unchanged > 0 && failed === 0) {
            DSH_quiet('填充序号：' + unchanged + ' 处已经就是该格式，无需改动。');
            return;
        }
        if (done === 0) {
            DSH_say('便捷插件 · 填充序号：一处也没改成功。\n\n' + diag.join('\n'));
            return;
        }
        DSH_quiet('填充序号：写入 ' + done + ' 处' +
                  (unchanged ? '，' + unchanged + ' 处已符合' : '') +
                  (failed ? '，失败 ' + failed + ' 处' : '') +
                  '，格式=' + DshEngine.seqFormatLabel(DSH_SEQ_INDEX));
    } catch (e) {
        DSH_say('便捷插件 · 填充序号出错：' + (e && e.message ? e.message : e) + '\n\n' + diag.join('\n'));
    }
}

/* ======================= 区域求和 ======================= */

async function DSH_sumRegion() {
    var diag = [];
    try {
        var app = await DSH_getApp(diag);
        if (!app) { DSH_say('便捷插件 · 求和：拿不到 WPS 应用对象。\n\n' + diag.join('\n')); return; }

        var doc = await DSH_P(app, 'ActiveDocument');
        if (!doc) { DSH_say('请先打开一个文档。'); return; }

        var sel = await DSH_P(doc, 'Selection');
        if (!sel) sel = await DSH_P(app, 'Selection');
        if (!sel) { DSH_say('拿不到 Selection。'); return; }

        var text = '';
        // 表格里按单元格逐个取，避免跨格拼接';
        var cells = await DSH_P(sel, 'Cells');
        var count = cells ? Number((await DSH_P(cells, 'Count')) || 0) : 0;
        if (count) {
            var parts = [], i, cc, rr;
            for (i = 1; i <= count; i++) {
                cc = await DSH_R(cells.Item(i));
                if (!cc) continue;
                rr = await DSH_P(cc, 'Range');
                parts.push(String((await DSH_P(rr, 'Text')) || ''));
            }
            text = parts.join('\n');
            diag.push('来源=表格 ' + count + ' 个单元格');
        } else {
            var rng = await DSH_P(sel, 'Range');
            text = String((await DSH_P(rng, 'Text')) || '');
            diag.push('来源=选中文本');
        }

        if (!DSH_stripMarks(text)) {
            DSH_say('请先选中要求和的区域——表格里选一列或一片单元格，或选中一段文字。');
            return;
        }

        var res = DshEngine.sumNumbers(text, DSH_OPTIONS);
        if (!res.count) {
            DSH_say('选中的区域里没有找到可求和的数字。\n\n' + diag.join('\n') +
                    '\n（日期、文号、章节号、百分比、15 位以上长数字串不参与求和）');
            return;
        }
        var shown = DshEngine.formatNumber(res.sum);
        DSH_quiet('区域求和：' + res.count + ' 个数字，合计 ' + shown);
        DSH_showSum(shown, res.count);
    } catch (e) {
        DSH_say('便捷插件 · 求和出错：' + (e && e.message ? e.message : e) + '\n\n' + diag.join('\n'));
    }
}

/* ---------------- 求和结果窗口 ---------------- */

/* 尽力把文本放进系统剪贴板；返回是否成功 */
function DSH_copyText(text) {
    try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.select();
        try { ta.setSelectionRange(0, text.length); } catch (e) { }
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) return true;
    } catch (e) { }
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { }
    return false;
}

/* 弹求和结果。
   要的是「结果预选中 + 已复制 + 点确定关闭」，alert 做不到（文本不能选、不能复制），
   所以走 wps.ShowDialog 弹一个自定义对话框页面；社区确认窗口内 window.close() 可关。 */
function DSH_showSum(sumText, count) {
    DSH_copyText(sumText);   // 主页面先复制一份，双保险

    var base = '';
    try {
        var u = String(window.location.href).split('?')[0].split('#')[0];
        base = u.substring(0, u.lastIndexOf('/') + 1);
    } catch (e) { }
    if (!base) {
        try {
            base = 'file:///' + String(Application.Env.GetAppDataPath()).replace(/\\/g, '/') +
                   '/kingsoft/wps/jsaddons/' + DSH_ADDON_DIR + '/';
        } catch (e) { }
    }

    var url = base + 'dialog_sum.html?sum=' + encodeURIComponent(sumText) +
              '&cnt=' + encodeURIComponent(String(count));

    // 有些环境会裁剪 query，这里再往 PluginStorage 存一份兜底
    try { if (window.wps && wps.PluginStorage) { wps.PluginStorage.setItem('dshLastSum', sumText); } } catch (e) { }

    var dpr = 1;
    try { dpr = window.devicePixelRatio || 1; } catch (e) { }

    try {
        if (window.wps && typeof wps.ShowDialog === 'function') {
            wps.ShowDialog(url, '区域求和', Math.round(400 * dpr), Math.round(190 * dpr), true);
            return;
        }
    } catch (e) { }
    try {
        if (window.wps && wps.Dialog && typeof wps.Dialog.openDialog === 'function') {
            wps.Dialog.openDialog({ title: '区域求和', width: 400, height: 190, url: url });
            return;
        }
    } catch (e) { }

    // 兜底：至少让结果可见（文本不可选中）
    DSH_say('区域求和\n\n数字个数：' + count + '\n合计：' + sumText +
            '\n\n（本机未能弹出可复制窗口，请手动抄录）');
}

/* 功能区对象：切换格式后必须主动失效控件，WPS 不会因为 onAction 自动重查 getLabel */
var DSH_RIBBON = null;
function dshRibbonLoad(ribbon) {
    DSH_RIBBON = ribbon;
    DSH_quiet('功能区 onLoad 已触发');
    return true;
}

/* ======================= 更新检查 ======================= */
/* 设计要点：
   1. 用 <script> 注入而不是 fetch —— 脚本标签不受 CORS 限制。若走 fetch，
      WPS 云盘/多数静态托管不加 CORS 头就会一律失败。
   2. 彻底失败安全。地址没配 / 文件不存在 / 读不到 / 格式不对 —— 一律静默。
      更新提示是锦上添花，绝不能变成新的故障点。
   3. 一个 WPS 会话内只自动提示一次，不反复打断。 */

/* ======================= 自动更新（拉起独立更新器） ======================= */
/* 为什么是「外挂一个更新器」，而不是插件自己写文件：
   · 下载这一环是通的 —— GitHub Pages 对所有资源送 Access-Control-Allow-Origin: *，
     file:// 页面（Origin: null）也能 fetch。实测四个文件都下载成功。
   · 但写盘这一环死了 —— WPS 的 FileSystem.writeFileString 不接受路径。
     官方人员答复：「这个 api 比较老了，不能传递路径，只能传递文档名，
     然后会往浏览器缓存路径下写文件」。实测报错 path cannot contains "/" or "\"，与此吻合。
   · 所以真正的自动更新必须由一个【独立进程】去改文件。
     大地插件就是这么做的（它有个 Updater\UpdaterReset\updater.exe）。
     我们等价地用一个 updater.ps1，完全绕开 WPS 沙箱。

   谁来拉起：点「检查更新」→ 弹出 dialog_update.html，用户选【是】之后
   由那个对话框调用 wps.OAAssist.ShellExecute 打开 update.bat。
   —— 为什么不在这个页面里拉：用户要先看到「当前版本 / 最新版本 / 是否更新」，
       alert 给不了按钮和进度，所以整段交互都放进对话框页。
   —— 另外，登录时还有一条 HKCU\Run 兜底，完全不经过 WPS。 */

/* 当前加载项的安装目录（Windows 路径，以反斜杠结尾）。
   从页面 URL 反推，不依赖 FileSystem / Env 之类的 API 是否可用。 */
function DSH_installDir() {
    try {
        var href = String(window.location.href).split('?')[0].split('#')[0];
        var i = href.lastIndexOf('/');
        if (i < 0) return '';
        var dir = decodeURIComponent(href.substring(0, i + 1));   // file:///C:/.../BianjieTools_1.5.2/
        var m = /^file:\/\/\/(.+)$/i.exec(dir);
        if (!m) return '';
        return m[1].replace(/\//g, '\\');                          // C:\...\BianjieTools_1.5.2\
    } catch (e) { return ''; }
}/* ---------- 按钮上显示当前版本号 ----------
   同时保留 ribbon.xml 里的静态 label：万一某个 WPS 版本不认 getLabel，
   按钮也不会变成空白（已验证过一次 menu 的 getLabel 在 WPS 里不刷新，
   所以这里两条腿走路）。 */
function dshCheckUpdateLabel() {
    return '检查更新 (' + DSH_VERSION + ')';
}

/* ---------- 安装目录的 file:// 基地址 ----------
   更新对话框页和更新器的状态文件都在这个目录里。 */
function DSH_baseUrl() {
    try {
        var u = String(window.location.href).split('?')[0].split('#')[0];
        return u.substring(0, u.lastIndexOf('/') + 1);
    } catch (e) { return ''; }
}

/* ---------- 弹「是否更新」对话框 ----------
   为什么不用 alert：用户要的是「是 / 否两个按钮 + 下载进度 + 更新成功提示」，
   alert 一样都给不了。
   另外，之前把 ShellExecute 的 try/catch 诊断（一长串英文）弹给用户看，
   是设计失误 —— 用户不需要看懂报错，只需要知道「更新成没成」。 */
function DSH_showUpdateDialog(L, manual) {
    var base = DSH_baseUrl();
    if (!base) return false;
    var url = base + 'dialog_update.html' +
              '?cur='  + encodeURIComponent(DSH_VERSION) +
              '&new='  + encodeURIComponent(String(L.version || '')) +
              '&note=' + encodeURIComponent(String(L.note || '')) +
              '&dir='  + encodeURIComponent(DSH_installDir()) +
              '&mode=' + (manual ? 'manual' : 'auto') +
              '&url='  + encodeURIComponent(String(L.url || '')) +
              '&files=' + encodeURIComponent((L.files && L.files.length) ? L.files.join(',') : '');
    var dpr = 1;
    try { dpr = window.devicePixelRatio || 1; } catch (e) { }
    try {
        if (window.wps && typeof wps.ShowDialog === 'function') {
            wps.ShowDialog(url, '检查更新', Math.round(430 * dpr), Math.round(310 * dpr), true);
            return true;
        }
    } catch (e) { }
    try {
        if (window.wps && wps.Dialog && typeof wps.Dialog.openDialog === 'function') {
            wps.Dialog.openDialog({ title: '检查更新', width: 430, height: 310, url: url });
            return true;
        }
    } catch (e) { }
    return false;
}

/* 发现新版本后的处置：手动检查和启动时的自动检查【都弹同一个对话框】，
   区别只在措辞（自动模式多一句"这是启动时自动发现的"）。
   为什么不静默：用户明确要求「要弹框提醒」。
   注意：插件【无法】触发更新 —— WPS 的沙箱保护会拦掉加载项发起的全部
   ShellExecute 调用（连打开一个 URL 协议都拦，已实测）。所以对话框如实说
   「已排队，下次开机登录后自动完成」，而不是假装在更新、也不是报"失败"。 */
async function DSH_onNewVersion(L, manual) {
    if (DSH_showUpdateDialog(L, manual)) return;
    DSH_notifyUpdate(L, false);      // 对话框弹不出来时的兜底
}
var DSH_UPDATE_URL = (typeof DSH_UPDATE_URL === 'string') ? DSH_UPDATE_URL : '';
var DSH_UPDATE_STATE = { done: false, notified: false };

function DSH_checkUpdate(manual, attempt) {
    var url = DSH_UPDATE_URL;
    if (!url) {
        if (manual) {
            DSH_say('还没有配置更新检查地址。\n\n' +
                    '做法：把 dsh-version.js 放进 WPS 云盘的一个文件夹，' +
                    '然后重跑一次安装脚本——它会自动找到实际路径并写好配置。');
        }
        return;
    }
    if (DSH_UPDATE_STATE.done && !manual && !attempt) return;
    DSH_UPDATE_STATE.done = true;

    var old = document.getElementById('dshUpdateProbe');
    if (old) { try { old.parentNode.removeChild(old); } catch (e) { } }

    var s = document.createElement('script');
    s.id = 'dshUpdateProbe';
    s.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + '_t=' + (new Date()).getTime();
    s.onload = function () {
        try {
            var L = window.DSH_LATEST;
            if (!L || !L.version) {
                if (manual) {
                    DSH_say('版本清单格式不对。\n\n应形如：\n' +
                            'var DSH_LATEST = { version: "1.3.0", url: "下载地址", note: "更新说明" };');
                }
                return;
            }
            if (DshEngine.cmpVersion(L.version, DSH_VERSION) <= 0) {
                if (manual) DSH_say('已是最新版本。\n\n当前版本：' + DSH_VERSION);
                return;
            }
            if (DSH_UPDATE_STATE.notified && !manual) return;
            DSH_UPDATE_STATE.notified = true;
            DSH_onNewVersion(L, manual);
        } catch (e) {
            if (manual) DSH_say('解析版本清单出错：' + (e && e.message ? e.message : e));
        }
    };
    s.onerror = function () {
        /* 网络偶发抖动是常态：实测 github.io 连打 12 次全过，
           但一天里总会碰上几次「基础连接已经关闭」。所以自动重试两次。
           失败也只影响"这次不提示更新"，五个功能完全不受影响。 */
        var att = attempt || 0;
        if (att < 2) {
            setTimeout(function () { DSH_checkUpdate(manual, att + 1); }, 1500 * (att + 1));
            return;
        }
        DSH_quiet('读不到版本清单（已重试 2 次）：' + url);
        if (manual) DSH_say('读不到版本清单：\n' + url + '\n\n（已重试 2 次。不影响插件使用）');
    };
    try { document.head.appendChild(s); } catch (e) { }
}

/* 兜底通道：自动安装没成功时，把下载地址给用户，自己复制。
   autoFailed = true 表示"本来想自动装但没成"，所以要说明为什么还要手动。 */
function DSH_notifyUpdate(L, autoFailed) {
    var dl = String(L.url || '');
    if (dl) DSH_copyText(dl);
    DSH_say((autoFailed ? '发现新版本（自动更新未成功，需手动下载）\n\n' : '发现新版本\n\n') +
            '当前版本：' + DSH_VERSION + '\n' +
            '最新版本：' + L.version + (L.date ? '（' + L.date + '）' : '') + '\n' +
            (L.note ? '\n更新内容：\n' + L.note + '\n' : '') +
            (dl ? '\n下载地址（已复制到剪贴板）：\n' + dl
                : '\n（清单里没写下载地址）'));
}

/* ----------------------- 功能区回调（顶层声明 => 全局可见） ----------------------- */
function dshThousands() { DSH_run('thousands', false); return true; }
function dshMultiply() { DSH_run('mul', false); return true; }
function dshDivide() { DSH_run('div', false); return true; }
function dshDiagnose() { DSH_run('thousands', true); return true; }

/* --- 填充序号：动作 + 格式菜单 --- */
function dshFillSequence() { DSH_fillSequence(); return true; }

/* --- 区域求和 --- */
function dshSumRegion() { DSH_sumRegion(); return true; }

/* --- 检查更新 --- */
function dshCheckUpdate() { DSH_checkUpdate(true); return true; }

function DSH_setSeqFormat(i) {
    if (i >= 0 && i < DshEngine.seqFormatCount) {
        DSH_SEQ_INDEX = i;
        DSH_quiet('序号格式切换为 ' + DshEngine.seqFormatLabel(i));
        // 让菜单标题立刻刷新成新格式
        try {
            if (DSH_RIBBON && DSH_RIBBON.InvalidateControl) {
                DSH_RIBBON.InvalidateControl('dshSeqMenu');
            }
        } catch (e) { }
    }
    return true;
}

/* 菜单标题上显示当前格式 */
function dshSeqMenuLabel(control) {
    return '序号格式：' + DshEngine.seqFormatLabel(DSH_SEQ_INDEX);
}

/* 八个格式项各挂一个固定名字的回调。
   刻意不读 control 参数——动态下拉那套（onAction 的第二个参数到底是
   下标、id 还是标签）在各实现里不一致，这里是踩过坑之后的稳妥写法。 */
function dshSeqPick0() { return DSH_setSeqFormat(0); }
function dshSeqPick1() { return DSH_setSeqFormat(1); }
function dshSeqPick2() { return DSH_setSeqFormat(2); }
function dshSeqPick3() { return DSH_setSeqFormat(3); }
function dshSeqPick4() { return DSH_setSeqFormat(4); }
function dshSeqPick5() { return DSH_setSeqFormat(5); }
function dshSeqPick6() { return DSH_setSeqFormat(6); }
function dshSeqPick7() { return DSH_setSeqFormat(7); }

function dshPing() {
    DSH_say('便捷插件：回调已注册，可以响应点击。\n\n' +
            'wps 对象=' + (typeof wps !== 'undefined' ? '有' : '无'));
    return true;
}

/* 双保险：显式挂到 window 上 */
try {
    if (typeof window !== 'undefined') {
        window.dshThousands = dshThousands;
        window.dshMultiply = dshMultiply;
        window.dshDivide = dshDivide;
        window.dshDiagnose = dshDiagnose;
        window.dshPing = dshPing;
        window.dshFillSequence = dshFillSequence;
        window.dshSumRegion = dshSumRegion;
        window.dshRibbonLoad = dshRibbonLoad;
        window.dshCheckUpdate = dshCheckUpdate;
        window.dshCheckUpdateLabel = dshCheckUpdateLabel;
        window.dshSeqMenuLabel = dshSeqMenuLabel;
        window.dshSeqPick0 = dshSeqPick0;
        window.dshSeqPick1 = dshSeqPick1;
        window.dshSeqPick2 = dshSeqPick2;
        window.dshSeqPick3 = dshSeqPick3;
        window.dshSeqPick4 = dshSeqPick4;
        window.dshSeqPick5 = dshSeqPick5;
        window.dshSeqPick6 = dshSeqPick6;
        window.dshSeqPick7 = dshSeqPick7;
        window.DSH_LOADED = true;
    }
} catch (e) { }

/* 启动后自动查一次新版本。
   延迟 6 秒：避开 WPS 自身的启动高峰，也不和 ribbon 首次渲染抢资源。
   全程异步 + 失败静默，查不到就是查不到，插件照常用。 */
try {
    if (typeof window !== 'undefined' && DSH_OPTIONS.updateCheck && DSH_UPDATE_URL) {
        setTimeout(function () { DSH_checkUpdate(false); }, 6000);
    }
} catch (e) { }
