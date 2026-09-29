/**
 * app.js — 信号检测论交互实验主控制器
 *
 * 实验流程（刺激呈现限时、判断不限时）：
 *   参数设定 → [ 刺激呈现（限时观测窗）→ 画面清空 → 不限时判断 → 反馈 ] × N 试次 → 结果计算与展示
 *
 * 关键设计说明：
 *   1. 每局的信号 / 噪音试次构成一张**预先洗牌好的固定试次表**（信号试次数 =
 *      round(试次总数 × 先验概率)），而不是逐试次独立随机抽样。这样既保留了先验
 *      概率参数的作用，又彻底避免了"某一局恰好一个信号试次都没有"的退化情形。
 *   2. 判断阶段没有任何时限，观察窗到期后按钮才出现，此后可以无限期思考。
 *   3. 雷达显示器由 DOM + CSS 绘制（conic-gradient 扫描线），未使用 Canvas。
 */

const SDTApp = {

    /* ================= 常量与配置 ================= */

    /**
     * 难度预设。difficulty 通过三个视觉属性操纵实际的辨别难度：
     *   blipPeak  —— 信号回波在扫描线扫过瞬间的亮度峰值
     *   blipFloor —— 信号回波在两次扫描之间的基础亮度（保证回波始终可被看到）
     *   clutterMax—— 杂波光点亮度的上限
     * 只有当 clutterMax 超过 blipPeak 时，才真正存在"比目标还亮的杂波"，
     * 也就是信号与噪音两个分布出现重叠，d' 才会变小。
     */
    DIFFICULTY: {
        easy: {
            label: '容易', dPrime: 2.5,
            blipPeak: 1.00, blipFloor: 0.45, blipSize: 20,
            clutterMin: 0.05, clutterMax: 0.28, clutterCount: 100
        },
        medium: {
            label: '中等', dPrime: 1.5,
            blipPeak: 0.62, blipFloor: 0.20, blipSize: 16,
            clutterMin: 0.10, clutterMax: 0.72, clutterCount: 120
        },
        hard: {
            label: '困难', dPrime: 0.6,
            blipPeak: 0.40, blipFloor: 0.13, blipSize: 13,
            clutterMin: 0.10, clutterMax: 0.58, clutterCount: 135
        }
    },

    /** 观测窗内扫描线必须完成整圈的倍数：保证任意方位的回波都会闪亮至少一次 */
    SWEEP_REVOLUTIONS: 2,

    /** 反馈停留时长（毫秒） */
    FEEDBACK_MS: 1000,

    /** 历史记录本地存储键名与容量上限 */
    HISTORY_KEY: 'sdt_radar_history_v1',
    MAX_HISTORY: 50,

    /* ================= 运行时状态 ================= */

    el: {},                 // DOM 缓存
    config: null,           // 本局参数
    trialList: [],          // 预先洗牌的固定试次表
    trialIndex: 0,          // 已呈现的试次数
    hasSignal: false,       // 当前试次是否含信号
    phase: 'idle',          // idle | observe | response | feedback
    stats: { H: 0, M: 0, FA: 0, CR: 0 },
    result: null,           // 本局 SDTMath.calculateSDT 的返回值
    obsTimerId: null,       // 观测窗定时器
    feedbackTimerId: null,  // 反馈定时器
    storageOK: true,        // LocalStorage 是否可用

    /* ================= 初始化 ================= */

    init() {
        this.cacheDom();
        this.checkStorage();
        this.bindEvents();
        this.updatePriorLabel();
        this.showScreen('setup');
    },

    cacheDom() {
        const ids = [
            'screen-setup', 'screen-game', 'screen-results',
            'trialCountSelect', 'difficultySelect', 'priorSlider', 'priorVal', 'obsWindowSelect',
            'btnStart',
            'radarScope', 'radarClutter', 'radarSweep', 'radarBlip', 'radarOffline',
            'sweepPeriodText', 'gameTrialNum', 'gameTotalNum', 'scoreH', 'scoreFA',
            'obsBanner', 'gameFeedback', 'gameControls', 'btnSignalYes', 'btnSignalNo', 'btnAbort',
            'resH', 'resM', 'resFA', 'resCR',
            'valPHit', 'valPFA', 'valDPrime', 'valC', 'valBeta', 'valAcc',
            'criterionBadge', 'corrNote', 'evalSummary',
            'cmpPHit', 'cmpPFA', 'cmpDPrime', 'cmpC', 'cmpAcc',
            'chartDist', 'chartRoc', 'distCaption',
            'labDSlider', 'labDVal', 'labCSlider', 'labCVal',
            'labPHit', 'labPFA', 'labPMiss', 'labPCR', 'labNote',
            'btnRestart', 'btnShowHistory',
            'historyModal', 'btnCloseHistory', 'historyList', 'btnClearHistory'
        ];
        ids.forEach(id => { this.el[id] = document.getElementById(id); });
    },

    /** 检测 LocalStorage 是否可用；file:// 或隐私模式下可能被禁用，此时静默降级 */
    checkStorage() {
        try {
            const probe = '__sdt_probe__';
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
            this.storageOK = true;
        } catch (e) {
            this.storageOK = false;
        }
    },

    bindEvents() {
        // --- 参数页 ---
        this.el.priorSlider.addEventListener('input', () => this.updatePriorLabel());
        this.el.btnStart.addEventListener('click', () => this.startExperiment());

        // --- 判断页 ---
        this.el.btnSignalYes.addEventListener('click', () => this.respond(true));
        this.el.btnSignalNo.addEventListener('click', () => this.respond(false));
        this.el.btnAbort.addEventListener('click', () => this.abort());

        // --- 结果页 ---
        this.el.btnRestart.addEventListener('click', () => this.backToSetup());
        this.el.btnShowHistory.addEventListener('click', () => this.openHistory());
        this.el.btnCloseHistory.addEventListener('click', () => this.closeHistory());
        this.el.btnClearHistory.addEventListener('click', () => this.clearHistory());
        this.el.labDSlider.addEventListener('input', () => this.updateLab());
        this.el.labCSlider.addEventListener('input', () => this.updateLab());

        // 点击模态框背景关闭
        this.el.historyModal.addEventListener('click', (e) => {
            if (e.target === this.el.historyModal) this.closeHistory();
        });

        // --- 键盘快捷键 ---
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
    },

    onKeyDown(e) {
        // 参数页：空格开始实验
        if (e.code === 'Space' && this.el['screen-setup'].classList.contains('active')) {
            e.preventDefault();
            this.startExperiment();
            return;
        }

        // 判断阶段：F/2 = 无信号，J/1 = 有信号
        if (this.phase !== 'response') return;
        const k = e.key.toLowerCase();
        if (k === 'f' || k === '2') {
            e.preventDefault();
            this.respond(false);
        } else if (k === 'j' || k === '1') {
            e.preventDefault();
            this.respond(true);
        }
    },

    /* ================= 屏幕切换 ================= */

    showScreen(name) {
        ['setup', 'game', 'results'].forEach(n => {
            this.el['screen-' + n].classList.toggle('active', n === name);
        });
        window.scrollTo(0, 0);
    },

    /* ================= 参数页 ================= */

    updatePriorLabel() {
        this.el.priorVal.textContent = parseFloat(this.el.priorSlider.value).toFixed(2);
    },

    /* ================= 实验流程 ================= */

    startExperiment() {
        this.clearTimers();

        const trials = parseInt(this.el.trialCountSelect.value, 10);
        const diffKey = this.el.difficultySelect.value;
        const prior = parseFloat(this.el.priorSlider.value);
        const obsWindow = parseInt(this.el.obsWindowSelect.value, 10);

        this.config = { trials, diffKey, prior, obsWindow, diff: this.DIFFICULTY[diffKey] };

        // 构造固定试次表：信号试次数由先验概率决定，再整体洗牌打乱顺序
        const nSignal = Math.round(trials * prior);
        const list = [];
        for (let i = 0; i < trials; i++) list.push(i < nSignal);
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
        }
        this.trialList = list;
        this.trialIndex = 0;
        this.stats = { H: 0, M: 0, FA: 0, CR: 0 };
        this.result = null;

        // 扫描线周期：观测窗内正好扫满 SWEEP_REVOLUTIONS 圈
        const period = (obsWindow / 1000) / this.SWEEP_REVOLUTIONS;
        this.el.radarScope.style.setProperty('--sweep-period', period + 's');
        this.el.sweepPeriodText.textContent = period.toFixed(2);

        // 清空上一局的残留状态
        this.el.gameFeedback.textContent = '';
        this.el.gameFeedback.className = 'feedback';
        this.el.gameTrialNum.textContent = '0';
        this.el.gameTotalNum.textContent = trials;
        this.el.scoreH.textContent = '0';
        this.el.scoreFA.textContent = '0';

        this.showScreen('game');
        this.beginTrial();
    },

    /** 呈现一个试次：布置刺激并开启限时观测窗 */
    beginTrial() {
        if (this.trialIndex >= this.config.trials) {
            this.finishExperiment();
            return;
        }

        this.hasSignal = this.trialList[this.trialIndex];
        this.trialIndex++;

        // 状态复位
        this.phase = 'observe';
        this.el.gameFeedback.textContent = '';
        this.el.gameFeedback.className = 'feedback';
        this.el.gameTrialNum.textContent = this.trialIndex;
        this.el.gameControls.classList.add('hidden');
        this.el.obsBanner.classList.remove('hidden');
        this.el.radarOffline.classList.remove('on');
        this.el.radarScope.classList.remove('paused');

        // 布置刺激并同步重启动画，使扫描线与回波闪烁从同一时刻起算
        this.drawClutter();
        this.placeBlip(this.hasSignal);
        this.restartAnimation(this.el.radarSweep);
        if (this.hasSignal) this.restartAnimation(this.el.radarBlip);

        // 限时观测：到期后清屏，并解锁判断按钮
        this.obsTimerId = window.setTimeout(() => this.endObservation(), this.config.obsWindow);
    },

    /** 观测窗到期：清空画面，进入不限时的判断阶段 */
    endObservation() {
        if (this.phase !== 'observe') return;
        this.phase = 'response';

        // 清空画面：移除回波与杂波，并暂停扫描线动画
        this.el.radarBlip.classList.remove('on');
        this.el.radarClutter.innerHTML = '';
        this.el.radarScope.classList.add('paused');
        this.el.radarOffline.classList.add('on');

        this.el.obsBanner.classList.add('hidden');
        this.el.gameControls.classList.remove('hidden');
        // 注意：此处不设任何定时器——判断阶段完全由被试自己控制节奏
    },

    /**
     * 记录一次判断
     * @param {boolean} isSignal - 被试是否报告"有信号"
     */
    respond(isSignal) {
        if (this.phase !== 'response') return;
        this.phase = 'feedback';

        const fb = this.el.gameFeedback;
        let cls, text;

        if (this.hasSignal) {
            if (isSignal) { this.stats.H++;  cls = 'fb-hit';  text = '击中 —— 你发现了信号，成功引导拦截。'; }
            else          { this.stats.M++;  cls = 'fb-miss'; text = '漏报 —— 信号确实存在，敌机突防成功。'; }
        } else {
            if (isSignal) { this.stats.FA++; cls = 'fb-fa';   text = '虚警 —— 那里只有杂波，拦截弹药被浪费。'; }
            else          { this.stats.CR++; cls = 'fb-cr';   text = '正确否定 —— 你成功剔除了杂波干扰。'; }
        }

        fb.className = 'feedback ' + cls;
        fb.textContent = text;

        this.el.scoreH.textContent = this.stats.H;
        this.el.scoreFA.textContent = this.stats.FA;
        this.el.gameControls.classList.add('hidden');

        this.feedbackTimerId = window.setTimeout(() => this.beginTrial(), this.FEEDBACK_MS);
    },

    /** 结束本局：计算 SDT 指标并切换到结果页 */
    finishExperiment() {
        this.clearTimers();
        this.phase = 'idle';

        const s = this.stats;
        const r = SDTMath.calculateSDT(s.H, s.M, s.FA, s.CR);
        this.result = r;

        this.renderMatrix(r);
        this.renderMetrics(r);
        this.renderSummary(r);
        this.renderCompare(r);
        this.saveHistory(r);

        this.showScreen('results');

        // 概念实验室以本局实测的 d' 与 c 作为初始状态
        this.el.labDSlider.value = Math.max(-2, Math.min(4, r.dPrime));
        this.el.labCSlider.value = Math.max(-2, Math.min(2, r.c));
        this.updateLab(r);
    },

    /* ================= 雷达刺激的绘制 ================= */

    /** 按当前难度随机铺撒杂波光点 */
    drawClutter() {
        const d = this.config.diff;
        const box = this.el.radarClutter;

        let html = '';
        for (let i = 0; i < d.clutterCount; i++) {
            // 极坐标均匀取样，再换算为容器内的百分比坐标
            const rPct = Math.sqrt(Math.random()) * 45;
            const theta = Math.random() * Math.PI * 2;
            const left = 50 + rPct * Math.cos(theta);
            const top = 50 + rPct * Math.sin(theta);

            const size = (2 + Math.random() * 1.6).toFixed(1);
            const opacity = (d.clutterMin + Math.random() * (d.clutterMax - d.clutterMin)).toFixed(3);
            const dur = (0.8 + Math.random() * 0.9).toFixed(2);
            const delay = (Math.random() * 1.5).toFixed(2);

            html += `<span class="clutter-dot" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;` +
                    `width:${size}px;height:${size}px;` +
                    `--dot-o:${opacity};--flicker-dur:${dur}s;--flicker-delay:${delay}s"></span>`;
        }
        box.innerHTML = html;
    },

    /**
     * 放置信号回波
     * 关键点：为回波设置动画负延时，使其亮度峰值恰好出现在扫描线扫到该方位角的瞬间。
     *   conic-gradient 的 0deg 位于正上方（12 点钟方向）并顺时针旋转，
     *   因此方位角为 θ（自正北顺时针）的位置坐标：
     *       left = 50% + r·sin(θ)，top = 50% − r·cos(θ)
     *   扫描线到达 θ 的时刻为 t = T·θ/360，
     *   而 animation-delay: −X 会使峰值出现在 t = T − X，
     *   故取 X = T·(1 − θ/360)。
     */
    placeBlip(hasSignal) {
        const blip = this.el.radarBlip;
        const scope = this.el.radarScope;

        if (!hasSignal) {
            blip.classList.remove('on');
            return;
        }

        const d = this.config.diff;
        const period = parseFloat(this.el.sweepPeriodText.textContent);

        const thetaDeg = Math.random() * 360;
        const theta = thetaDeg * Math.PI / 180;
        const rPct = (0.35 + Math.random() * 0.42) * 45;   // 避开正中心与最外缘

        blip.style.left = (50 + rPct * Math.sin(theta)).toFixed(2) + '%';
        blip.style.top = (50 - rPct * Math.cos(theta)).toFixed(2) + '%';

        scope.style.setProperty('--blip-peak', d.blipPeak);
        scope.style.setProperty('--blip-floor', d.blipFloor);
        scope.style.setProperty('--blip-size', d.blipSize + 'px');
        scope.style.setProperty('--blip-phase', (period * (1 - thetaDeg / 360)).toFixed(3) + 's');

        blip.classList.add('on');
    },

    /**
     * 强制重启一个元素的 CSS 动画
     * 先置为 none 并强制重排，使浏览器提交"无动画"状态，再恢复样式表声明，动画即从头播放
     */
    restartAnimation(el) {
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
    },

    /* ================= 结果渲染 ================= */

    renderMatrix(r) {
        this.el.resH.textContent = r.H;
        this.el.resM.textContent = r.M;
        this.el.resFA.textContent = r.FA;
        this.el.resCR.textContent = r.CR;
    },

    renderMetrics(r) {
        const e = this.el;
        e.valPHit.textContent = r.pHit.toFixed(3);
        e.valPFA.textContent = r.pFA.toFixed(3);
        e.valDPrime.textContent = r.dPrime.toFixed(3);
        e.valC.textContent = r.c.toFixed(3);
        e.valBeta.textContent = r.beta.toFixed(3);
        e.valAcc.textContent = r.accuracy.toFixed(1) + '%';

        // 判定标准类型徽章
        e.criterionBadge.textContent = r.criterionType;
        e.criterionBadge.className = 'badge ' + (
            r.c > 0.15 ? 'badge-conservative' :
            r.c < -0.15 ? 'badge-liberal' : 'badge-neutral'
        );

        // 极端概率校正提示：仅在有试次落到 0 或 100% 时出现
        if (r.isCorrected) {
            e.corrNote.classList.remove('hidden');
            e.corrNote.textContent =
                '注意：本局存在极端概率（某个单元格为 0），已按 1/(2N) 法则对 P(Hit)、P(FA) ' +
                '作半格校正后再做 Z 变换，否则 Z(0) 无定义。上表显示的仍是原始计数与原始比率。';
        } else {
            e.corrNote.classList.add('hidden');
        }
    },

    /** 精简的结论解读：只保留"能力 + 标准"两句判断 */
    renderSummary(r) {
        const parts = [];

        const ability =
            r.dPrime >= 2.0 ? '分辨能力很强，信号与噪音在你眼中几乎分得开' :
            r.dPrime >= 1.0 ? '分辨能力良好，你能稳定地区分信号与噪音' :
            r.dPrime >= 0.4 ? '分辨能力偏弱，信号与噪音在你看来相当接近' :
                              '几乎无法区分信号与噪音，判断接近随机';
        let abilityLine = `你的辨别力 d' = ${r.dPrime.toFixed(3)}，${ability}。`;

        // d' 为负说明操作方向系统性颠倒，这是需要单独指出的异常
        if (r.dPrime < 0) {
            abilityLine = `你的辨别力 d' = ${r.dPrime.toFixed(3)}，为负值。这通常意味着报告方向被系统性颠倒了` +
                          `（把"无信号"当成了"有信号"），而不是能力真的低于随机水平。`;
        }
        parts.push(abilityLine);

        const crit =
            r.c > 0.15 ? `判定标准 c = ${r.c.toFixed(3)}（保守）：你倾向于只有相当确定时才报告"有信号"，` +
                         `因此虚警少、漏报多。若漏报的代价更高，说明你的标准放得太严。`
          : r.c < -0.15 ? `判定标准 c = ${r.c.toFixed(3)}（宽松）：你稍有迹象就报告"有信号"，` +
                         `因此漏报少、虚警多。若虚警的代价更高，说明你的标准放得太松。`
          :               `判定标准 c = ${r.c.toFixed(3)}（中立）：你的标准基本居中，虚警与漏报较为均衡。`;
        parts.push(crit);

        parts.push(`准确率为 ${r.accuracy.toFixed(1)}%。注意它同时受 d' 与 c 影响，` +
                    `因此单看准确率无法区分"分不清"和"不敢说"这两种完全不同的处境。`);

        this.el.evalSummary.innerHTML = parts.map(p => `<p>${p}</p>`).join('');
    },

    renderCompare(r) {
        this.el.cmpPHit.textContent = r.pHit.toFixed(3);
        this.el.cmpPFA.textContent = r.pFA.toFixed(3);
        this.el.cmpDPrime.textContent = r.dPrime.toFixed(3);
        this.el.cmpC.textContent = (r.c >= 0 ? '+' : '') + r.c.toFixed(3);
        this.el.cmpAcc.textContent = (r.accuracy / 100).toFixed(3);
    },

    /* ================= 概念实验室（加分项） ================= */

    /**
     * 依据两个滑块的位置，同步刷新理论混淆矩阵与两张图
     * 等方差正态模型下：
     *   P(Hit) = 1 − Φ(c − d')，P(FA) = 1 − Φ(c)
     */
    updateLab() {
        const dP = parseFloat(this.el.labDSlider.value);
        const cc = parseFloat(this.el.labCSlider.value);

        this.el.labDVal.textContent = dP.toFixed(2);
        this.el.labCVal.textContent = cc.toFixed(2);

        const pHit = 1 - SDTMath.cdf(cc - dP);
        const pFA = 1 - SDTMath.cdf(cc);

        this.el.labPHit.textContent = pHit.toFixed(3);
        this.el.labPFA.textContent = pFA.toFixed(3);
        this.el.labPMiss.textContent = (1 - pHit).toFixed(3);
        this.el.labPCR.textContent = (1 - pFA).toFixed(3);
        this.el.labNote.textContent =
            `d' = ${dP.toFixed(2)} 决定两条曲线分开的程度；c = ${cc.toFixed(2)} 只决定判定阈的位置。` +
            `拖动 c 而保持 d' 不变，你会看到四个格子的数值此消彼长，但 d' 始终不动——` +
            `这正是"能力"与"标准"可以彼此独立变化的含义。`;

        // 实测操作点：仅在已有一局完整数据时传入
        const obsPFA = this.result ? this.result.pFARaw : null;
        const obsPHit = this.result ? this.result.pHitRaw : null;

        SDTCharts.drawDistribution('chartDist', dP, cc);
        SDTCharts.drawROC('chartRoc', dP, obsPFA, obsPHit);

        this.el.distCaption.textContent =
            `蓝线为噪音分布、绿线为信号分布，黄色虚线是判定阈 c。阈右侧的绿色面积就是 ` +
            `P(Hit) = ${pHit.toFixed(3)}，红色面积就是 P(FA) = ${pFA.toFixed(3)}。` +
            `把 c 拖到很正的位置，两块面积同时缩小；把 d' 拖大，绿色面积会相对红色面积明显扩张。`;
    },

    /* ================= 多局历史对比（加分项） ================= */

    saveHistory(r) {
        if (!this.storageOK) return;
        try {
            const list = this.loadHistory();
            list.push({
                ts: Date.now(),
                trials: this.config.trials,
                diffKey: this.config.diffKey,
                diffLabel: this.config.diff.label,
                prior: this.config.prior,
                H: r.H, M: r.M, FA: r.FA, CR: r.CR,
                pHitRaw: r.pHitRaw,
                pFARaw: r.pFARaw,
                dPrime: r.dPrime,
                c: r.c,
                accuracy: r.accuracy
            });
            // 只保留最近 MAX_HISTORY 局
            const trimmed = list.slice(-this.MAX_HISTORY);
            window.localStorage.setItem(this.HISTORY_KEY, JSON.stringify(trimmed));
        } catch (e) {
            this.storageOK = false;
        }
    },

    loadHistory() {
        if (!this.storageOK) return [];
        try {
            const raw = window.localStorage.getItem(this.HISTORY_KEY);
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    },

    openHistory() {
        this.renderHistory();
        this.el.historyModal.classList.remove('hidden');
    },

    closeHistory() {
        this.el.historyModal.classList.add('hidden');
    },

    clearHistory() {
        if (!window.confirm('确定要清空全部历史记录吗？此操作不可撤销。')) return;
        try {
            window.localStorage.removeItem(this.HISTORY_KEY);
        } catch (e) { /* 存储不可用时无需处理 */ }
        this.renderHistory();
    },

    /** 渲染历史记录：按 d' 降序作为排行榜，并标出每一局的操作风格 */
    renderHistory() {
        const list = this.loadHistory();
        const box = this.el.historyList;

        if (!list.length) {
            box.innerHTML = '<p class="history-empty">还没有已完成的实验记录。完成一局后回到这里就能看到对比。</p>';
            return;
        }

        // 按 d' 降序排列，d' 相同则准确率高者在前
        const ranked = list.slice().sort((a, b) =>
            b.dPrime - a.dPrime || b.accuracy - a.accuracy
        );

        let rows = '';
        ranked.forEach((h, i) => {
            const time = new Date(h.ts);
            const stamp = `${time.getMonth() + 1}/${time.getDate()} ` +
                          `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
            const style = h.c > 0.15 ? '保守' : (h.c < -0.15 ? '宽松' : '中立');
            rows += `<tr>
                <td class="${i === 0 ? 'rank-1' : ''}">${i + 1}</td>
                <td>${stamp}</td>
                <td><span class="diff-tag diff-${h.diffKey}">${h.diffLabel}</span></td>
                <td>${h.trials}</td>
                <td>${(h.pHitRaw * 100).toFixed(1)}%</td>
                <td>${(h.pFARaw * 100).toFixed(1)}%</td>
                <td class="c-hit">${h.dPrime.toFixed(3)}</td>
                <td class="c-miss">${(h.c >= 0 ? '+' : '') + h.c.toFixed(3)}</td>
                <td>${h.accuracy.toFixed(1)}%</td>
                <td>${style}</td>
            </tr>`;
        });

        box.innerHTML = `
            <table class="history-table">
                <thead>
                    <tr>
                        <th>排名</th><th>时间</th><th>难度</th><th>试次</th>
                        <th>P(Hit)</th><th>P(FA)</th><th>d'</th><th>c</th><th>准确率</th><th>风格</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <p class="note">按辨别力 d' 降序排列。同一个 d' 下，c 为正表示保守、为负表示宽松——
            把几局不同难度的成绩放在一起看，就能分辨出"难度变了"和"你的标准变了"这两件不同的事。</p>`;
    },

    /* ================= 中止与复位 ================= */

    abort() {
        this.clearTimers();
        this.phase = 'idle';
        this.el.radarBlip.classList.remove('on');
        this.el.radarClutter.innerHTML = '';
        this.backToSetup();
    },

    backToSetup() {
        this.clearTimers();
        this.phase = 'idle';
        this.showScreen('setup');
    },

    clearTimers() {
        if (this.obsTimerId !== null) {
            window.clearTimeout(this.obsTimerId);
            this.obsTimerId = null;
        }
        if (this.feedbackTimerId !== null) {
            window.clearTimeout(this.feedbackTimerId);
            this.feedbackTimerId = null;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => SDTApp.init());
