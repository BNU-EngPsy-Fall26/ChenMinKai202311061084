/**
 * charts_svg.js — 概念可视化的 SVG 绘图模块（不使用 Canvas）
 *
 * 提供两个加分项要求的交互式图：
 *   1. drawDistribution() —— 双正态分布模型，随 d' 变化、随 c 移动判定阈
 *   2. drawROC()          —— 等辨别力 ROC 曲线，并标示被试本局的实际操作点
 *
 * 全部图形以 SVG 元素拼装后写入容器，随容器宽度自适应缩放（viewBox + width:100%）。
 * 正态分布的概率由 math_sdt.js 提供的 SDTMath.cdf / SDTMath.pdf 计算。
 */

const SDTCharts = {

    /* ---------- 内部工具 ---------- */

    /** 数值格式化：保留 n 位小数 */
    _f(x, n) {
        return Number(x).toFixed(n === undefined ? 2 : n);
    },

    /** 生成一条标准正态曲线（均值 mu、标准差 1）在 [zMin, zMax] 上的折线路径 */
    _curvePath(mu, zMin, zMax, mapX, mapY, steps) {
        const n = steps || 140;
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const z = zMin + (zMax - zMin) * (i / n);
            pts.push(mapX(z) + ',' + mapY(SDTMath.pdf(z - mu)));
        }
        return 'M' + pts.join(' L');
    },

    /** 生成曲线下方 [fromZ, toZ] 区间的填充路径（闭合到基线），用于表示概率面积 */
    _areaPath(mu, fromZ, toZ, zMin, zMax, mapX, mapY, baseline, steps) {
        const lo = Math.max(fromZ, zMin);
        const hi = Math.min(toZ, zMax);
        if (hi <= lo) return '';
        const n = steps || 90;
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const z = lo + (hi - lo) * (i / n);
            pts.push(mapX(z) + ',' + mapY(SDTMath.pdf(z - mu)));
        }
        // 沿曲线走一遍后，下降到基线并回到起点闭合
        return 'M' + mapX(lo) + ',' + baseline +
               ' L' + pts.join(' L') +
               ' L' + mapX(hi) + ',' + baseline + ' Z';
    },

    /* ---------- 图一：双正态分布与判定标准 ---------- */

    /**
     * 绘制信号 / 噪音的双正态分布及判定阈
     * 噪音分布 ~ N(0, 1)，信号分布 ~ N(d', 1)（等方差假设）
     * 判定阈位于噪音轴上的 z = c 处：阈右侧噪音曲线下面积 = P(FA)，
     * 阈右侧信号曲线下面积 = P(Hit)
     *
     * @param {string} containerId - 容器元素 id
     * @param {number} dPrime      - 辨别力 d'
     * @param {number} c           - 判定标准 c
     */
    drawDistribution(containerId, dPrime, c) {
        const box = document.getElementById(containerId);
        if (!box) return;

        const W = 420, H = 268;
        const padL = 34, padR = 14, padT = 22, padB = 76;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        const baseline = padT + plotH;

        // 横轴固定在 z ∈ [-3, 5]，足以容纳 d' ∈ [-2, 4] 的两个分布
        const zMin = -3, zMax = 5;
        const mapX = z => padL + (z - zMin) / (zMax - zMin) * plotW;

        const pdfPeak = SDTMath.pdf(0);           // 标准正态峰值 ≈ 0.3989
        const vScale = plotH * 0.86 / pdfPeak;    // 峰值占绘图高度的 86%
        const mapY = v => baseline - v * vScale;

        const xC = mapX(c);
        const xNoise = mapX(0);                   // 噪音分布均值位置
        const xSignal = mapX(dPrime);             // 信号分布均值位置

        // 阈右侧的两块面积：P(Hit) 与 P(FA)
        const areaFA = this._areaPath(0, c, zMax, zMin, zMax, mapX, mapY, baseline);
        const areaHit = this._areaPath(dPrime, c, zMax, zMin, zMax, mapX, mapY, baseline);

        // 横轴刻度
        let ticks = '';
        for (let z = zMin; z <= zMax; z++) {
            const x = mapX(z);
            ticks += `<line x1="${this._f(x, 1)}" y1="${baseline}" x2="${this._f(x, 1)}" y2="${baseline + 5}" stroke="#2b4a41"/>`;
            ticks += `<text x="${this._f(x, 1)}" y="${baseline + 17}" fill="#5d7a6f" font-size="9" text-anchor="middle">${z}</text>`;
        }

        // 图注文案：d' 与 c 的数值统一放在底部一行，避免与分布名称互相遮挡
        const legend =
            `d' = ${this._f(dPrime)}　｜　c = ${this._f(c)}（黄色虚线为判定阈）`;

        // 两个分布名称错开高度，避免 d' 较小时两段文字相互重叠
        const yLabelNoise = mapY(pdfPeak) - 8;
        const yLabelSignal = mapY(pdfPeak) - 24;

        const svg = `
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="双正态分布模型，d' 为 ${this._f(dPrime)}，判定标准 c 为 ${this._f(c)}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#050d0c"/>

    <!-- 概率面积：先铺信号（绿），再叠噪音（红）。
         两条曲线在 x = d'/2 处相交，因此两种颜色各自都有一块独占区域，不会被完全盖住 -->
    <path d="${areaHit}" fill="rgba(0,255,119,0.24)"/>
    <path d="${areaFA}"  fill="rgba(255,107,107,0.34)"/>

    <!-- 两条正态分布曲线 -->
    <path d="${this._curvePath(0, zMin, zMax, mapX, mapY)}"
          fill="none" stroke="#69c0ff" stroke-width="1.8"/>
    <path d="${this._curvePath(dPrime, zMin, zMax, mapX, mapY)}"
          fill="none" stroke="#00ff77" stroke-width="1.8"/>

    <!-- 判定阈竖线 -->
    <line x1="${this._f(xC, 1)}" y1="${padT + 4}" x2="${this._f(xC, 1)}" y2="${baseline}"
          stroke="#ffc53d" stroke-width="1.8" stroke-dasharray="6 4"/>

    <!-- 基线 -->
    <line x1="${padL}" y1="${baseline}" x2="${W - padR}" y2="${baseline}" stroke="#2b4a41"/>
    ${ticks}

    <!-- 分布名称：错开高度，避免 d' 较小时两段文字相互重叠 -->
    <text x="${this._f(xNoise, 1)}" y="${this._f(yLabelNoise, 1)}" fill="#69c0ff"
          font-size="10" text-anchor="middle">噪音 N(0,1)</text>
    <text x="${this._f(xSignal, 1)}" y="${this._f(yLabelSignal, 1)}" fill="#00ff77"
          font-size="10" text-anchor="middle">信号 N(d',1)</text>

    <!-- 底部图注：轴标题 + 两张图例，均置于绘图区之外，互不遮挡 -->
    <text x="${padL + plotW / 2}" y="${baseline + 32}" fill="#5d7a6f" font-size="10"
          text-anchor="middle">感觉量（z 分数）</text>
    <text x="${padL}" y="${baseline + 48}" fill="#ffc53d" font-size="10">${legend}</text>
    <text x="${padL}" y="${baseline + 62}" fill="#7d938a" font-size="9">
        绿面积 = P(Hit)　红面积 = P(FA)
    </text>
</svg>`;
        box.innerHTML = svg;
    },

    /* ---------- 图二：ROC 曲线 ---------- */

    /**
     * 绘制等辨别力 ROC 曲线并标示实测操作点
     * 理论曲线由参数方程生成：P(FA) = 1 − Φ(c)，P(Hit) = 1 − Φ(c − d')
     * 横轴 P(FA)、纵轴 P(Hit)，曲线越靠左上表示辨别力越强
     *
     * @param {string}      containerId - 容器元素 id
     * @param {number}      dPrime      - 理论辨别力 d'
     * @param {number|null} obsPFA      - 被试实测虚警率，无数据时传 null
     * @param {number|null} obsPHit     - 被试实测击中率，无数据时传 null
     */
    drawROC(containerId, dPrime, obsPFA, obsPHit) {
        const box = document.getElementById(containerId);
        if (!box) return;

        const W = 420, H = 250;
        const padL = 44, padR = 18, padT = 18, padB = 42;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;

        // 概率 → 像素坐标（纵轴向上为 1）
        const mapX = p => padL + p * plotW;
        const mapY = p => padT + (1 - p) * plotH;

        // 理论 ROC：扫描判定标准 c 得到 (P(FA), P(Hit)) 轨迹
        const pts = [];
        for (let cc = 3.6; cc >= -3.6; cc -= 0.08) {
            const pfa = 1 - SDTMath.cdf(cc);
            const phit = 1 - SDTMath.cdf(cc - dPrime);
            pts.push(this._f(mapX(pfa), 1) + ',' + this._f(mapY(phit), 1));
        }

        // 曲线下面积：等方差正态模型下 AUC = Φ(d' / √2)
        const auc = SDTMath.cdf(dPrime / Math.SQRT2);

        // 坐标刻度
        let ticks = '';
        for (let i = 0; i <= 4; i++) {
            const p = i / 4;
            const x = mapX(p), y = mapY(p);
            ticks += `<line x1="${this._f(x, 1)}" y1="${padT + plotH}" x2="${this._f(x, 1)}" y2="${padT + plotH + 5}" stroke="#2b4a41"/>`;
            ticks += `<text x="${this._f(x, 1)}" y="${padT + plotH + 17}" fill="#5d7a6f" font-size="9" text-anchor="middle">${p.toFixed(2)}</text>`;
            ticks += `<line x1="${padL}" y1="${this._f(y, 1)}" x2="${padL - 5}" y2="${this._f(y, 1)}" stroke="#2b4a41"/>`;
            ticks += `<text x="${padL - 8}" y="${this._f(y + 3, 1)}" fill="#5d7a6f" font-size="9" text-anchor="end">${p.toFixed(2)}</text>`;
        }

        // 实测操作点。点靠近绘图区上缘时把文字移到点下方，避免文字被顶出画面
        let obsMark = '';
        if (typeof obsPFA === 'number' && typeof obsPHit === 'number') {
            const ox = mapX(obsPFA), oy = mapY(obsPHit);
            const nearTop = oy < padT + 18;
            const ly = nearTop ? oy + 15 : oy - 7;
            const anchor = ox > padL + plotW - 120 ? 'end' : 'start';
            const lx = anchor === 'end' ? ox - 9 : ox + 9;
            obsMark = `
    <circle cx="${this._f(ox, 1)}" cy="${this._f(oy, 1)}" r="5"
            fill="#ff4d4f" stroke="#fff" stroke-width="1.2"/>
    <text x="${this._f(lx, 1)}" y="${this._f(ly, 1)}" fill="#ff8b8b" font-size="9"
          text-anchor="${anchor}">你的操作点 (${this._f(obsPFA)}, ${this._f(obsPHit)})</text>`;
        }

        const svg = `
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="ROC 曲线，d' 为 ${this._f(dPrime)}，曲线下面积 ${this._f(auc, 3)}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#050d0c"/>

    <!-- 绘图区边框与网格 -->
    <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}"
          fill="none" stroke="#2b4a41"/>
    <line x1="${mapX(0.5)}" y1="${padT}" x2="${mapX(0.5)}" y2="${padT + plotH}" stroke="#16261f"/>
    <line x1="${padL}" y1="${mapY(0.5)}" x2="${padL + plotW}" y2="${mapY(0.5)}" stroke="#16261f"/>

    <!-- 机会水平：d' = 0 时 ROC 即对角线，AUC = 0.5 -->
    <line x1="${mapX(0)}" y1="${mapY(0)}" x2="${mapX(1)}" y2="${mapY(1)}"
          stroke="#5d7a6f" stroke-width="1" stroke-dasharray="4 4"/>
    <text x="${mapX(0.72)}" y="${mapY(0.62)}" fill="#5d7a6f" font-size="9"
          transform="rotate(-45 ${mapX(0.72)} ${mapY(0.62)})">机会水平</text>

    <!-- 等辨别力理论 ROC 曲线 -->
    <path d="M${pts.join(' L')}" fill="none" stroke="#00ff77" stroke-width="2"/>

    <!-- 坐标轴与刻度 -->
    <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#3d6659"/>
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#3d6659"/>
    ${ticks}

    <!-- 轴标题 -->
    <text x="${padL + plotW / 2}" y="${H - 6}" fill="#5d7a6f" font-size="10"
          text-anchor="middle">虚警率 P(FA)</text>
    <text x="14" y="${padT + plotH / 2}" fill="#5d7a6f" font-size="10" text-anchor="middle"
          transform="rotate(-90 14 ${padT + plotH / 2})">击中率 P(Hit)</text>

    <text x="${padL + 6}" y="${padT + 14}" fill="#00ff77" font-size="10">
        d' = ${this._f(dPrime)}　AUC = ${this._f(auc, 3)}
    </text>
    ${obsMark}
</svg>`;
        box.innerHTML = svg;
    }
};
