/**
 * math_sdt.js - 信号检测论 (Signal Detection Theory, SDT) 核心数学与统计计算模块
 * 
 * 包含：
 * 1. 标准正态分布累积分布函数 CDF: Phi(z)
 * 2. 标准正态分布反函数 (分位数/Probit函数): Z(p)
 * 3. 极端概率半格校正 (Macmillan & Kaplan, 1985; Hautus, 1995)
 * 4. 辨别力 d' (d-prime)、判定标准 c (criterion) 与似然比 beta 计算
 */

const SDTMath = {
    /**
     * 标准正态分布累积分布函数 Phi(z)
     * 使用 Hastings 展开式近似，最大绝对误差 < 7.5e-8
     */
    cdf(z) {
        if (z === 0) return 0.5;
        const b1 = 0.319381530;
        const b2 = -0.356563782;
        const b3 = 1.781477937;
        const b4 = -1.821255978;
        const b5 = 1.330274429;
        const p = 0.2316419;
        const c2 = 0.3989422804014327; // 1 / sqrt(2 * PI)

        const absZ = Math.abs(z);
        const t = 1.0 / (1.0 + p * absZ);
        const pdf = c2 * Math.exp(-0.5 * absZ * absZ);
        const poly = t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
        const ans = 1.0 - pdf * poly;

        return z >= 0 ? ans : (1.0 - ans);
    },

    /**
     * 标准正态分布概率密度函数 PDF: phi(z)
     */
    pdf(z) {
        return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z);
    },

    /**
     * 标准正态分布反函数 Z(p) / Probit(p)
     * 采用 Acklam 算法高精度逼近有理多项式，精度误差 < 1.15e-9
     * 输入概率 p 在 (0, 1) 之间
     */
    probit(p) {
        if (p <= 0.0) p = 1e-6;
        if (p >= 1.0) p = 1.0 - 1e-6;

        // 系数定义
        const a = [
            -3.969683028665376e+01,  2.209460984245205e+02,
            -2.759285104469687e+02,  1.383577518672690e+02,
            -3.066479806614716e+01,  2.506628277459239e+00
        ];
        const b = [
            -5.447609879822406e+01,  1.615858368580409e+02,
            -1.556989798598866e+02,  6.680131188771972e+01,
            -1.328068155288572e+01
        ];
        const c = [
            -7.784894002430293e-03, -3.223964580411365e-01,
            -2.400758277161838e+00, -2.549732539343734e+00,
             4.374664141464968e+00,  2.938163982698783e+00
        ];
        const d = [
             7.784695709041462e-03,  3.224671290700398e-01,
             2.445134137142996e+00,  3.754408661907416e+00
        ];

        const p_low = 0.02425;
        const p_high = 1 - p_low;
        let q, r;

        if (p < p_low) {
            // 下尾区
            q = Math.sqrt(-2 * Math.log(p));
            return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
                   ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
        } else if (p <= p_high) {
            // 中间区
            q = p - 0.5;
            r = q * q;
            return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
                   (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
        } else {
            // 上尾区
            q = Math.sqrt(-2 * Math.log(1 - p));
            return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
                    ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
        }
    },

    /**
     * 计算完整的 SDT 统计量
     * @param {number} H - 击中次数 (Hits)
     * @param {number} M - 漏报次数 (Misses)
     * @param {number} FA - 虚警次数 (False Alarms)
     * @param {number} CR - 正确否定次数 (Correct Rejections)
     */
    calculateSDT(H, M, FA, CR) {
        const totalSignal = H + M;
        const totalNoise = FA + CR;
        const totalTrials = totalSignal + totalNoise;

        // 原始比率
        let pHitRaw = totalSignal > 0 ? (H / totalSignal) : 0;
        let pFARaw = totalNoise > 0 ? (FA / totalNoise) : 0;

        // 极端概率校正 (1/(2N) 校正法则，Macmillan & Creelman, 2005)
        let pHit = pHitRaw;
        let pFA = pFARaw;
        let isCorrected = false;

        if (totalSignal > 0) {
            if (H === 0) {
                pHit = 1 / (2 * totalSignal);
                isCorrected = true;
            } else if (H === totalSignal) {
                pHit = 1 - 1 / (2 * totalSignal);
                isCorrected = true;
            }
        } else {
            pHit = 0.5;
        }

        if (totalNoise > 0) {
            if (FA === 0) {
                pFA = 1 / (2 * totalNoise);
                isCorrected = true;
            } else if (FA === totalNoise) {
                pFA = 1 - 1 / (2 * totalNoise);
                isCorrected = true;
            }
        } else {
            pFA = 0.5;
        }

        // Z 分数计算
        const zHit = this.probit(pHit);
        const zFA = this.probit(pFA);

        // 1. 辨别力 d' = Z(Hit) - Z(FA)
        const dPrime = zHit - zFA;

        // 2. 判定标准 c = -0.5 * (Z(Hit) + Z(FA))
        // c > 0: 保守 (偏向于回答无信号)
        // c < 0: 宽松/冒险 (偏向于回答有信号)
        // c = 0: 无偏
        const c = -0.5 * (zHit + zFA);

        // 3. 似然比标准 beta = phi(zHit) / phi(zFA) = exp(d' * c)
        const beta = Math.exp(dPrime * c);

        // 4. 准确率 Accuracy = (H + CR) / Total
        const accuracy = totalTrials > 0 ? ((H + CR) / totalTrials) : 0;

        // 5. 灵敏度非参数指标 A' (A-prime) 作为辅助对照
        let aPrime = 0.5;
        if (pHit >= pFA) {
            aPrime = 0.5 + ((pHit - pFA) * (1 + pHit - pFA)) / (4 * pHit * (1 - pFA) || 1e-5);
        } else {
            aPrime = 0.5 - ((pFA - pHit) * (1 + pFA - pHit)) / (4 * pFA * (1 - pHit) || 1e-5);
        }

        return {
            H, M, FA, CR,
            totalSignal,
            totalNoise,
            totalTrials,
            pHitRaw,
            pFARaw,
            pHit,
            pFA,
            isCorrected,
            zHit,
            zFA,
            dPrime: parseFloat(dPrime.toFixed(3)),
            c: parseFloat(c.toFixed(3)),
            beta: parseFloat(beta.toFixed(3)),
            accuracy: parseFloat((accuracy * 100).toFixed(1)),
            aPrime: parseFloat(aPrime.toFixed(3)),
            criterionType: c > 0.15 ? "保守型 (倾向报无)" : (c < -0.15 ? "宽松/冒险型 (倾向报有)" : "中立无偏型")
        };
    }
};

// 导出供环境检测
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SDTMath;
}
