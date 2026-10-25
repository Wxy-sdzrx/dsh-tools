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
    autoThousands: true,
    /* 金额单位联动：÷10000 时 元→万元、×10000 时 万元→元（并沿 元/万元/亿元/万亿元 链条平移一档）。
       默认【关】：不带"（改单位）"的那个按键就是它。带"（改单位）"的按键会按次打开。这样任何漏传参的路径都是老行为。 */
    unitConvert: false,    // 【默认关】只有「（改单位）」按键按次打开
                           // 打开时：有金额单位 → 沿链条换算；没有单位 → 默认按「元」处理，
                           // 算完补上单位（÷10000 补「万元」，×10000 补「元」）
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
    seqMode: 'auto',       // 正文填充序号的两种模式（v1.12.0）：
                            //  'auto'  = 自动判定：选区第一个非空段落带序号 → 统一格式模式，
                            //            否则 → 填充编号模式（默认）
                            //  'fill'  = 强制填充编号（选区覆盖的段落全部按顺序编号）
                            //  'unify' = 强制统一格式（只改已经带序号的段落，其余不动）
                            // 为什么需要 unify：Ctrl 多选在 WPS 桌面接口下读不到多选区
                            // （Selection.Range 只代表其中一块，实测 Areas.Count 恒为 0），
                            // 而连续选区会把中间正文也编号 —— unify 正好补这个缺口：
                            // 从第一处序号拖到最后一处序号，只重写带序号的那些。
    updateCheck: true,      // 启动后检查一次新版本。失败【完全静默】，绝不影响任何功能
    useUpdater: true        // 发现新版就【自动下载并覆盖安装】，无需用户操作。
                            // 走 fetch 下载（GitHub Pages 送 ACAO:*，file:// 页面也能取）
                            // + WPS JSAPI 的 FileSystem.writeFileString 落盘。
                            // 任何一步失败即中止，绝不留下半新半旧的安装目录。
};

/* 版本与加载项目录名。改版本时必须同步改这两行、以及各安装脚本里的 $Version——
   test.js 里有断言守住这两处一致，防止升级时漏改。 */
var DSH_VERSION = '1.14.2';
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
            /* ⚠️ 必须同时管住【带千分位分隔符】的长数字（2026-10-20 质检 Q-02，P0）：
               上面的 \d{15,} 匹配的是"连续数字"，而 110,101,199,003,071,234 这种
               被逗号隔开 —— 逗号把数字串切断了，正则匹配不到，
               于是 18 位身份证（Excel 粘贴时自带千分位）就逃过了保护，
               被加上千分位和小数位。
               下面这条按"去掉分隔符后的位数"判定：\d{1,3}(,\d{3}){4,} 即 15 位以上。
               注意它也覆盖"带分隔符的手机号"（如 138,001,38000）。 */
            /* 位数换算：每组 3 位。n=15 → 5 组 → 首组 + 后面 4 组起。
               （写成 ceil(n/3) 会多要一组，15 位反而拦不住 —— 这次踩过。） */
            var groups = Math.ceil(n / 3);                  // 15 → 5 组
            p.push(new RegExp('\\d{1,3}(?:,\\d{3}){' + Math.max(1, groups - 1) + ',}', 'g'));
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

    /* ============ 金额单位联动 ============
       ÷10000：元 → 万元；×10000：万元 → 元。
       为什么要有：数字改了、单位没改，金额就错了 10000 倍。

       为什么必须做成【链条】而不是只做一档：
         这个功能的本质是"换算单位、保住金额不变"。
         文档里若有 100万元，按 ÷10000 时数字 100→0.01，单位必须同时 万元→亿元
         （0.01亿 = 100万元 ✓）；若只把数字除以一万而单位不动，0.01万元 = 100元 ✗ 差一万倍。
         所以链条是 元 → 万元 → 亿元 → 万亿元，两个方向对称。

       三条护栏（全是防"改错"的）：
         ① 只认紧跟在数字后面的单位（中间允许空格），不认远处的"元"；
         ② 外币与人民币走同一套换档规则，但币种词必须【整词】匹配：
            "100万美元" 里的"万元"是美元，不是人民币万元 —— 靠整词匹配才分得开；
         ③ "元"后面跟着 旦/素/气/宵/首/件/帅/老/宝 之类不成词的，不当单位（如"2024元旦"）。 */
    /* 「元」后面跟着不成词的字（元旦/元素…），不当单位 */
    var UNIT_NOT_UNIT_NEXT = '旦素气宵首件帅老宝凶';

    /* ============ 外币同样要换档（2026-10-20 用户报障）============
       之前的外币规则是"单位一个字都不碰"，那只保住了"美元"这个词，
       数字却照乘一万 —— 金额照样变一万倍（实测 100万美元 → 1,000,000.00万美元 ❌）。
       用户的原话：「外币，对应数字也变化，无非就是万美元还是亿美元的变化」——
       也就是说外币和人民币遵守同一套规则，只是档位名字不同：
           美元 → 万美元 → 亿美元 → 万亿美元
           欧元 → 万欧元 → 亿欧元 ……
       做法：把"币种"和"档位"拆开。币种（美元/欧元…）原样保留，
       只在它前面那个"万/亿/万亿"档位词上平移；没有档位词就补一个。
       链到头（×10000 遇到光杆"美元"）与人民币同规则：数字与单位一起不动。

       【2026-10-22 清理】原来这里还有一套独立的外币实现
       （FX_CUR / FX_SCALE / fxAfter / fxShift），口径与人民币不一致，
       已被下面统一的 parseUnit 取代，现已删除 —— 留着只会让人以为有两套规则。
       档位指数（万=4 亿=8 万亿=12）与外币共用，见 SCALE_EXP。 */

    /* 币种词的完整写法。必须整词匹配 —— 早期版本只认单字，
       于是「新加坡元」被当成「新」+「加坡元」，换档时写出「万新」，
       把「加坡元」直接吃掉（实测，用户报障后自查发现）。
       长的先试，否则「新加坡元」会先命中「新加坡」。 */
    var FX_WORDS = ['新加坡元', '新台币', '新加坡币', '人民币', '美元', '欧元', '港元', '日元',
                    '澳元', '加元', '韩元', '坡币', '卢布', '卢比', '法郎', '马克', '英镑',
                    '瑞郎', '台币', '美金', '英镑'];

    /* 在 pos 处匹配一个币种词（不带档位词）；返回 {word, len} 或 null */
    function fxWordAt(t, pos) {
        var best = null;
        for (var i = 0; i < FX_WORDS.length; i++) {
            var w = FX_WORDS[i];
            if (t.substr(pos, w.length) !== w) continue;
            if (!best || w.length > best.len) best = { word: w, len: w.length };
        }
        return best;
    }

    /* ============ 统一的金额单位解析（2026-10-20 质检 Q-01 / Q-05 整改）============
       原来人民币和外币各写一套"找单位"的逻辑，两套的匹配口径还不一样：
         · 人民币 unitAfter：把单位锚定在数字【之后立刻匹配】
         · 外币   fxAfter（已删）：先找档位词、再找币种词
       于是"两档连写"的金额单位（万万元 / 亿万）在人民币链上根本认不出来
       → 走裸数字分支 → 数字乘一万而单位一字不动 → 金额凭空变一万倍
       （实测 100万万元 → 1,000,000.00万万元 ❌）。
       外币链因为口径不同，"亿美元万"却能正确换档 —— 同一类输入两种结果。

       整改：合成【一套】解析，人民币与外币共用。
         单位 = 档位词（可组合）+ 币种词
         档位用【指数】表示，不再用固定四档：
             元=0 · 万=4 · 亿=8 · 万亿=12 · 万万元=8（万×万=10^8）
         平移就是指数 ±4（÷10000 / ×10000 恰好一档）。
         这样"万万元"与"亿元"落在同一个指数上，行为自然一致。 */
    var SCALE_EXP = { '': 0, '万': 4, '亿': 8, '万亿': 12 };   // 单个档位词 → 指数
    var SCALE_WORDS = ['万亿', '亿', '万'];                       // 长的先试
    var CNY_WORD = '元';

    /* 读档位词（可组合）：万万元 → 万(4)+万(4)=8；亿万 → 亿(8)+万(4)=12。
       至多读两个，再多就不是金额单位了（那是乱写）。 */
    function readScale(t, pos) {
        var exp = 0, len = 0, count = 0;
        while (count < 2) {
            var hit = null;
            for (var i = 0; i < SCALE_WORDS.length; i++) {
                var w = SCALE_WORDS[i];
                if (t.substr(pos + len, w.length) === w) { hit = w; break; }
            }
            if (!hit) break;
            exp += SCALE_EXP[hit];
            len += hit.length;
            count++;
        }
        return { exp: exp, len: len };
    }

    /* 匹配币种词：先试外币整词（长优先），再试「元」。 */
    function curWordAt(t, pos) {
        var w = fxWordAt(t, pos);
        if (w) return { word: w.word, len: w.len, fx: true };
        if (t.charAt(pos) === CNY_WORD) return { word: CNY_WORD, len: 1, fx: false };
        return null;
    }

    /* 找出紧跟 pos 之后的金额单位（人民币或外币，统一口径）。
       返回 {start, length, text, exp, fx, curStart, curLen} 或 null。 */
    function parseUnit(t, pos, mask) {
        var i = pos, n = t.length;
        while (i < n) {
            var ch = t.charAt(i);
            if (ch === ' ' || ch === '\t' || ch === '\u00a0' || ch === '\u3000') { i++; continue; }
            break;
        }
        var sc = readScale(t, i);
        var cw = curWordAt(t, i + sc.len);
        if (!cw) return null;                       // 没有币种词 → 不是金额单位
        var start = i, end = i + sc.len + cw.len;
        if (mask) {
            for (var k = start; k < end; k++) { if (mask[k]) return null; }
        }
        /* 人民币的「元」后面若跟着不成词的字（元旦/元素），不当单位 */
        if (!cw.fx && cw.word === CNY_WORD) {
            var nx = t.charAt(end) || '';
            if (nx && UNIT_NOT_UNIT_NEXT.indexOf(nx) >= 0) return null;
        }
        return { start: start, length: end - start, text: t.slice(start, end),
                 exp: sc.exp, fx: cw.fx, curStart: start + sc.len, curLen: cw.len };
    }

    /* 数字后面有没有档位词（万/亿/万亿）？用于判定"有金额痕迹但凑不出单位"。 */
    function hasScaleWord(t, pos) {
        var i = pos, n = t.length;
        while (i < n) {
            var ch = t.charAt(i);
            if (ch === ' ' || ch === '\t' || ch === '\u00a0' || ch === '\u3000') { i++; continue; }
            break;
        }
        for (var k = 0; k < SCALE_WORDS.length; k++) {
            if (t.substr(i, SCALE_WORDS[k].length) === SCALE_WORDS[k]) return true;
        }
        return false;
    }

    /* 档位平移：指数 ±4（一档 = 一万）。
       到顶（exp=0 且 mul）或到底（exp=12 且 div）返回 null = 链到头。 */
    function expShift(exp, mode) {
        var next;
        if (mode === 'mul') next = exp - 4;
        else if (mode === 'div') next = exp + 4;
        else return null;
        if (next < 0 || next > 12) return null;    // 链到头
        return next;
    }

    /* 指数写回成档位词：12→万亿 8→亿 4→万 0→空 */
    function expToScale(exp) {
        if (exp === 12) return '万亿';
        if (exp === 8) return '亿';
        if (exp === 4) return '万';
        if (exp === 0) return '';
        return null;
    }

    /* 判断这段文本里是否存在"数字 + 链条尽头单位"的组合。
       用途：点（改单位）按键却一处没改时，区分【有意的保护】（链到头）
       与【插件没干活】—— 前者要告诉用户为什么，后者才是真故障。 */
    function hasUnitAtChainEnd(t) {
        if (!t) return false;
        var rx = /[-–—−]?\d[\d,]*(?:\.\d+)?/g, m;
        while ((m = rx.exec(t)) !== null) {
            var pos = m.index + m[0].length;
            var un = parseUnit(t, pos, null);
            if (!un) continue;
            /* exp=0 → 已在最底档（×10000 到头）；exp=12 → 已在最高档（÷10000 到头） */
            if (un.exp === 0 || un.exp === 12) return true;
        }
        return false;
    }

    /* ============ 无单位时默认按「元」补单位 ============
       用户需求（2026-10-20）：点「乘以一万（改单位）」「除以一万（改单位）」时，
       数字后面根本没有金额单位的，默认它是「元」，算完把单位补上——
         ÷10000：元→万元，补「万元」（12345678.90 → 1,234.57万元，金额不变）
         ×10000：元已在链条最底档、不平移，补「元」（123.45 → 1,234,500.00元）
       为什么补之前要过一道 canAppendUnit：
         补错单位 = 把金额改了一万倍，比不补更糟。所以只在数字后面
         「什么单位词都没有」时才补——后面紧跟着汉字（美元/吨/个/元旦…）
         一律不补：那要么是外币（外币绝不碰）、要么是量词（不是金额）。
       闭括号/引号后面也不补：括号外面可能才是真正的单位（"(1234)元"）。 */
    var UNIT_APPEND_RE_CJK = new RegExp('[\\u3400-\\u9fff]');   // 汉字（用 RegExp 构造，避免被未定义标识符扫描器当成噪声）

    function canAppendUnit(t, s, e) {
        var i = e, n = t.length;
        while (i < n) {
            var ch = t.charAt(i);
            if (ch === ' ' || ch === '\t' || ch === '\u00a0' || ch === '\u3000') { i++; continue; }
            break;
        }
        // 数字前面紧贴「元」字家族（"元100"这种倒装写法）：已有单位语义，不补
        var q = s;
        while (q > 0 && (t.charAt(q - 1) === ' ' || t.charAt(q - 1) === '\t')) q--;
        var before = t.slice(Math.max(0, q - 3), q);
        if (/(?:万亿元|亿元|万元|元)$/.test(before)) return false;
        if (i >= n) return true;                                   // 数字后就是结尾
        var c0 = t.charAt(i);
        if (c0 === '\r' || c0 === '\n' || c0 === '\x07' || c0 === '\u000b' || c0 === '\u000c') return true;  // 段落/单元格结束
        if (UNIT_APPEND_RE_CJK.test(c0)) return false;             // 汉字：外币、量词、不成词的字，一律不补
        if (/[0-9A-Za-z.,\/%‰：:]/.test(c0)) return false;          // 数字/字母/小数点/逗号/斜杠/百分号：不补
        if (/[）)\]】》>”’}]/.test(c0)) return false;                // 闭括号/闭引号：括号外可能才是单位
        return true;                                               // 开标点、运算符、空白到尾：可补
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
                /* 金额单位联动：数字改了就顺带把紧跟其后的单位平移一档。
                   只在【数字确实改动过】时做 —— 数字没动而改单位，等于把金额改了。

                   ⚠️ 链到头时必须【连数字一起不动】（用户报障 2026-10-20）：
                   ×10000 遇到「元」、÷10000 遇到「万亿元」，已经没有下一档可换。
                   此时若照常把数字乘/除一万，单位又不变，金额就凭空变了一万倍
                   （实测 100元 → 1,000,000.00元）。
                   「（改单位）」按键的立身之本就是【金额不变】，宁可不动也不能改错。
                   要换口径就先手动把单位提到能承接的那一档（100元 → 100万元），再点它。 */
                var unitChange = null;
                /* 「（改单位）」模式下，数字与单位必须【同进同出】：
                   只要拿不到一个能承接这次换算的单位，这处数字就整体保持原样。
                   两种拿不到的情况：
                     ① 已有单位，但已在链条尽头（×10000 遇「元」、÷10000 遇「万亿元」）；
                     ② 裸数字且是 ×10000 —— 补「元」只是贴标签、金额照样变一万倍。
                   「（改单位）」的立身之本是【金额不变】，宁可不动也不能改错。 */
                var chainBlocked = false;
                if (o.unitConvert === true && (mode === 'mul' || mode === 'div')) {
                    /* 统一解析：人民币与外币走同一条路（parseUnit）。
                       单位 = 档位词（可组合）× 币种词，档位记成指数（万=4 亿=8 万亿=12）。
                       人民币「元」与外币「美元」在这里是同一种东西，只是币种词不同 ——
                       所以「万万元」与「万美元」会被同等对待，不再一个认得一个认不得。 */
                    var un = parseUnit(t, s + len, mask);
                    if (un) {
                        var nextExp = expShift(un.exp, mode);
                        if (nextExp === null) {
                            chainBlocked = true;                       // ① 链到头（含外币）
                        } else {
                            /* 只换【档位词】，币种词一个字都不动：
                               万美元 → 亿美元 = "亿" + "美元"；万元 → 元 = "" + "元"。
                               币种词在原串里的位置 = curStart，尾段即币种词本身。 */
                            var cur = t.substr(un.curStart, un.curLen);
                            var neu = expToScale(nextExp) + cur;
                            unitChange = { start: un.start, length: un.length, old: un.text,
                                           neu: neu, unit: true, fx: un.fx };
                        }
                    } else if (mode === 'div' && canAppendUnit(t, s, s + len)) {
                        /* 裸数字 ÷10000：默认它是元，补「万元」——元→万元真的往上一档，
                           金额不变，是 1.10.0 起就有的行为，保留。 */
                        unitChange = {
                            start: s + len, length: 0, old: '', neu: '万元',
                            unit: true, appended: true
                        };
                    } else if (mode === 'mul' && canAppendUnit(t, s, s + len)) {
                        /* 裸数字 ×10000：见上方说明，补「元」只是贴标签 → 整体不动。 */
                        chainBlocked = true;                           // ② 裸数字 ×10000
                    } else if (hasScaleWord(t, s + len)) {
                        /* ③ 数字后面有档位词（万/亿/万亿）却凑不出一个像样的单位
                           —— 例如「100亿万」「100万亿亿」这类两档连写。
                           它不是"裸数字"（不是没单位），也不是"能换档的单位"（换不了）。
                           两种都靠不住，唯一安全的做法是【整体不动】：
                           否则数字改了一万、那几个字又没跟着改，金额就凭空变一万倍。
                           —— 这条把「（改单位）= 金额不变」变成了硬约束：
                           凡是凑不出可换档单位的数字，一律不碰。 */
                        chainBlocked = true;
                    }
                    /* ⚠️ 以上分支都要求 parseUnit 认不出单位，也就是
                       "数字后面真的什么都没有"（canAppendUnit 为 true）。
                       canAppendUnit 为 false 时不拦：那说明后面跟着量词（100吨）——
                       量词不是金额单位，数字照常乘除是老规矩（v1.9.7 起）。 */
                }
                if (!chainBlocked) {
                    res.push({ start: s, length: len, old: m[0], neu: conv });
                    if (unitChange) res.push(unitChange);
                }
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

    /* ============ 选择范围模糊识别（2026-10-20 用户需求） ============
       场景：用户常常只选中长数字的一部分（或光标只是点在数字中间/紧贴两侧），
       期望的是"对完整数字做计算"。旧行为会把选中的片段当成独立数字——
       选 12345678 里的 3456，算完就把完整数字撕成了碎片。
       规则（纯文本逻辑，Node 下可单测）：
         · 有选区：与数字 token 有【任何重叠】的都按完整 token 处理；
           连续多个 token 取首尾包络；完全不重叠 → null。
         · 光标（start === end）：落在 token 内部、或紧贴 token 左/右边界 →
           圈住该 token（多个同时满足时取最左边那个）；否则 → null。
       wantUnit：数字后紧跟金额单位时把单位也圈进来——（改单位）模式下
       数字和单位必须同进同出，只换数字不换单位等于把金额改了一万倍。 */
    /* 所有可能的金额单位词（用于"光标点在单位上"的识别）。
       含人民币各档（万元/亿元/万亿元）与外币（美元/欧元/…/新加坡元/新台币/人民币）。 */
    var UNIT_WORDS_ALL = ['万亿元', '亿元', '万元', '美元', '欧元', '港元', '日元', '澳元', '加元', '韩元',
                          '新加坡元', '新加坡币', '新台币', '人民币', '台币', '美金', '英镑', '卢布', '卢比',
                          '法郎', '马克', '瑞郎', '坡币', '元'];
    /* 档位词 + 币种词的组合（亿美元、万人民币、万新台币…）。
       不列全的话，"光标点在'亿'字上"就认不出单位（'亿'本身只是档位词，不是币种）。
       这里按"档位词在前 + 币种词在后"拼接，长度优先。 */
    var SCALE_PREFIX_ALL = ['万亿', '亿', '万'];
    function buildCompoundUnits() {
        var out = [];
        for (var i = 0; i < SCALE_PREFIX_ALL.length; i++) {
            for (var j = 0; j < UNIT_WORDS_ALL.length; j++) {
                if (UNIT_WORDS_ALL[j] === '元') continue;      // 「亿元」这类已在上面
                out.push(SCALE_PREFIX_ALL[i] + UNIT_WORDS_ALL[j]);
            }
        }
        return out;
    }
    var UNIT_WORDS_COMPOUND = buildCompoundUnits();

    /* 找出与 [start,end) 重叠的单位词（长词优先）。
       用途：用户把光标点在"万元"的"万"字上时，意图显然是改那个数字，
       不该因为"光标不在数字上"就退回整篇。 */
    function unitNear(text, start, end) {
        var from = Math.max(0, start - 6), to = Math.min(text.length, end + 6);
        if (to <= from) return null;
        var seg = text.slice(from, to);
        var best = null;
        var ALL = UNIT_WORDS_ALL.concat(UNIT_WORDS_COMPOUND);
        for (var i = 0; i < ALL.length; i++) {
            var w = ALL[i];
            var idx = seg.indexOf(w);
            while (idx >= 0) {
                var s = from + idx, e = s + w.length;
                /* ⚠️ 判定必须是"【盖住】光标位置"，不能是"与选区重叠"：
                   光标是【零宽】的（start === end），用重叠判定
                   （s < end && start < e）在单位正好从光标处开始时永远不成立
                   —— 那正是用户点的位置（"万"字）。这次踩过。
                   正确写法：单位区间与光标【有交集】，
                   即 s <= end && start <= e（闭区间，端点也算命中）。 */
                if (s <= end && start <= e) {
                    if (!best || w.length > best.len) best = { word: w, len: w.length, start: s, end: e };
                }
                idx = seg.indexOf(w, idx + 1);
            }
        }
        return best;
    }

    /* 找出"紧挨在 limit 之前"的数字 token（中间只允许空白）。
       返回 {s, e} 或 null。 */
    function numberEndingAt(text, limit) {
        var q = limit;
        while (q > 0 && /\s/.test(text.charAt(q - 1))) q--;
        var rx = /[-–—−]?\d[\d,]*(?:\.\d+)?/g, m, best = null;
        while ((m = rx.exec(text)) !== null) {
            if (m.index + m[0].length > q) break;
            best = { s: m.index, e: m.index + m[0].length };
        }
        if (best && best.e === q) return best;
        return null;
    }

    function expandSpan(text, start, end, wantUnit) {
        if (!text) return null;
        var n = text.length;
        if (!(start >= 0) || !(end >= start) || end > n) return null;
        var rx = /[-–—−]?\d[\d,]*(?:\.\d+)?/g;
        var m, first = -1, last = -1;
        while ((m = rx.exec(text)) !== null) {
            var s = m.index, e = s + m[0].length;
            if (start < end) {
                if (start < e && s < end) {                    // 选区与 token 重叠
                    if (first < 0) first = s;
                    if (e > last) last = e;
                } else if (first >= 0 && s >= end) {
                    break;                                     // 已越过选区
                }
            } else {
                if ((start > s && start < e) || start === s || start === e) {
                    first = s; last = e;                       // 光标在 token 内或紧贴两侧
                    break;
                }
                if (s > start) break;                          // token 全在光标之后，不贴
            }
        }
        if (first < 0) {
            /* 没圈到数字：光标可能点在【单位】上（"万元"的"万"字），或单位与数字之间。
               那时用户的意图很清楚 —— 改这个单位所属的那个数字。
               不处理的话，模糊识别会退回"整篇"，把用户没碰过的地方也一起改了
               （2026-10-20 用户报障：表格里没碰的格子被一起除了）。 */
            if (start === end) {
                var ue = unitNear(text, start, end);
                if (ue) {
                    var nb = numberEndingAt(text, ue.start);
                    if (nb) {
                        first = nb.s;
                        last = ue.end;                 // 单位一并圈上，数字与单位同进同出
                        if (wantUnit) { /* 已含单位，无需再扩 */ }
                        else { last = nb.e; }          // 不带（改单位）时只圈数字
                        return { s: first, e: last };
                    }
                }
            }
            return null;
        }
        if (wantUnit) {
            var u = parseUnit(text, last, null);               // mask 传 null：只探"有没有单位"，不查保护区
            if (u) last = Math.max(last, u.start + u.length);
        }
        return { s: first, e: last };
    }

    /* 只保留完全落在 [s, e] 内的变更。用于模糊识别：上下文窗口里"别的数字"
       算出来的 change 一律不写回，只写圈定范围内的（单位换算、补单位插入都算在内）。 */
    function filterChanges(changes, s, e) {
        var out = [];
        for (var i = 0; i < changes.length; i++) {
            var c = changes[i];
            if (c.start >= s && c.start + c.length <= e) out.push(c);
        }
        return out;
    }

    /* 判断一个段落的 Shadow 标记值算不算"被选中"（v1.13.0）。
       实测值域（WPS COM 探针，2026-10-24）：
         -1       = 已标记（整段在选区内）
         9999999  = 混合（半段在选区内，段尾标记没被选中）
         0 / false= 未标记
       安全取向：**读不到 / 空值一律按未标记**（漏编号看得见，误编号改坏正文）。 */
    function seqIsMarked(sv) {
        if (sv === null || sv === undefined || sv === false || sv === '') return false;
        var n = Number(sv);
        if (isNaN(n)) return false;   // 读不出值，按未标记处理
        return n !== 0;
    }

    /* 清除回车和空格（v1.14.0）——纯逻辑，便于单测。
       场景：从 PDF / 网页复制的文字，每行一个回车、行首行尾带空格，
       需要拼成一段连续的文字。
       规则：
         · 删除所有回车：段落标记 \r、\n，软回车 \v（Shift+Enter）
         · 删除所有空格：半角 ' '、不间断 \u00A0、全角\u3000
         · 【边界保护】原文以回车结尾时保留最后一个：
           从 PDF 复制的碎行往往整行选中（含段尾回车），连它也删掉，
           下一段会被并进来——用户只想把选中的几行拼成一段。
         · 制表符 \t 不动（"空格"不含制表符，避免误伤缩进）
       返回 { text, breaks, spaces }。 */
    function cleanBreaks(raw) {
        var t = String(raw == null ? '' : raw);
        var last = t.charAt(t.length - 1), tail = '';
        if (last === '\r' || last === '\n' || last === '\v') tail = last;
        var breaks = 0, spaces = 0, out = '', i, ch;
        for (i = 0; i < t.length; i++) {
            ch = t.charAt(i);
            if (ch === '\r' || ch === '\n' || ch === '\v') {
                if (i === t.length - 1) continue;   // 尾巴单独保留
                breaks++; continue;
            }
            if (ch === ' ' || ch === '\u00A0' || ch === '\u3000') { spaces++; continue; }
            out += ch;
        }
        return { text: out + tail, breaks: breaks, spaces: spaces };
    }

    /* ============ 位置 ↔ 文本下标换算（表格里唯一的坑） ============
       Word 的位置空间里，一个单元格的结束标记 "\r\x07" 占 2 个位置；
       WPS 里只占 1 个 —— 也就是说 \x07 在 WPS 的位置空间里【零宽】。
       实测（2026-10-20，用 COM 读同一篇文档，证据可复跑）：
         Content.End − Content.Start = 12491，Content.Text.length = 13013，
         两者相差 522，正好等于全文 \x07 的个数（522 个）；
         Range(387,388).Text = "\r\x07"（2 个字符，占 1 个位置）。
       后果：只要把"位置相减"当成"文本下标"，一跨过表格单元格就会整体左偏，
       模糊识别于是圈到【别的数字】（实测圈到了上一行的身份证号），
       那个数字又被保护区拦住 → 可处理处数 0 → 静默没反应。
       这就是"表格里的数字点千分符/乘除没反应"的根因。
       规矩：下标 ↔ 位置一律走下面两个函数，不许再直接相减。 */
    function posFromIdx(t, idx) {                 // 文本下标 → 位置增量
        var e = Math.min(idx, t.length), n = 0, i;
        for (i = 0; i < e; i++) { if (t.charAt(i) === '\x07') { n++; } }
        return e - n;
    }
    function idxFromPos(t, off) {                 // 位置增量 → 文本下标
        var i = 0, p = 0, n = t.length;
        while (i < n && p < off) {
            if (t.charAt(i) === '\x07') { i++; continue; }   // \x07 零宽：只吃字符、不吃位置
            i++; p++;
        }
        /* 边界落在"格尾标记对"里时，把零宽的 \x07 一并跳过 ——
           位置边界应当贴着它【后面】那个字符，否则光标会被判定成"停在标记上"，
           模糊识别就会说"不挨任何数字"（实测症状：表格里点了没反应）。 */
        while (i < n && t.charAt(i) === '\x07') { i++; }
        return i;
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

    /* alphaFromNumber 的反函数：A→1、Z→26、AA→27。
       必须和 alphaFromNumber 用同一套进位（A=1 的 26 进制），否则
       「A B C」格式在正文里改成「AA」再点一次会算成别的数。 */
    function lettersToNumber(s) {
        if (!/^[A-Za-z]{1,2}$/.test(String(s || ''))) return null;
        var t = String(s).toUpperCase(), v = 0;
        for (var i = 0; i < t.length; i++) v = v * 26 + (t.charCodeAt(i) - 64);
        return v > 0 ? v : null;
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

    /* 【统一格式模式】只重写"已经带序号"的段落，没有序号的段落一律不动。
       为什么需要它（2026-10-24 用户反馈）：
         用户要把散在文档里的三处「（1）（2）（3）」统一改成「01 02 03」。
         Ctrl 多选做不到（WPS 桌面接口读不到多选区，Selection.Range 只代表一块），
         而连续选区会把中间那些正文段（"项目由①创新孵化中心…"「其中：」）
         也当成待编号的段落 —— 那些段没有序号，填序号模式会给它们硬加编号。
         统一格式模式正好补这个缺口：**从第一处序号拖到最后一处序号，
         只重写带序号的那些，中间正文原样不动**，一次就能全改完。

       返回的计划项与 seqPlanParagraphs 同构（index/value/start/length/
       oldPrefix/prefix/neu），写回逻辑可以完全复用。 */
    function seqPlanUnify(texts, fmtIndex) {
        var out = [], i;
        for (i = 0; i < texts.length; i++) {
            var body = String(texts[i] == null ? '' : texts[i]).replace(/[\r\n\u0007\u0001\u0002]/g, '');
            if (body.replace(/[\s\u3000]/g, '') === '') continue;   // 空段：不动
            var lead = seqParaLead(body);
            if (!lead || lead.value === null) continue;             // 没有序号 → 不动
            if (lead.end <= lead.start) continue;
            var prefix = seqPrefixFor(fmtIndex, lead.value);
            out.push({
                index: i,
                value: lead.value,
                start: lead.start,
                length: lead.end - lead.start,
                oldPrefix: body.slice(lead.start, lead.end),
                prefix: prefix,
                neu: body.slice(0, lead.start) + prefix + body.slice(lead.end)
            });
        }
        return out;
    }

    /* 自动判定该用哪种模式（v1.12.0）。
       判据：**选区里第一个非空段落有没有序号**。
         · 有  → 统一格式模式（用户八成是来"换格式"的）
         · 没有 → 填充模式（用户是来"从头编号"的）
       为什么用"第一个段落"而不是"有没有序号"：
         混合选区（有号的 + 没号的）若一律按"有没有"判，会让"从头编号"
         的用法失效——那正是这个功能最初要干的事。
       手动覆盖：DSH_OPTIONS.seqMode = 'fill' | 'unify' | 'auto'。 */
    function seqPickMode(texts) {
        var i, body, lead;
        for (i = 0; i < texts.length; i++) {
            body = String(texts[i] == null ? '' : texts[i]).replace(/[\r\n\u0007\u0001\u0002]/g, '');
            if (body.replace(/[\s\u3000]/g, '') === '') continue;   // 跳过空行
            lead = seqParaLead(body);
            return (lead && lead.value !== null) ? 'unify' : 'fill';
        }
        return 'fill';
    }

    /* ================= 正文段落序号（v1.11.0） =================

       表格里的格子只有序号本身，正文段落却是「序号 + 一大段话」混在一行里。
       所以正文版不能复用 seqParse（它要求整串就是序号），必须单独抽出
       【段首那一截】来认。这是正文与表格唯一的实质差异。 */

    /* 段首能认的旧序号只有四种形态，每一种都必须有【显式边界】。
       为什么死守"显式边界"：正文里最常见的误判是「2024年12月31日」
       被当成序号 2024、「一是……」被当成序号「一」。锚点就是那个分隔符
       —— 没有分隔符就不是序号，只是恰好以数字/汉字开头的正文。

       ① 包裹型：（1）(1)【1】[1]（一）(一)(A)
       ② 裸 + 分隔符：1、 1. 1， 1： （空格【不算】分隔符，见下）
       ③ 带圈字符：① ⑴ ⒈ —— 单字符自成序号，无需分隔符
       ④ 不认「第X条」「第X项」：那是条款名，改写成「12、」会丢掉"条"字 */

    var RE_SEQ_WRAP = /^[（(【\[]\s*([0-9０-９]{1,3}|[零一两二三四五六七八九十]{1,3}|[A-Za-z]{1,2})\s*[）)】\]]/;
    /* 分隔符只认这七种。**半角空格不在内**：`1 月`、`1 条` 这类是量词短语，
       认了就会把「1 月 5 日」改成「1、月 5 日」。宁可漏判（叠加一个序号，看得见）
       也不能误判（改坏正文，看不出来）。 */
    var RE_SEQ_BARE = /^([0-9０-９]{1,3}|[零一两二三四五六七八九十]{1,3}|[A-Za-z]{1,2})\s*([、.．,，:：])/;

    /* 把一个序号 token 解析成数字：全角数字、中文数字、字母三种 */
    function seqTokenValue(tok) {
        var t = String(tok == null ? '' : tok);
        t = t.replace(/[０-９]/g, function (ch) {
            return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
        });
        if (/^\d{1,3}$/.test(t)) return parseInt(t, 10);
        if (/^[A-Za-z]{1,2}$/.test(t)) return lettersToNumber(t);
        return cnToNumber(t);
    }

    /* 段首拆解：缩进 + 旧序号。
       返回 start = 旧序号在整段里的起始下标（= 缩进长度），
            end   = 旧序号结束处的下标（认不出时 end === start，即"在此处插入"），
            value = 旧序号数值，认不出为 null
       缩进保留不动：中文公文首行缩进常用两个全角空格，把序号插到缩进前面
       会顶格，看着像排版坏了。

       【v1.11.2 叠号收敛】认出一个序号后，若它【后面紧跟着另一个可识别序号】，
       把那一串一起吞掉（只保留最外层那一个的数值）。
       为什么必须这样：2026-10-21 实测「换格式点两次」会叠成 `一、①10,000,000.00 元`——
       因为 ① 后面接数字时不被当成序号（见下 ②），于是本次只认到 `一、`，
       在它【前面】又插一个 → 越点越乱。叠号一旦产生就会自我强化，
       所以必须让识别端能吃掉"序号+序号"这种畸形前缀，一点点自己收敛回来。 */
    /* 吞叠号：吞掉【不同形态】的连写（`一、①`），以及【带圈同值自叠】（`①①`）。
       正文里的并列项不能被吞，判据分三层：
         · 裸格式（`1、` `一、`）自带顿号/点/逗号 → 连写是并列项，停手
         · 包裹型（`（一）（二）`）括号自身就是分隔 → 连写是并列项，停手
         · 带圈（`①①`）：没有分隔符，但要看【数值】——
             同值（`①①`）= 同一个号叠了两遍 = 叠号，吞
             异值（`①②`）= 并列两项 = 正文，停手
           （2026-10-21 质检发现：初版只按"有没有分隔符"判，把 `①②两种情形`
             吞成了 `1、两种情形`，删掉了 `②` —— 修叠号引入删内容，比原缺陷严重。
             数值相同才是叠号，这是圆号码唯一的可靠判据。）

       因此同 kind 时只有 circ 且【同值】继续吞；
       不同 kind（`一、①` 这种畸形混写）一律吞。 */
    function seqSwallowStacked(body, startIdx, endIdx, firstKind, firstValue) {
        var e = endIdx, guard = 0, kind = firstKind, val = firstValue;
        while (guard++ < 4) {
            var tail = body.slice(e);
            if (!tail) break;
            var L = seqParaLeadBare(tail);
            if (!L || L.value === null) break;
            if (L.kind === kind) {
                // 同形态：只有带圈且数值相同才是叠号
                if (L.kind !== 'circ') break;
                if (L.value !== val) break;
            }
            e = e + L.end;
            kind = L.kind;
            val = L.value;
        }
        return e;
    }

    /* 单层识别（不含"吞叠号"逻辑，供 seqSwallowStacked 递归用）。
       额外返回 kind = 'wrap' | 'circ' | 'bare'，
       让"吞叠号"能区分「不同形态连写（畸形，要吞）」和「同形态连写（正文，不能吞）」。 */
    function seqParaLeadBare(rest) {
        var m, v;
        // ① 包裹型
        m = RE_SEQ_WRAP.exec(rest);
        if (m) {
            v = seqTokenValue(m[1]);
            if (v !== null) return { start: 0, end: m[0].length, value: v, indent: 0, kind: 'wrap' };
        }
        /* ② 带圈字符（⑪ 这类超出 ⑳ 的不认）
           【v1.11.2】只挡字母，不挡数字。
           旧写法连数字一起挡，理由是"避免 ①a 误伤"；但带圈序号后面接数字是常态
           （`①10,000,000.00 元`、`①2024年`，带圈号本来就是自成一体的一格），
           挡住的结果是 ① 被当成正文、插件在它【前面】再插一个序号 →
           `一、①10,000,000.00 元`，换一次格式叠一层，越点越乱。
           字母仍要挡：`①a` 多半是型号/编号的一部分，不宜当序号改写。 */
        var cv = circledToNumber(rest.charAt(0));
        if (cv !== null && !/[A-Za-z]/.test(rest.charAt(1))) {
            return { start: 0, end: 1, value: cv, indent: 0, kind: 'circ' };
        }
        // ③ 裸 + 分隔符
        m = RE_SEQ_BARE.exec(rest);
        if (m) {
            v = seqTokenValue(m[1]);
            if (v !== null) {
                /* 【v1.11.1】分隔符后面紧跟数字 = 那是数字本身的一部分，不是序号收尾：
                   `10,000,000.00`（千分位逗号）、`3.5`（小数点）、`1:30`（时间冒号）。
                   没有这条，以金额/小数开头的段落会被当成「已有序号 10、」重写，
                   正文被改成 `10、000,000.00 元` —— 金额当场改坏，且看不出来。
                   顿号除外：`1、2024年工作要点` 是正经的序号后接数字开头正文。
                   宁可漏判（多叠一个序号，看得见、能改），不可误判。 */
                var sep = m[2];
                var nc = rest.charCodeAt(m[0].length);
                var digitNext = (nc >= 48 && nc <= 57) || (nc >= 0xFF10 && nc <= 0xFF19);
                if (!(digitNext && sep !== '、')) {
                    return { start: 0, end: m[0].length, value: v, indent: 0, kind: 'bare' };
                }
            }
        }
        return null;
    }

    function seqParaLead(raw) {
        var t = String(raw == null ? '' : raw);
        var i = 0;
        while (i < t.length) {
            var c = t.charAt(i);
            if (c === ' ' || c === '\u3000' || c === '\t' || c === '\u00A0') { i++; continue; }
            break;
        }
        var miss = { start: i, end: i, value: null, indent: i };
        if (i >= t.length) return miss;
        var rest = t.slice(i);

        var L = seqParaLeadBare(rest);
        if (!L) return miss;
        // 叠号收敛：`一、①` 这类【不同形态】连写一起吃掉，数值取最外层（最靠前）那个。
        // ⚠️ L.end 是【相对 rest】的下标，这里必须换算成整段内的绝对下标再传
        var end = seqSwallowStacked(t, i, i + L.end, L.kind, L.value);
        return { start: i, end: end, value: L.value, indent: i };
    }

    /* 正文里用的序号前缀：格式表里「裸」的几种要补顿号
       （`1` → `1、`，`一` → `一、`，`A` → `A、`），
       已经自带收尾标记的原样用（`1、`、`（1）`、`（一）`、`①`）。
       不补的话正文会变成「1这是正文」，序号和第一个字黏在一起。 */
    function seqPrefixFor(index, n) {
        var s = seqFormat(index, n);
        if (/[、.．,，:：)）】\]》」』”’]$/.test(s)) return s;   // 自带收尾
        if (s.length === 1 && circledToNumber(s) !== null) return s;   // ①
        return s + '、';
    }

    /* 正文段落编号计划。
       与表格版的语义保持一致，只是"空格"的定义不同：
         · 段首已有序号     → 保留原数值、只按新格式重写（= 换格式刷新）
         · 段首没有序号     → 接着上一个号往下填
         · 纯空白段落       → 跳过，既不编号也不占号（正文里的空行不该吃掉一个号）
         · renumberAll=true → 连同已有数值一起从 seqStart 重排
       返回 start/length 是【要替换的那一截】相对段文本的下标与长度，
       length=0 表示插入。整段文字不重写 —— 只碰段首那几个字符，
       正文的格式（加粗、字体、修订痕迹）才不会丢。 */
    function seqPlanParagraphs(texts, startValue, renumberAll, fmtIndex) {
        var last = (startValue || 1) - 1;
        var out = [];
        for (var i = 0; i < texts.length; i++) {
            var body = String(texts[i] == null ? '' : texts[i]).replace(/[\r\n\u0007\u0001\u0002]/g, '');
            if (body.replace(/[\s\u3000]/g, '') === '') continue;   // 空段：不占号
            var lead = seqParaLead(body);
            var v = (lead.value !== null && !renumberAll) ? lead.value : (last + 1);
            last = v;
            var prefix = seqPrefixFor(fmtIndex, v);
            out.push({
                index: i,
                value: v,
                start: lead.start,                      // 替换起点（缩进之后）
                length: lead.end - lead.start,          // 旧序号长度，0 = 插入
                oldPrefix: body.slice(lead.start, lead.end),
                prefix: prefix,
                neu: body.slice(0, lead.start) + prefix + body.slice(lead.end)
            });
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

    /* 多选区段落合并（v1.11.9）。
       输入：若干选区各自读到的段落记录 [{start, text}]
       输出：按【文档位置】排序、去掉重复段落后的列表。
       为什么要有这个：WPS 里可以用 Ctrl 选多个不连续的块，
       而插件若只按 Selection.Range 取段落，就只会看到其中一块 ——
       表现是"三个标题只编了一个"。
       排序是必须的：多个选区返回的顺序不保证与文档顺序一致，
       序号必须按文档顺序发，否则会出现"第二个标题编成（1）"。
       去重也是必须的：相邻选区可能共享边界段落。 */
    function seqMergeAreas(records) {
        var seen = {}, out = [], i, r, k;
        for (i = 0; i < (records || []).length; i++) {
            r = records[i];
            if (!r) continue;
            k = String(r.start);
            if (seen[k]) continue;
            seen[k] = true;
            out.push(r);
        }
        out.sort(function (a, b) { return a.start - b.start; });
        return out;
    }

    /* 生成给人看的摘要（v1.11.9）。
       为什么要有：正文填充序号一旦"没填全"，用户无从判断是
       选区没读到、还是段落跳过了、还是写入失败。
       以前成功走 console（用户看不到）、失败只弹一句"一段也没改成功"。
       现在一律弹摘要：选区数 / 段落数 / 写入 / 已符合 / 失败 / 跳过，
       外加前几段的内容，让人一眼看出插件到底处理了哪几段。 */
    function seqSummary(o) {
        var L = [];
        L.push('填充序号（正文）');
        L.push('');
        L.push('选区 ' + (o.areaCount || 1) + ' 个 ｜ 段落 ' + (o.paraCount || 0) + ' 段' +
               (o.skipped ? '（表格内跳过 ' + o.skipped + '）' : ''));
        L.push('写入 ' + (o.done || 0) + ' ｜ 已符合 ' + (o.unchanged || 0) +
               ' ｜ 失败 ' + (o.failed || 0));
        L.push('格式：' + (o.format || ''));
        if (o.changes && o.changes.length) {
            L.push('');
            L.push('编号改动：');
            for (var c = 0; c < o.changes.length; c++) L.push('  ' + o.changes[c]);
        }
        if (o.snips && o.snips.length) {
            L.push('');
            L.push('处理到的段落：');
            for (var i = 0; i < o.snips.length; i++) L.push('  ' + o.snips[i]);
        }
        if (o.probe && o.probe.length) {
            L.push('');
            L.push('接口探测：' + o.probe.join('、'));
        }
        if (o.notes && o.notes.length) {
            L.push('');
            for (var j = 0; j < o.notes.length; j++) L.push(o.notes[j]);
        }
        return L.join('\n');
    }

    /* 要不要弹窗？（v1.11.11）
       用户明确要求：成功就别弹了，多麻烦。
       判据只看【有没有需要人处理的事】：
         · 失败 > 0            → 弹（错误必须可见）
         · 什么都没发生        → 弹（选区全是空行之类，属于异常）
         · 写成了 / 已经符合    → 不弹（成果已经摆在文档里了，再弹一遍是打扰）
       结果不丢：成功信息改放在功能区菜单标题上（见 seqStatusText）。 */
    function seqNeedPopup(o) {
        if ((o.failed || 0) > 0) return true;
        if ((o.done || 0) === 0 && (o.unchanged || 0) === 0) return true;
        return false;
    }

    /* 功能区标题上的状态文字：成功也让人看得到，但不打断 */
    function seqStatusText(o) {
        var bits = [];
        if (o.done) bits.push((o.mode === 'unify' ? '已统一 ' : '已写入 ') + o.done + ' 段');
        if (o.unchanged) bits.push(o.done ? (o.unchanged + ' 段已符合') : ('已符合 ' + o.unchanged + ' 段'));
        if (o.failed) bits.push('失败 ' + o.failed + ' 段');
        if (!bits.length) bits.push('无可编号段落');
        return bits.join('，');
    }

    return {
        compute: compute, applyChanges: applyChanges,
        seqPlan: seqPlan, seqFormat: seqFormat, seqParse: seqParse,
        seqFormatCount: SEQ_FORMATS.length,
        seqFormatLabel: function (i) { return (SEQ_FORMATS[i] || SEQ_FORMATS[0]).label; },
        seqParaLead: seqParaLead, seqPlanParagraphs: seqPlanParagraphs,
        seqPrefixFor: seqPrefixFor, lettersToNumber: lettersToNumber,
        seqMergeAreas: seqMergeAreas, seqSummary: seqSummary,
        seqNeedPopup: seqNeedPopup, seqStatusText: seqStatusText,
        seqPlanUnify: seqPlanUnify, seqPickMode: seqPickMode,
        seqIsMarked: seqIsMarked,
        cleanBreaks: cleanBreaks,
        sumNumbers: sumNumbers, formatNumber: formatNumber,
        cmpVersion: cmpVersion,
        expandSpan: expandSpan, filterChanges: filterChanges,
        posFromIdx: posFromIdx, idxFromPos: idxFromPos,
        hasUnitAtChainEnd: hasUnitAtChainEnd,
        unitNear: unitNear, numberEndingAt: numberEndingAt,
        parseUnit: parseUnit, readScale: readScale, expShift: expShift, expToScale: expToScale,
        hasScaleWord: hasScaleWord
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DshEngine;
    /* 把两个"打开对话框"的胶水函数也导出去 —— 好让 Node 测试用一个假的 wps 对象
       真的调用它们。这层代码原先零覆盖：2026-10-19 因为 DSH_showUpdateDialog 里
       误引用了对话框页才有的 q 变量（ReferenceError 被 try/catch 吞掉），
       表现为"对话框从来不弹、永远退回系统弹窗"，而 261 项测试全绿。 */
    module.exports.DSH_showUpdateDialog = DSH_showUpdateDialog;
    module.exports.DSH_showResultDialog = DSH_showResultDialog;
}

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

/* 按次覆盖的选项：某一次操作专用。null = 用 DSH_OPTIONS。
   为什么用模块级变量而不是层层传参：选项要在 compute() 里被读到，
   从功能区回传到那里要穿过 DSH_run → DSH_runNumbers/DSH_runTable → compute 四层，
   层层加参数既啰嗦、又极容易漏一处 —— 而漏一处就是【静默用错选项】。
   只在 DSH_run 里设置、finally 里还原，作用域就被限制在"一次点击"内。 */
var DSH_RUN_OPT = null;

function DSH_effOpts() {
    if (!DSH_RUN_OPT) return DSH_OPTIONS;
    var o = {}, k;
    for (k in DSH_OPTIONS) { if (Object.prototype.hasOwnProperty.call(DSH_OPTIONS, k)) o[k] = DSH_OPTIONS[k]; }
    for (k in DSH_RUN_OPT) { if (Object.prototype.hasOwnProperty.call(DSH_RUN_OPT, k)) o[k] = DSH_RUN_OPT[k]; }
    return o;
}
/* 取【光标所在段落】的 Range。
   为什么需要它：模糊识别没命中时的退路不能再是"整篇"（见 DSH_run 里的说明）。

   三层取法，从省到稳：
     ① Selection.Paragraphs.Item(1).Range      —— 最直接
     ② Selection.Range.Paragraphs.Item(1).Range —— 换个入口再试
     ③ 纯文本扫描：取全文文本，在【文本下标】里找光标前后的段落标记
        （⚠️ 位置与下标在表格里不等 ——  零宽，所以必须用 idxFromPos/posFromIdx 换算，
          不能用 pos - start 直接当偏移）
   三层都拿不到就返回 null —— 由调用方决定怎么办（绝不能默认整篇）。 */
async function DSH_paragraphRange(doc, sel, diag) {
    // ① ②
    try {
        var paras = await DSH_P(sel, 'Paragraphs');
        if (!paras) {
            var selRange = await DSH_P(sel, 'Range');
            if (selRange) paras = await DSH_P(selRange, 'Paragraphs');
        }
        if (paras) {
            var n = Number((await DSH_P(paras, 'Count')) || 0);
            if (n >= 1) {
                var p1 = await DSH_R(paras.Item(1));
                if (p1) {
                    var pr = await DSH_P(p1, 'Range');
                    if (pr) return pr;
                }
            }
        }
    } catch (e) {
        diag.push('取段落(API)失败: ' + (e && e.message ? e.message : e));
    }
    // ③ 纯文本扫描
    try {
        var cur = Number(await DSH_P(sel, 'Start'));
        var contentRange = await DSH_P(doc, 'Content');
        if (contentRange && isFinite(cur)) {
            var full = String((await DSH_P(contentRange, 'Text')) || '');
            var basePos = Number((await DSH_P(contentRange, 'Start')) || 0);
            if (full.length) {
                /* 光标在全文里的【文本下标】 */
                var ti = DshEngine.idxFromPos(full, cur - basePos);
                if (ti < 0) ti = 0;
                if (ti > full.length) ti = full.length;
                /* 向前找最近的段落标记（
 /  都算单元格/段落结束） */
                var s = ti;
                while (s > 0) {
                    var c0 = full.charAt(s - 1);
                    if (c0 === '\r' || c0 === '\x07') break;
                    s--;
                }
                /* 向后找最近的段落结束 */
                var e2 = ti;
                while (e2 < full.length) {
                    var c1 = full.charAt(e2);
                    if (c1 === '\r' || c1 === '\x07') { e2++; break; }
                    e2++;
                }
                var startPos = basePos + DshEngine.posFromIdx(full, s);
                var endPos = basePos + DshEngine.posFromIdx(full, e2);
                if (endPos > startPos) {
                    var r = await DSH_R(doc.Range(startPos, endPos));
                    if (r) return r;
                }
            }
        }
    } catch (e) {
        diag.push('取段落(文本扫描)失败: ' + (e && e.message ? e.message : e));
    }
    return null;
}

async function DSH_run(mode, diagnoseOnly, unitConvert) {
    var prevOpt = DSH_RUN_OPT;
    DSH_RUN_OPT = (typeof unitConvert === 'boolean') ? { unitConvert: unitConvert } : null;
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
        diag.push('表格单元格=' + cellCount);
        if (cellCount > 1) {
            diag.push('目标=表格 ' + cellCount + ' 个单元格（逐格处理）');
            return await DSH_runTable(app, doc, sel, cells, cellCount, mode, diagnoseOnly, diag);
        }

        /* —— 模糊识别（2026-10-20 用户需求）——
           光标点在数字中间/紧贴两侧，或选区只盖住数字的一部分时，
           只处理"完整数字"本身：不把片段当独立数字算，也不动整篇。
           三个数字功能都走这条路（千分符 / 乘 / 除），心智模型一致：
           「光标或选区挨着哪个数字，就只动哪个数字」。
           拿不到位置、或光标/选区不挨任何数字 → 走老逻辑（选区/整篇），与旧版完全一致。 */
        var target = null, basePos = 0, text = '', changes = null, fuzzy = false;
        try {
            var posS = Number(await DSH_P(sel, 'Start'));
            var posE = Number(await DSH_P(sel, 'End'));
            if (isFinite(posS) && isFinite(posE) && posS >= 0 && posE >= posS) {
                /* 先拿正文末尾位置当上界：Range(a, 超过末尾) 在 WPS 里可能直接抛错，
                   抛出来就会被下面的 catch 吞掉、静默退回老逻辑（=处理整篇）。 */
                var docEndPos = Number((await DSH_P(await DSH_P(doc, 'Content'), 'End')) || 0);
                if (!isFinite(docEndPos) || docEndPos <= 0) { docEndPos = 0; }
                var probeA = Math.max(0, posS - 120);
                var probeB = (docEndPos && posE + 120 > docEndPos) ? docEndPos : posE + 120;
                var probeRange = await DSH_R(doc.Range(probeA, probeB));
                var probeText = String((await DSH_P(probeRange, 'Text')) || '');
                /* ⚠️ 不能写成 posS - probeA：索引是"文本下标"，posS/probeA 是"位置"，
                   表格里每个 \x07 都让两者差 1（见 posFromIdx 的实测说明）。 */
                var relS = DshEngine.idxFromPos(probeText, posS - probeA);
                var relE = DshEngine.idxFromPos(probeText, posE - probeA);
                var wantUnit = DSH_effOpts().unitConvert === true && (mode === 'mul' || mode === 'div');
                var span = DshEngine.expandSpan(probeText, relS, relE, wantUnit);
                diag.push('光标位置=' + posS + '..' + posE + ' 探针=' + probeA + '..' + probeB +
                          ' 探针长度=' + probeText.length + ' 表内下标=' + relS + '..' + relE);
                if (span) {
                    /* 上下文窗口再各扩 40 字符：日期/文号/证件这些保护区要靠上下文才认得出。
                       例如光标点在「2024年12月31日」的年份上，圈出的虽然只是 2024，
                       但窗口里有完整日期，保护区照样拦得住。 */
                    var spanPosA = probeA + DshEngine.posFromIdx(probeText, span.s);
                    var spanPosB = probeA + DshEngine.posFromIdx(probeText, span.e);
                    var ctxA = Math.max(0, spanPosA - 40);
                    var ctxB = (docEndPos && spanPosB + 40 > docEndPos) ? docEndPos : spanPosB + 40;
                    var ctxRange = await DSH_R(doc.Range(ctxA, ctxB));
                    var ctxText = String((await DSH_P(ctxRange, 'Text')) || '');
                    /* 圈定范围也要用下标表示：ctxText 里同样有 \x07（整篇/跨格窗口一定有）。 */
                    var sIdx = DshEngine.idxFromPos(ctxText, spanPosA - ctxA);
                    var eIdx = DshEngine.idxFromPos(ctxText, spanPosB - ctxA);
                    changes = DshEngine.filterChanges(
                        DshEngine.compute(ctxText, mode, DSH_effOpts()), sIdx, eIdx);
                    basePos = ctxA;
                    text = ctxText;
                    fuzzy = true;
                    diag.push('目标=模糊识别（' + JSON.stringify(probeText.slice(span.s, span.e)) + '）');
                    diag.push('模糊范围内可处理=' + changes.length);
                } else {
                    diag.push('模糊识别=不适用（光标/选区不挨数字）');
                }
            }
        } catch (e) {
            diag.push('模糊识别异常（退回老逻辑）: ' + (e && e.message ? e.message : e));
            fuzzy = false;
        }

        /* 模糊识别没命中时的退路（2026-10-20 用户报障修）：
           旧退路是【整篇正文】—— 光标点在"单位"上、或点在数字与单位之间的空格上时，
           模糊识别认不出数字（expandSpan 只认数字 token），于是退回整篇，
           结果【表格里用户根本没碰过的格子也一起被除了】。
           实测：光标停在"1,000.00 万元"的"万"字上，点除以一万（改单位），
                 表格里的 100 和 1000000元 都被除了，而用户只想改那一段。

           改法：退路【不再整篇】，改成【光标所在的那一段】。
           · 有选区 → 照旧处理选区
           · 无选区 → 只处理光标所在段落
           "光标在段落里"这件事本身就说明了用户的意图范围；
           整篇是比用户意图【大得多】的范围，误伤成本不对称 ——
           少改一处用户会自己补，多改一处可能改坏审计报告。
           真的想处理整篇：把光标放到一个【空段落】里（那里没有数字、也没有段落可改），
           或者直接选中整篇再点。 */
        if (!fuzzy) {
            if (hasSel) {
                target = await DSH_P(sel, 'Range');
                diag.push('目标=选区');
            } else {
                target = await DSH_paragraphRange(doc, sel, diag);
                diag.push('目标=光标所在段落');
            }
            if (!target) {
                /* 连段落都拿不到 → 【不动】，并说清楚怎么办。
                   ⚠️ 绝不能在这里退回整篇：那正是本次修掉的误伤来源
                   （用户没碰过的表格格子被一起除了）。
                   想处理整篇：Ctrl+A 全选后再点（有选区走选区那条路）。 */
                DSH_say('便捷插件：没找到光标所在的段落，这一处没有改动。\n\n'
                    + '请确认文档已打开、光标在正文里。\n'
                    + '若要处理整篇，请先 Ctrl+A 全选再点（选中状态会按选区处理）。');
                return;
            }

            text = String((await DSH_P(target, 'Text')) || '');
            basePos = Number((await DSH_P(target, 'Start')) || 0);
            diag.push('文本长度=' + text.length);
            changes = DshEngine.compute(text, mode, DSH_effOpts());
        }
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

        var done = 0, failed = 0, units = 0, samples = [];
        for (var i = changes.length - 1; i >= 0; i--) {
            var c = changes[i];
            try {
                /* 写回地址必须用 posFromIdx 换算：c.start 是【文本下标】，
                   text 里每个 \x07 都不占位置（表格里差 1 个位置/格）。 */
                var wA = basePos + DshEngine.posFromIdx(text, c.start);
                var wB = basePos + DshEngine.posFromIdx(text, c.start + c.length);
                var r = await DSH_R(doc.Range(wA, wB));
                if (!r) { failed++; continue; }
                var cur = String((await DSH_P(r, 'Text')) || '');
                if (cur !== c.old) { failed++; continue; }
                r.Text = c.neu;                                        // 写入
                var back = String((await DSH_P(r, 'Text')) || '');
                if (back !== c.neu) { failed++; continue; }             // 写回自检
                if (c.unit) { units++; } else { done++; }
                if (samples.length < 3) samples.push(c.old + ' → ' + c.neu);
            } catch (e) {
                failed++;
                if (diag.length < 14) diag.push('替换异常: ' + (e && e.message ? e.message : e));
            }
        }

        var label = mode === 'thousands' ? '已加千分符' : (mode === 'mul' ? '已乘以一万' : '已除以一万');

        /* 「（改单位）」按键：整段区域里一个数都没改动，但原因很可能是
           "单位已在链条尽头，整数与单位一起不动"——这是【有意的保护】，
           不是没反应。必须说清楚，否则用户只会以为插件坏了。
           判据：确实开了 unitConvert，且原文里存在"数字+链条尽头单位"的组合。 */
        if (done === 0 && failed === 0 && DSH_RUN_OPT && DSH_RUN_OPT.unitConvert === true
            && (mode === 'mul' || mode === 'div')) {
            var atTop = DshEngine.hasUnitAtChainEnd(text);
            if (atTop) {
                DSH_say('便捷插件：这一段没有改动。\n\n'
                    + '原因：单位已在这条换算链的' + (mode === 'mul' ? '最底档（元）' : '最高档（万亿元）')
                    + '，再往上/往下就没有档位可换了。\n'
                    + '如果照常改数字而单位不动，金额就会凭空变一万倍，\n'
                    + '所以数字和单位一起保持原样。\n\n'
                    + '想换写法：先把单位手动改到能承接的那一档，再点一次。\n'
                    + '例：100元 → 改成 100万元 → 再点「乘以一万（改单位）」→ 1,000,000.00元');
                return;
            }
        }

        if (done === 0) {
            // 找到了该处理的数字却一处也没写成功 = 真出问题了，必须弹窗
            DSH_say('便捷插件：一处也没改成功。\n\n' + diag.join('\n'));
            return;
        }

        /* 单位换算必须报出来：数字和单位一起变了，用户不知道的话，
           会以为只是数字变了 —— 实际是金额口径变了。 */
        var unitNote = '';
        if (units) {
            var appended = 0;
            for (var ui = 0; ui < changes.length; ui++) { if (changes[ui].appended) appended++; }
            unitNote = '，另换算 ' + units + ' 处单位（' + (mode === 'mul' ? '万元→元' : '元→万元/万元→亿元') + '）' +
                       (appended ? '，其中 ' + appended + ' 处默认按「元」补了单位' : '');
        }
        DSH_quiet(label + '：已处理 ' + done + ' 处' + unitNote +
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
    } finally {
        /* 一次点击用完就还原：作用域严格限制在本次操作内。
           虽然现在每个回调都显式传了 true/false，但还原不能省 ——
           将来任何一处漏传，stale 的 true 会让"不改单位"的按键偷偷改单位。 */
        DSH_RUN_OPT = prevOpt;
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
    /* （改单位）模式下，圈定范围要连同紧跟数字的金额单位一起扩——数字和单位同进同出 */
    var wantUnit = DSH_effOpts().unitConvert === true && (mode === 'mul' || mode === 'div');
    for (i = 1; i <= count; i++) {
        var cell = await DSH_R(cells.Item(i));
        if (!cell) continue;
        var cr = await DSH_P(cell, 'Range');
        if (!cr) continue;
        var c0 = Number((await DSH_P(cr, 'Start')) || 0);
        var c1 = Number((await DSH_P(cr, 'End')) || 0);
        var a = Math.max(s0, c0), b = Math.min(s1, c1);
        if (!(b > a)) continue;
        /* 模糊识别（表格版）：选区边界切进格内数字时，以【整格文本】为上下文，
           把与选区重叠的完整数字圈出来，只对圈定范围内的变更写回。
           整格文本天然包含格内日期/文号等保护上下文；格子小，不用再扩窗口。 */
        var cellText = String((await DSH_P(cr, 'Text')) || '');
        /* 格内位置 → 格内下标：同一套换算（格尾那个 \x07 也不占位置） */
        var span = DshEngine.expandSpan(
            cellText,
            DshEngine.idxFromPos(cellText, a - c0),
            DshEngine.idxFromPos(cellText, b - c0),
            wantUnit);
        var ch, base, t;
        if (span) {
            ch = DshEngine.filterChanges(
                DshEngine.compute(cellText, mode, DSH_effOpts()), span.s, span.e);
            base = c0;
            t = cellText;
        } else {
            var part = await DSH_R(doc.Range(a, b));
            if (!part) continue;
            t = String((await DSH_P(part, 'Text')) || '');
            ch = DshEngine.compute(t, mode, DSH_effOpts());
            base = a;
        }
        total += ch.length;
        if (ch.length) jobs.push({ base: base, changes: ch, text: t });
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

    var done = 0, failed = 0, units = 0, samples = [];
    for (i = jobs.length - 1; i >= 0; i--) {
        var job = jobs[i];
        for (var k = job.changes.length - 1; k >= 0; k--) {
            var c = job.changes[k];
            try {
                /* 同 DSH_run：job.text 是读回来的文本，c.start 是它的下标，写回先换算成位置 */
                var wA2 = job.base + DshEngine.posFromIdx(job.text, c.start);
                var wB2 = job.base + DshEngine.posFromIdx(job.text, c.start + c.length);
                var rr = await DSH_R(doc.Range(wA2, wB2));
                if (!rr) { failed++; continue; }
                var cur = String((await DSH_P(rr, 'Text')) || '');
                if (cur !== c.old) { failed++; continue; }
                rr.Text = c.neu;
                var back = String((await DSH_P(rr, 'Text')) || '');
                if (back !== c.neu) { failed++; continue; }
                if (c.unit) { units++; } else { done++; }
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

/* 上次「填充序号」的结果文字（v1.11.11）：显示在功能区菜单标题上。
   成功时不再弹窗（少打扰），结果靠它传达；空 = 还没操作过。 */
/* v1.14.0：操作结果不再显示在功能区（用户要求）。成功静默、失败弹窗；
   控制台里仍留一行 seqStatusText 便于排查。 */

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

        // 选区在表格里才有 Cells；不在表格里 Count 为 0 → 走正文段落分支
        var cells = await DSH_P(sel, 'Cells');
        var count = cells ? Number((await DSH_P(cells, 'Count')) || 0) : 0;
        if (!count) {
            await DSH_fillSequenceParagraphs(doc, sel, diag);
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

/* 探测选区对象上可能存在的多选区入口（v1.11.10）。
   为什么要有：2026-10-24 实测，WPS 桌面版的 Selection.Range 在 Ctrl 多选下
   只暴露其中一块，而 Areas.Count 恒为 0 —— 文档里查不到多选区该怎么读，
   只能靠探测确认这台机器到底给不给。
   探到就用（能支持多选最好），探不到就在摘要里如实列出，
   下次遇到同类问题不必再从头猜。
   纯读取、无副作用，探测失败一律忽略。 */
var SEL_MULTI_PROPS = ['Ranges', 'Areas', 'Selections', 'MultiSelections', 'Blocks', 'Items'];

async function DSH_probeMultiSel(sel, diag) {
    var found = [], out = [];
    try {
        var selRg = await DSH_P(sel, 'Range');
        for (var i = 0; i < SEL_MULTI_PROPS.length; i++) {
            var name = SEL_MULTI_PROPS[i], coll = null;
            if (selRg) { try { coll = await DSH_P(selRg, name); } catch (e) { } }
            if (!coll) { try { coll = await DSH_P(sel, name); } catch (e2) { } }
            if (coll === undefined || coll === null) continue;
            var cnt = -1;
            try { cnt = Number((await DSH_P(coll, 'Count')) || 0); } catch (e3) { }
            found.push(name + '(Count=' + cnt + ')');
            out.push({ name: name, coll: coll, count: cnt });
        }
    } catch (e) {
        diag.push('多选区探测异常(已忽略): ' + (e && e.message ? e.message : e));
    }
    return { found: found, hits: out };
}

/* ======================= 填充序号 · 正文段落（v1.11.0） =======================

   与表格版的关系：同一张格式表、同一个起始值、同一条「已有编号保留原值」的语义。
   唯一的实质差别是"空格"的定义 —— 表格里空格是空单元格，
   正文里空格是"段首没有序号标记"，所以判定从"整格是否为空"变成"段首那一截是不是序号"。

   写回只碰【段首那一截】，不重写整段。整段重写会连加粗、字体、修订痕迹
   一起抹掉——那是不可接受的副作用，也是正文版与表格版最大的实现分歧。 */
/* 捕获用户选中的所有段落（含 Ctrl 多选）—— v1.13.0
   ============================================================
   背景：Word/WPS 的 Selection.Range 在多选区下只代表【其中一块】
   （微软 KB 288424 明确写了"VBA 无法遍历非连续选区"），WPS 实测也一样。
   但同一个 KB 和二十年来的社区实践指出一条公开的绕过路径：
   **给 Selection 整体设置字体格式，会作用到所有选区块**。

   所以流程是：
     ① 给整个 Selection 盖一个临时标记 = 字符阴影 Shadow
        （选 Shadow 的理由：普通公文正文几乎不会用这个效果，误伤面最小）
     ② 逐段读 Range.Font.Shadow，被标记的就是用户选中的段（含半段混合值）
     ③ doc.Undo() 精确撤销标记（实测全部回到 0），失败再强制清除
     ④ 返回这些段落，按文档位置排序后统一编号

   实测依据（2026-10-24，WPS COM 探针，可复跑）：
     标记值：-1（已标记）/ 9999999（混合，半段被选中）/ 0（未标记）
     doc.Undo() 后全部回到 0，无残留。

   安全设计：
     · 只在【有选区】时执行（光标状态下给 Selection 设格式会污染后续输入）
     · 任何一步失败 → 返回 null，调用方退回单选区路径（行为不变）
     · 段落过多（>1000）时跳过，避免逐段异步读取卡住大文档
     · 清除标记与设标记同路径、逐段验证（见下方事故记录） */
async function DSH_captureSelParagraphs(doc, sel, diag) {
    var marked = [], ok = false;
    var didMark = false;
    try {
        var paras = await DSH_P(doc, 'Paragraphs');
        var pn = paras ? Number((await DSH_P(paras, 'Count')) || 0) : 0;
        if (pn > 1000) {
            diag.push('多选区捕获: 段落过多（' + pn + ' > 1000），跳过以免卡顿');
            return null;
        }

        /* 【v1.14.1 关键修复】盖标记前，先把【全文】的字符阴影清零。
           为什么必须先清零（2026-10-24 用户实测事故"连续使用要么无效，要么连带瞎改"）：
             标记是"哪段有阴影"，而阴影会**跨次累积**——上一次操作若留下残留，
             这次扫描会把"上次选过的段落"也算成"这次选中的"，后果：
               · 模式判定被排在前面的残留段带偏（有序号 → 统一格式）→ 新选的无序号段不动 → 点了像没反应
               · 或填充模式把上次的段一起重编 → 连带之前的范围瞎改
             先清零再盖标记，保证"读到的标记必然是本次盖的"，同时自愈被污染的文档。
           代价：全文原有的字符阴影会被清掉——Shadow 是极少用的装饰效果，
           且不清零就无法支撑 Ctrl 多选，权衡后接受（README / 悬停提示已写明）。 */
        var content0 = await DSH_P(doc, 'Content');
        if (content0) {
            var cf0 = await DSH_P(content0, 'Font');
            if (cf0) { try { cf0.Shadow = false; } catch (e0) { } }
        }

        var font = await DSH_P(sel, 'Font');
        if (!font) { diag.push('多选区捕获: 拿不到 Selection.Font（退回单选区）'); return null; }
        try { font.Shadow = true; didMark = true; }
        catch (e1) {
            diag.push('多选区捕获: 盖标记失败 ' + (e1 && e1.message ? e1.message : e1));
            return null;
        }

        for (var i = 1; i <= pn; i++) {
            var p = await DSH_R(paras.Item(i));
            if (!p) continue;
            var r = await DSH_P(p, 'Range');
            if (!r) continue;
            var f = await DSH_P(r, 'Font');
            var sv = f ? (await DSH_P(f, 'Shadow')) : 0;
            if (!DshEngine.seqIsMarked(sv)) continue;
            marked.push({
                p: p,
                start: Number(await DSH_P(r, 'Start')),
                text: String((await DSH_P(r, 'Text')) || '')
            });
        }
        ok = true;
    } catch (e) {
        diag.push('多选区捕获异常(已退回单选区): ' + (e && e.message ? e.message : e));
    }

    /* ---- 清除标记（与设标记同路径，并逐段验证）----
       【2026-10-24 实测事故】第一版用 doc.Undo() 撤销，它"调用成功"却
       实际没撤掉阴影，用户文档里三段文字残留了字符阴影（像素级截图确认）。
       盲信 Undo 的返回值 = 静默改坏文档。现在：
         ① 与设标记同路径清除（sel.Font.Shadow = false，对称操作）
         ② 逐段读回验证；不干净就重试，再不行就【中止整个操作】
       不再用 doc.Undo()：它可能撤掉用户自己的上一步，且结果不可验证。 */
    if (didMark) {
        var remain = -1;
        for (var attempt = 1; attempt <= 2; attempt++) {
            /* 重新取 Selection/Font —— JSAPI 代理对象可能在长循环后失效 */
            var sel2 = await DSH_P(doc, 'Selection');
            if (!sel2) sel2 = sel;
            var f2 = await DSH_P(sel2, 'Font');
            if (f2) {
                try { f2.Shadow = false; } catch (e2) { }
            }
            /* 验证：被标记的段落阴影是否真的回到 0（最多抽验 30 段） */
            remain = 0;
            for (var k = 0; k < marked.length && k < 30; k++) {
                try {
                    var pr = await DSH_P(marked[k].p, 'Range');
                    var pf = pr ? await DSH_P(pr, 'Font') : null;
                    var sv2 = pf ? (await DSH_P(pf, 'Shadow')) : 0;
                    if (DshEngine.seqIsMarked(sv2)) remain++;
                } catch (e3) { remain++; }
            }
            if (remain === 0) break;
        }
        if (remain > 0) {
            diag.push('标记清除失败：' + remain + ' 段仍带字符阴影（已中止本次操作，请选中那几段手动取消阴影：字体设置 Ctrl+D → 取消「阴影」）');
            return null;
        }
        diag.push('标记清除验证通过');
    }
    return (ok && marked.length) ? marked : null;
}

async function DSH_fillSequenceParagraphs(doc, sel, diag) {
    /* ---- ① 不再要求"选区必须从段首开始"（2026-10-22 用户要求）----
       旧版会拦：选区起点不在段首就弹「请从段首开始拉选区」，用户选了半天被一句话打回。

       现在的规则：**只要有选区，就把选区覆盖到的所有段落都编号**（空行照旧跳过）。

       为什么放开是安全的 —— 关键在【序号插在哪里】：
         写回地址用的是【段落自身的 Range.Start】（见下面 metas 那行），
         也就是序号永远落在**段落的开头**，与选区从哪儿开始、结束在哪儿都无关。
         旧注释里"会在句子中间插进一个序号"担心的那个场景，
         在现在的写回实现里并不存在 —— 插号位置取的是段落起点，不是选区起点。

       选区只盖住半句时，被编号的是【那一整段】（序号加在段首），
       这也正是"识别所有段落"该有的样子。 */
    var selRaw = String((await DSH_P(sel, 'Text')) || '');
    var hasSel = DSH_trim(selRaw).length > 0;
    diag.push('正文选区长度=' + DSH_trim(selRaw).length);
    diag.push('选区范围=' + (hasSel ? '按选区覆盖的全部段落处理（不再要求从段首开始）' : '无选区：处理光标所在段落'));

    var ranges = [];
    /* ---- ② 取所有选区（v1.11.9/1.11.10：多路探测 + 降级提示）----
       背景（2026-10-24 用户实测）：用 Ctrl 选中三个不连续的标题，点「填充序号」，
       结果只给其中一个改了格式，另外两个没动 —— 表现是"没有完整填充"。
       原因：Word/WPS 的 Selection.Range 在多选区下只代表【其中一块】，
       插件据此取 Paragraphs，就只看到那一块的段落。

       对策：把选区对象上所有可能的多选区入口都探一遍
         ① sel.Range.Areas / sel.Areas
         ② sel.Ranges / sel.Selections / sel.Blocks / sel.Items（v1.11.10 补充探测）
       探到 Count>1 的就用（能支持多选最好）；
       探不到就如实告诉用户"只读到 1 个选区"，并给出**能立刻用的替代做法**：
         · 逐个标题分别点一次 —— 已带编号的段落会保留原值、只换格式，
           点几次就统一几次（这是本插件本来就有的语义，不是 workaround）；
         · 或从第一个拖到最后一个连续选区 —— 但中间正文也会一起被编号。 */
    var ranges = [], probeFound = [];
    var probe = await DSH_probeMultiSel(sel, diag);
    probeFound = probe.found;
    for (var hi = 0; hi < probe.hits.length; hi++) {
        var hit = probe.hits[hi];
        if (hit.count > 1) {
            diag.push('采用多选区入口 ' + hit.name + '，共 ' + hit.count + ' 块');
            for (var hj = 1; hj <= hit.count; hj++) {
                var ar2 = await DSH_R(hit.coll.Item(hj));
                if (ar2) ranges.push(ar2);
            }
            break;
        }
    }
    if (!ranges.length) {
        var oneRg = await DSH_P(sel, 'Range');
        ranges.push(oneRg || sel);
    }
    var areaCount = ranges.length;
    diag.push('选区数=' + areaCount);

    /* ---- ②b Shadow 捕获：拿到用户真正选中的所有段落（含 Ctrl 多选）----
       v1.13.0：上面的 ranges 在多选区下只有一块，这里用"临时标记→逐段识别→Undo"
       的方式拿到全部选中段落。失败或无选区时退回 ranges 路径，行为不变。
       详见 DSH_captureSelParagraphs 的注释（含微软 KB 288424 的背景）。 */
    var captured = null;
    if (hasSel) {
        captured = await DSH_captureSelParagraphs(doc, sel, diag);
        if (captured) {
            diag.push('Shadow 捕获成功：' + captured.length + ' 段（含多选区块）');
            areaCount = captured.length;   // 每个选中段至少对应一块选区，用作摘要里的"选区数"
        }
    }

    /* ---- ③ 逐段取文本（跨选区合并，按文档顺序） ---- */
    var recs = [], skipped = 0, i, p, r, t, inTbl;
    if (captured) {
        /* Shadow 捕获已经拿到段落对象、起点、文本，直接用；
           表格内段落的过滤跟另一条路径共用下面同一段代码。 */
        for (i = 0; i < captured.length; i++) {
            recs.push({ p: captured[i].p, start: captured[i].start, text: captured[i].text });
        }
    }
    for (var ri = 0; ri < ranges.length && !captured; ri++) {
        var paras = await DSH_P(ranges[ri], 'Paragraphs');
        if (!paras) {
            var sr = await DSH_P(ranges[ri], 'Range');
            if (sr) paras = await DSH_P(sr, 'Paragraphs');
        }
        var pn = paras ? Number((await DSH_P(paras, 'Count')) || 0) : 0;
        if (!pn) continue;
        for (i = 1; i <= pn; i++) {
            p = await DSH_R(paras.Item(i));
            if (!p) continue;
            r = await DSH_P(p, 'Range');
            if (!r) continue;
            t = String((await DSH_P(r, 'Text')) || '');
            /* 表格内的段落一律跳过：表格走的是另一条路径（选中一列）。
               在这里再编一次号会把表格里已经排好的序号冲掉。
               判断用两手：段落文本里带 \x07（单元格结束符），或 Information(12)=wdWithInTable。 */
            inTbl = (t.indexOf('\x07') >= 0);
            if (!inTbl) {
                try { if (await DSH_R(r.Information(12))) inTbl = true; } catch (e) { }
            }
            if (inTbl) { skipped++; continue; }
            recs.push({ p: p, start: Number(await DSH_P(r, 'Start')), text: t });
        }
    }
    /* 两条路径共用的表格内过滤（捕获路径也要跳过表格段） */
    if (captured) {
        var kept = [];
        for (i = 0; i < recs.length; i++) {
            t = recs[i].text;
            inTbl = (t.indexOf('\x07') >= 0);
            if (!inTbl) {
                try {
                    var cr = await DSH_P(recs[i].p, 'Range');
                    if (cr && await DSH_R(cr.Information(12))) inTbl = true;
                } catch (e) { }
            }
            if (inTbl) { skipped++; continue; }
            kept.push(recs[i]);
        }
        recs = kept;
    }
    recs = DshEngine.seqMergeAreas(recs);
    var metas = [], texts = [];
    for (i = 0; i < recs.length; i++) {
        metas.push({ p: recs[i].p, start: recs[i].start });
        texts.push(recs[i].text);
    }
    var paraCount = texts.length;
    diag.push('段落数=' + paraCount);
    if (skipped) diag.push('跳过表格内段落=' + skipped);
    if (!paraCount) {
        DSH_say('便捷插件 · 填充序号：没读到段落。\n\n' + diag.join('\n'));
        return;
    }

    /* ---- ③ 算方案（纯逻辑） ----
       两种模式（v1.12.0）：
         填充模式   —— 选区覆盖的段落全部按顺序编号（没有序号的会被加上）
         统一格式模式 —— 只把【已经带序号】的段落改成当前格式，没有序号的段落一律不动
       自动判定：看选区第一个非空段落有没有序号。
         有  → 统一格式模式（用户是来"换格式"的，典型场景：把散在文档里的
                三处「（1）（2）（3）」一次改成「01 02 03」——
                Ctrl 多选做不到，只能连续选区，但连续选区会把中间正文也编号，
                统一格式模式正好只动带序号的那些）
         没有 → 填充模式（用户是来"从头编号"的）
       手动覆盖：DSH_OPTIONS.seqMode = 'fill' | 'unify' | 'auto'（默认 auto）。 */
    var modeOpt = String(DSH_OPTIONS.seqMode || 'auto').toLowerCase();
    var mode = (modeOpt === 'fill' || modeOpt === 'unify')
        ? modeOpt
        : DshEngine.seqPickMode(texts);
    var plan = (mode === 'unify')
        ? DshEngine.seqPlanUnify(texts, DSH_SEQ_INDEX)
        : DshEngine.seqPlanParagraphs(texts, DSH_OPTIONS.seqStart, DSH_OPTIONS.seqRenumberAll, DSH_SEQ_INDEX);
    diag.push('模式=' + (mode === 'unify' ? '统一格式（只改已有序号）' : '填充编号') +
              '，需处理=' + plan.length + ' 段，格式=' + DshEngine.seqFormatLabel(DSH_SEQ_INDEX) +
              (DSH_OPTIONS.seqRenumberAll ? '（全量重编号）' : ''));
    if (!plan.length) {
        if (mode === 'unify') {
            DSH_quiet('该选区里没有带序号的段落，无需统一格式。');
            return;
        }
        DSH_quiet('该选区里没有可编号的段落（全是空行）。');
        return;
    }

    /* ---- ④ 倒序写回 ----
       改写会让后面段落的字符位置整体平移，从最后一段往前写，前面段落的 Start 始终有效。
       这是本项目所有"批量改文本"路径的统一做法（与表格版逐格倒写同理）。 */
    var done = 0, failed = 0, unchanged = 0, changes = [];
    for (i = plan.length - 1; i >= 0; i--) {
        var item = plan[i];
        var m = metas[item.index];
        if (!m) { failed++; continue; }
        try {
            // 已经就是该格式 → 不写。开修订时重写相同内容会白留一条修订痕迹。
            if (item.oldPrefix === item.prefix) { unchanged++; continue; }

            var body = String(texts[item.index] == null ? '' : texts[item.index])
                .replace(/[\r\n\u0007\u0001\u0002]/g, '');
            var wA = m.start + DshEngine.posFromIdx(body, item.start);
            var wB = m.start + DshEngine.posFromIdx(body, item.start + item.length);
            var tr = await DSH_R(doc.Range(wA, wB));
            if (!tr) { failed++; continue; }

            /* 写入前核对旧内容：位置只要算偏一个字符，就会把正文中间的字换掉。
               这是正文版唯一的保险丝，不能省。length=0（插入）时期望读到空串。 */
            var cur = String((await DSH_P(tr, 'Text')) || '');
            if (cur !== item.oldPrefix) {
                failed++;
                if (diag.length < 14) diag.push('位置不符: 期望' + JSON.stringify(item.oldPrefix) + ' 实得' + JSON.stringify(cur));
                continue;
            }

            tr.Text = item.prefix;

            // 写回自检：Range 在赋值后可能被重置，读不到就另取一段核对
            var back = String((await DSH_P(tr, 'Text')) || '');
            if (back !== item.prefix) {
                var vr = await DSH_R(doc.Range(wA, wA + item.prefix.length));
                back = String((await DSH_P(vr, 'Text')) || '');
            }
            if (back !== item.prefix) {
                failed++;
                if (diag.length < 14) diag.push('写回不符: ' + JSON.stringify(back));
                continue;
            }
            done++;
            /* 记下"改前 → 改后"，摘要里逐条列出：
               用户要的多半正是"换格式"，光看"写入 1 段"不知道换成了什么。 */
            changes.push((item.oldPrefix || '（无）') + ' → ' + item.prefix);
        } catch (e) {
            failed++;
            if (diag.length < 14) diag.push('写入异常: ' + (e && e.message ? e.message : e));
        }
    }

    /* ---- ⑤ 结果一律弹摘要（v1.11.9）----
       以前：成功走 console（用户看不到）、失败才弹一句"一段也没改成功"。
       于是"只填了一部分"这件事对用户完全不可见 —— 他只能看着文档猜。
       现在：一律弹摘要，含选区数、段落数、写入/已符合/失败/跳过，
       外加【实际处理到的段落】清单。看得见，才谈得上排查。 */
    var snips = [];
    for (i = 0; i < texts.length && snips.length < 6; i++) {
        var sn = String(texts[i] == null ? '' : texts[i]).replace(/[\r\n\u0007\u0001\u0002]/g, '');
        snips.push((i + 1) + '. ' + (sn.length > 18 ? sn.slice(0, 18) + '…' : sn));
    }
    var notes = [];
    if (areaCount === 1 && hasSel && paraCount > 0) {
        notes.push('【只读到 1 个选区】若你用 Ctrl 选中了多块，本机 WPS 接口读不到多选区（' +
                   'Selection.Range 只代表其中一块）。可用做法：');
        notes.push('　① 逐个标题分别点一次「填充序号」——已带编号的段落会保留原值、只换格式，' +
                   '点几次就统一几次（本功能本来就支持，不是绕路）；');
        notes.push('　② 或从第一个拖到最后一个连续选区——但中间正文也会一起被编号。');
    }
    if (failed) {
        notes.push('失败 ' + failed + ' 段，详情见 WPS 加载项调试器（Alt+F12 → Console）。');
    }
    var summary = DshEngine.seqSummary({
        areaCount: areaCount, paraCount: paraCount, skipped: skipped,
        done: done, unchanged: unchanged, failed: failed,
        format: DshEngine.seqFormatLabel(DSH_SEQ_INDEX),
        snips: snips, notes: notes, changes: changes, probe: probeFound
    });
    DSH_quiet(summary);

    /* 【v1.11.11】成功不弹窗；【v1.14.0】连功能区标题上的"已写入 N 段"也去掉了
       （用户要求：结果看文档本身即可，不用显示使用结果）。
       成功 → 完全静默，只在控制台留一行 seqStatusText 便于排查；
       失败 / 什么都没发生 → 照旧弹窗（那是需要人处理的事）。 */
    DSH_quiet('填充序号结果：' + DshEngine.seqStatusText({
        done: done, unchanged: unchanged, failed: failed, paraCount: paraCount, mode: mode
    }));

    if (DshEngine.seqNeedPopup({ done: done, unchanged: unchanged, failed: failed })) {
        DSH_say(summary);
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

    /* 【2026-10-21 修复 ERR_FILE_NOT_FOUND 白屏】
       背景：ShowDialog 只要 URL 语法没错就"调用成功"，页面加载失败它不抛异常。
       发版时若 WPS 未完全退出，旧版目录被删，内存里的页面 base 就指向不存在的目录，
       对话框弹出却是「页面加载失败 ERR_FILE_NOT_FOUND:-6」——用户看到白屏，
       而我们的兜底 alert 永远不会执行（因为没抛异常）。

       对策：弹之前先【同步探测文件在不在】，探不到就直接走 alert 兜底，
       不弹那个注定白屏的窗。
       · 用同步 XHR 而非 fetch：本函数是普通 function（不是 async），不能 await；
         且对话框本就要在此刻弹出，异步探测会来不及。
       · XMLHttpRequest 必须先用 typeof 守卫（WPS 某些引擎不暴露它）——
         直接引用会让 ReferenceError 被外层 catch 吞掉，探测形同虚设。
       · 任何异常一律视为"可用"，不让探测本身成为新故障点。 */
    var pageOK = true;
    try {
        if (typeof XMLHttpRequest === 'function' && /^file:/i.test(base)) {
            var xhr = new XMLHttpRequest();
            xhr.open('HEAD', base + 'dialog_sum.html', false);   // false = 同步
            try {
                xhr.send(null);
                // file:// 下成功通常 status=0；被拒则抛异常，落到 catch 保持 pageOK=true
                pageOK = (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 400));
            } catch (e2) { pageOK = true; }
            if (!pageOK) DSH_quiet('对话框页面不存在，改用弹窗兜底: ' + base + 'dialog_sum.html');
        }
    } catch (e) { pageOK = true; }

    // 有些环境会裁剪 query，这里再往 PluginStorage 存一份兜底
    try { if (window.wps && wps.PluginStorage) { wps.PluginStorage.setItem('dshLastSum', sumText); } } catch (e) { }

    var dpr = 1;
    try { dpr = window.devicePixelRatio || 1; } catch (e) { }

    if (pageOK) {
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
    }

    // 兜底：至少让结果可见（文本不可选中）
    DSH_say('区域求和\n\n数字个数：' + count + '\n合计：' + sumText +
            (pageOK ? '\n\n（本机未能弹出可复制窗口，请手动抄录）'
                    : '\n\n（对话框页面缺失，已改用此弹窗；新版重新安装后即可恢复可复制窗口）'));
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
            /* 尺寸按【真实渲染】定：ask 页内容约 264px、work 页（8 行文件列表）约 257px。
               早前按错误画布估小了，导致"方式二"整行被裁 —— 那是尺寸算错，不是布局错。 */
            /* 尺寸按【真实渲染】定：ask 页内容约 264px、work 页（8 行文件列表）约 257px。
               窗口尺寸在 ShowDialog 时一次定死、之后不能改，所以取"最高那一页"280，两页都装得下。
               ⚠️ 2026-10-19 踩过的坑：这里原本写的是 `q === 'work'` 想按页区分，
                  但 q 是【对话框页面里】的函数，main.js 里根本没有它 ——
                  于是抛 ReferenceError，被外层 try/catch 吞掉，函数返回 false，
                  表现为"对话框从来不弹、永远退回系统弹窗"，而 261 项测试一条都没红。
                  胶水层现在有测试覆盖了（见 tests-wps 的"对话框打开函数"一节）。 */
            wps.ShowDialog(url, '检查更新', Math.round(424 * dpr), Math.round(280 * dpr), true);
            return true;
        }
    } catch (e) { }
    try {
        if (window.wps && wps.Dialog && typeof wps.Dialog.openDialog === 'function') {
            wps.Dialog.openDialog({ title: '检查更新', width: 424, height: 300, url: url });
            return true;
        }
    } catch (e) { }
    return false;
}

/* 只显示结果、不做动作的提示框（已是最新 / 读不到清单）。
   和更新对话框共用同一个页面与尺寸，外观统一。 */
function DSH_showResultDialog(view, L, failUrl) {
    var base = DSH_baseUrl();
    if (!base) return false;
    var url = base + 'dialog_update.html' +
              '?view=' + encodeURIComponent(view) +
              '&cur='  + encodeURIComponent(DSH_VERSION) +
              '&new='  + encodeURIComponent(String((L && L.version) || '')) +
              '&failurl=' + encodeURIComponent(String(failUrl || ''));
    var dpr = 1;
    try { dpr = window.devicePixelRatio || 1; } catch (e) { }
    try {
        if (window.wps && typeof wps.ShowDialog === 'function') {
            /* 结果页窗口尺寸【按内容定】，不能沿用更新页那个大尺寸 ——
               两行字配一个 424x300 的大框，看起来就是个空盒子。
               实测渲染后定的：已是最新约 90px 内容，读不到清单约 150px（地址可能折两行）。 */
            var sz = (view === 'netfail') ? [380, 152] : [360, 124];   // 已是最新 2 行、读不到清单 4 行
            wps.ShowDialog(url, '检查更新', Math.round(sz[0] * dpr), Math.round(sz[1] * dpr), true);
            return true;
        }
    } catch (e) { }
    return false;
}

/* 发现新版本后的处置 —— 【只有手动点「检查更新」才弹对话框】。
   启动时的自动检查必须静默：用户明确要求"应该是我点击检查更新后才弹窗"。
   自动更新那条路由开机项负责（登录时跑），不需要在 WPS 启动时打扰用户。
   注意：插件【无法】触发更新（WPS 沙箱拦掉全部 ShellExecute），所以对话框里
   的【直接更新】要么走沙箱关掉的情况、要么如实说"已排队/双击 update.bat"。 */
async function DSH_onNewVersion(L, manual) {
    if (!manual) {
        DSH_quiet('自动检查发现新版本 ' + L.version + '（静默；更新由开机项负责）');
        return;
    }
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
                /* 手动检查且已是最新 → 用我们自己的对话框，而不是 WPS 原生 alert
                   （alert 的比例调不了，一张大框配两行字很丑）。 */
                if (manual) DSH_showResultDialog('uptodate', L);
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
        if (manual) DSH_showResultDialog('netfail', null, url);
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
/* 功能区分两类（用户要求分开成两个按键）：
   · 不带"（改单位）"：只改数字，单位原样不动 —— 老行为。
   · 带"（改单位）"：数字与紧跟其后的金额单位一起换算，金额本身不变。
   默认走"不改单位"（unitConvert 显式传 false），
   这样任何漏传参的路径拿到的都是老行为，不会悄悄把单位改掉。 */
function dshThousands() { DSH_run('thousands', false, false); return true; }
function dshMultiply() { DSH_run('mul', false, false); return true; }
function dshDivide() { DSH_run('div', false, false); return true; }
function dshMultiplyUnit() { DSH_run('mul', false, true); return true; }
function dshDivideUnit() { DSH_run('div', false, true); return true; }
function dshDiagnose() { DSH_run('thousands', true, false); return true; }

/* --- 填充序号：动作 + 格式菜单 --- */
function dshFillSequence() { DSH_fillSequence(); return true; }

/* --- 区域求和 --- */
function dshSumRegion() { DSH_sumRegion(); return true; }

/* --- 清除回车空格（v1.14.0）---
   场景（用户定义）：从 PDF / 网页复制的文字，一行一个回车、行首/行尾带空格，
   选中后点一下，拼成一段连续的文字。
   语义（用户确认）：PDF 复制来的碎行 + 只处理选区。
   【为什么不做"没选就处理全文"】这个功能的动作是删除段落标记（把多段并一段），
   误伤全文的后果不可逆（虽能撤销，但用户未必发现）——选区模式是"你划哪里清哪里"，
   责任边界清晰。 */
function dshCleanBreaks() { DSH_cleanBreaks(); return true; }

/* ======================= 清除回车空格（v1.14.0）======================= */
async function DSH_cleanBreaks() {
    var diag = [];
    try {
        var app = await DSH_getApp(diag);
        if (!app) {
            DSH_say('便捷插件 · 清除回车空格：拿不到 WPS 应用对象。\n\n' + diag.join('\n'));
            return;
        }
        var doc = await DSH_P(app, 'ActiveDocument');
        if (!doc) { DSH_say('请先打开一个文档。'); return; }
        var sel = await DSH_P(doc, 'Selection');
        if (!sel) sel = await DSH_P(app, 'Selection');
        if (!sel) { DSH_say('拿不到 Selection。'); return; }

        /* 没选内容（只是光标）→ 不动手，告诉用户怎么用 */
        var selRaw = String((await DSH_P(sel, 'Text')) || '');
        if (DSH_trim(selRaw).length === 0) {
            DSH_say('便捷插件 · 清除回车空格\n\n请先【选中】要清理的那段文字——这个功能只处理选区，不动选区以外的内容。\n\n典型用法：从 PDF 复制进来的文字一行一个回车、行首带空格，全部选中后点一下，就拼成一段连续文字。');
            return;
        }

        var rng = await DSH_P(sel, 'Range');
        if (!rng) rng = sel;
        var orig = String((await DSH_P(rng, 'Text')) || '');
        var s0 = Number(await DSH_P(rng, 'Start'));

        /* 含表格单元格结束符 \x07 时拒绝：整体重写选区文本会破坏表格结构 */
        if (orig.indexOf('\x07') >= 0) {
            DSH_say('便捷插件 · 清除回车空格\n\n选区里有表格。请在正文里使用本功能；表格内请逐个单元格清理，否则整体重写会破坏表格。');
            return;
        }

        var r = DshEngine.cleanBreaks(orig);
        if (!r.breaks && !r.spaces) {
            DSH_say('便捷插件 · 清除回车空格\n\n选区里没有回车或空格可清。');
            return;
        }

        /* 写回：整体替换选区文本（与项目其它"批量改文本"路径同一种写法） */
        rng.Text = r.text;
        var back = String((await DSH_P(rng, 'Text')) || '');
        if (back !== r.text) {
            var vr = await DSH_R(doc.Range(s0, s0 + r.text.length));
            if (vr) back = String((await DSH_P(vr, 'Text')) || '');
        }
        if (back !== r.text) {
            DSH_say('便捷插件 · 清除回车空格：写回失败（内容核对不上）。\n\n' + diag.join('\n'));
            return;
        }
        DSH_quiet('清除回车空格：删除回车 ' + r.breaks + ' 个、空格 ' + r.spaces + ' 个');
    } catch (e) {
        DSH_say('便捷插件 · 清除回车空格出错：' + (e && e.message ? e.message : e) + '\n\n' + diag.join('\n'));
    }
}

/* --- 检查更新 --- */
function dshCheckUpdate() { DSH_checkUpdate(true); return true; }

/* 切换序号格式（v1.14.2 重写）
   ============================================================
   用户反馈的两条（2026-10-25）：
     ① 按钮上显示的格式固定不变，选了别的模板也不跟着变；
     ② 选一次模板后，应该"不仅改模板，还等效点一次填充序号"。

   ① 的原因：splitButton 里的按钮是【二级控件】，WPS 只对分裂按钮根节点
      重取 getLabel，对内部 button 不重取 —— 只 Invalidate('dshBtnSeq') 无效。
      对策：把分裂按钮可刷新的 id 全刷一遍（根 + 子 + 菜单），并加
            Invalidate() 整表兜底（不同版本 WPS 生效范围不同，多刷不亏）。

   ② 的行为设计（有边界，避免误伤）：
      · 有选区 → 立即按新格式执行一次填充/统一（用户要的"选完即生效"）
      · 无选区 → 只记下格式，不往光标处插号
      为什么不无条件执行：光标状态下的"填充序号"会给光标所在段落插号，
      用户只是想换个模板时突然被加个序号，属于意外改动。 */
function DSH_setSeqFormat(i) {
    if (i < 0 || i >= DshEngine.seqFormatCount) return true;
    DSH_SEQ_INDEX = i;
    DSH_quiet('序号格式切换为 ' + DshEngine.seqFormatLabel(i));
    DSH_refreshSeqRibbon();
    /* 格式记下之后，趁热把当前选区套用一次（equiv 点一次「填充序号」） */
    DSH_autoApplySeq();
    return true;
}

/* 让分裂按钮上的"当前格式"立刻刷新。
   多路刷新是刻意的：WPS 各版本对 splitButton 子控件的 InvalidateControl
   响应不一致（实测 v1.14.1 只刷子按钮没反应），所以把根/子/菜单都刷，
   再兜底一次整表 Invalidate()。任何一步失败都吞掉，不影响功能。 */
function DSH_refreshSeqRibbon() {
    var ids = ['dshSeqSplit', 'dshBtnSeq', 'dshSeqMenu'];
    try {
        if (!DSH_RIBBON) return;
        for (var k = 0; k < ids.length; k++) {
            try {
                if (DSH_RIBBON.InvalidateControl) DSH_RIBBON.InvalidateControl(ids[k]);
            } catch (e1) { }
        }
        try { if (DSH_RIBBON.Invalidate) DSH_RIBBON.Invalidate(); } catch (e2) { }
    } catch (e) { }
}

/* 选完格式后自动套用一次（等效点一次「填充序号」）。
   边界：**只有当前有选区时才动手**。
     没有选区时点填充序号 = 给光标所在段落插号——用户只是换模板，
     突然被加个序号属于意外改动，所以那种情况只记格式、不执行。 */
async function DSH_autoApplySeq() {
    try {
        var diag = [];
        var app = await DSH_getApp(diag);
        if (!app) return;
        var doc = await DSH_P(app, 'ActiveDocument');
        if (!doc) return;
        var sel = await DSH_P(doc, 'Selection');
        if (!sel) sel = await DSH_P(app, 'Selection');
        if (!sel) return;
        var t = String((await DSH_P(sel, 'Text')) || '');
        if (DSH_trim(t).length === 0) {
            DSH_quiet('已切换序号格式；当前没有选区，未自动套用（选中段落后点「填充序号」即可）');
            return;
        }
        await DSH_fillSequence();
    } catch (e) {
        /* 自动套用失败不能影响"换格式"这个主诉求，静默记录 */
        DSH_quiet('选完格式后自动套用失败（格式已切换，可手动点填充序号）：' +
                  (e && e.message ? e.message : e));
    }
}

/* 按钮标题上显示当前格式（v1.14.0 起：分裂按钮主体用）。
   【v1.14.0 变更】不再显示"已写入 N 段"这类操作结果（用户要求，
   结果看文档本身即可）。成功完全静默（只写控制台），失败/异常才弹窗。
   保留当前格式显示：点之前知道"会用什么格式"是必要的，它不是结果。 */
function dshSeqButtonLabel(control) {
    return '填充序号 · ' + DshEngine.seqFormatLabel(DSH_SEQ_INDEX);
}

/* 菜单（分裂按钮的下拉部分）标题：菜单里也标一下当前格式，点开就知道选了哪个。 */
function dshSeqMenuLabel(control) {
    return '选择序号格式（当前：' + DshEngine.seqFormatLabel(DSH_SEQ_INDEX) + '）';
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
        window.dshSeqButtonLabel = dshSeqButtonLabel;
        window.dshCleanBreaks = dshCleanBreaks;
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
