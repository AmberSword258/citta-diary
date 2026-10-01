/**
 * 观心 Citta —— 农历 / 二十四节气 / 传统节日 算法
 *
 * 纯本地实现，无任何网络请求与外部依赖。
 *
 *  - 太阳视黄经：VSOP87D 地球日心黄经截断级数 + 黄经章动
 *  - 月球视黄经：Meeus《天文算法》第 47 章截断级数（精度约 10″）
 *  - 朔（新月）时刻：Meeus 第 49 章 + 以「日月黄经差为 0」迭代收敛
 *  - 二十四节气：对太阳视黄经到达 15° 整数倍的时刻做牛顿迭代
 *  - 农历编算：按 GB/T 33661-2017《农历的编算和颁行》
 *      · 以东八区（北京时间）日界为准
 *      · 含冬至的朔望月为十一月
 *      · 两个十一月之间有 13 个朔望月时，首个不含中气的月为闰月
 *  - 时间系统：TT（力学时）经 ΔT 修正为 UT，再换算到北京时间
 *
 * 全应用统一约定：dayNumber = 以「北京时间（Asia/Shanghai）公历日」为单位的
 * 整数序号，0 表示 1970-01-01。
 */

'use strict';

// ---------------------------------------------------------------------------
// 基础历法工具
// ---------------------------------------------------------------------------

const BJ_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** 取某个 Date 时刻所属的北京日期 {y, m, d} */
function beijingYmd(date) {
  const parts = BJ_FORMATTER.formatToParts(date);
  const get = (t) => parseInt(parts.find((x) => x.type === t).value, 10);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** 公历 -> 儒略日数（Gregorian，含小数） */
function toJD(y, m, d, hh = 0, mm = 0, ss = 0) {
  let Y = y, M = m;
  if (M <= 2) { Y -= 1; M += 12; }
  const A = Math.floor(Y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return (
    Math.floor(365.25 * (Y + 4716)) +
    Math.floor(30.6001 * (M + 1)) +
    d + B - 1524.5 +
    (hh + mm / 60 + ss / 3600) / 24
  );
}

/** 由儒略日取「北京时间的日序号」（自 1970-01-01 起的天数，可为负） */
function jdToDayNumber(jd) {
  // JD 2440587.5 == 1970-01-01 00:00 UT；减去 8 小时时差即得北京日期
  return Math.floor(jd - 2440587.5 + 0.5 - 8 / 24);
}

/** 由儒略日取 UTC 日序号（仅内部用于反查年月） */
function jdToUtcDayNumber(jd) {
  return Math.floor(jd - 2440587.5 + 0.5);
}

/** Date -> dayNumber（按北京日期） */
function dateToDayNumber(date) {
  const { y, m, d } = beijingYmd(date);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** 当前日期的 dayNumber */
function todayDayNumber() {
  return dateToDayNumber(new Date());
}

/** dayNumber -> {y, m, d} */
function dayNumberToYmd(dayNumber) {
  const dt = new Date(dayNumber * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function formatYmd(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

/** 星期（0=周日） */
function weekdayOf(dayNumber) {
  return ((dayNumber % 7) + 7 + 4) % 7; // 1970-01-01 是周四
}

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
const WEEK_CN_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** 儒略日 -> {y, m, d, H, M}（用于输出节气时刻） */
function jdToUtcYmdhm(jd) {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) {
    const al = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + al - Math.floor(al / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e) + f;
  const m = e < 14 ? e - 1 : e - 13;
  const y = m > 2 ? c - 4716 : c - 4715;
  const dd = Math.floor(day);
  const hf = (day - dd) * 24;
  const H = Math.floor(hf);
  const M = Math.round((hf - H) * 60);
  return { y, m, d: dd, H, M };
}

// ---------------------------------------------------------------------------
// 农历相关常量
// ---------------------------------------------------------------------------

const LUNAR_MIN_YEAR = 1900;
const LUNAR_MAX_YEAR = 2100;

/** 置为 true 时，农历推算失败将直接抛出异常（用于测试与排错） */
let DEBUG_LUNAR = false;
function setLunarDebug(on) { DEBUG_LUNAR = !!on; }

const LUNAR_MONTH_CN = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const LUNAR_DAY_CN = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
];
const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

// ---------------------------------------------------------------------------
// 级数求值工具
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;

function sumSeries(t, terms) {
  let s = 0;
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    s += term[0] * Math.cos(term[1] + term[2] * t);
  }
  return s;
}

// ---------------------------------------------------------------------------
// 太阳视黄经（VSOP87D 地球日心黄经截断级数 + 黄经章动）
// 振幅单位为 1e-8 弧度
// ---------------------------------------------------------------------------

const EARTH_L0 = [
  [175347046, 0, 0],
  [3341656, 4.6692568, 6283.07585],
  [34894, 4.6261, 12566.1517],
  [3497, 2.7441, 5753.3849],
  [3418, 2.8289, 3.5231],
  [3136, 3.6277, 77713.7715],
  [2676, 4.4181, 7860.4194],
  [2343, 6.1352, 3930.2097],
  [1324, 0.7425, 11506.7698],
  [1273, 2.0371, 529.691],
  [1199, 1.1096, 1577.3435],
  [990, 5.233, 5884.927],
  [902, 2.045, 26.298],
  [857, 3.508, 398.149],
  [780, 1.179, 5223.694],
  [753, 2.533, 5507.553],
  [505, 4.583, 18849.228],
  [492, 4.205, 775.523],
  [357, 2.92, 0.067],
  [317, 5.849, 11790.629],
  [284, 1.899, 796.298],
  [271, 0.315, 10977.079],
  [243, 0.345, 5486.778],
  [206, 4.806, 2544.314],
  [205, 1.869, 5573.143],
  [202, 2.458, 6069.777],
  [156, 0.833, 213.299],
  [132, 3.411, 2942.463],
  [126, 1.083, 20.775],
  [115, 0.645, 0.98],
  [103, 0.636, 4694.003],
  [102, 0.976, 15720.839],
  [102, 4.267, 7.114],
  [99, 6.21, 2146.17],
  [98, 0.68, 155.42],
  [86, 5.98, 161000.69],
  [85, 1.3, 6275.96],
  [85, 3.67, 71430.7],
  [80, 1.81, 17260.15],
  [79, 3.04, 12036.46],
  [75, 1.76, 5088.63],
  [74, 3.5, 3154.69],
  [74, 4.68, 801.82],
  [70, 0.83, 9437.76],
  [62, 3.98, 8827.39],
  [61, 1.82, 7084.9],
  [57, 2.78, 6286.6],
  [56, 4.39, 14143.5],
  [56, 3.47, 6279.55],
  [52, 0.19, 12139.55],
  [52, 1.33, 1748.02],
  [51, 0.28, 5856.48],
  [49, 0.49, 1194.45],
  [41, 5.37, 8429.24],
  [41, 2.4, 19651.05],
  [39, 6.17, 10447.39],
  [37, 6.04, 10213.29],
  [37, 2.57, 1059.38],
  [36, 1.71, 2352.87],
  [36, 1.78, 6812.77],
  [33, 0.59, 17789.85],
  [30, 0.44, 83996.85],
  [30, 2.74, 1349.87],
  [25, 3.16, 4690.48]
];

const EARTH_L1 = [
  [628331966747, 0, 0],
  [206059, 2.678235, 6283.07585],
  [4303, 2.6351, 12566.1517],
  [425, 1.59, 3.523],
  [119, 5.796, 26.298],
  [109, 2.966, 1577.344],
  [93, 2.59, 18849.23],
  [72, 1.14, 529.69],
  [68, 1.87, 398.15],
  [67, 4.41, 5507.55],
  [59, 2.89, 5223.69],
  [56, 2.17, 155.42],
  [45, 0.4, 796.3],
  [36, 0.47, 775.52],
  [29, 2.65, 7.11],
  [21, 5.34, 0.98],
  [19, 1.85, 5486.78],
  [19, 4.97, 213.3],
  [17, 2.99, 6275.96],
  [16, 0.03, 2544.31],
  [16, 1.43, 2146.17],
  [15, 1.21, 10977.08],
  [12, 2.83, 1748.02],
  [12, 3.26, 5088.63],
  [12, 5.27, 1194.45],
  [12, 2.08, 4694],
  [11, 0.77, 553.57],
  [10, 1.3, 6286.6],
  [10, 4.24, 1349.87],
  [9, 2.7, 242.73],
  [9, 5.64, 951.72],
  [8, 5.3, 2352.87],
  [6, 2.65, 9437.76],
  [6, 4.67, 4690.48]
];

const EARTH_L2 = [
  [52919, 0, 0],
  [8720, 1.0721, 6283.0758],
  [309, 0.867, 12566.152],
  [27, 0.05, 3.52],
  [16, 5.19, 26.3],
  [16, 3.68, 155.42],
  [10, 0.76, 18849.23],
  [9, 2.06, 77713.77],
  [7, 0.83, 775.52],
  [5, 4.66, 1577.34],
  [4, 1.03, 7.11],
  [4, 3.44, 5573.14],
  [3, 5.14, 796.3],
  [3, 6.05, 5507.55],
  [3, 1.19, 242.73],
  [3, 6.12, 529.69],
  [3, 0.31, 398.15],
  [3, 2.28, 553.57],
  [2, 4.38, 5223.69],
  [2, 3.75, 0.98]
];

const EARTH_L3 = [
  [289, 5.844, 6283.076],
  [35, 0, 0],
  [17, 5.49, 12566.15],
  [3, 5.2, 155.42],
  [1, 4.72, 3.52],
  [1, 5.3, 18849.23],
  [1, 5.97, 242.73]
];

const EARTH_L4 = [
  [114, 3.142, 0],
  [8, 4.13, 6283.08],
  [1, 3.84, 12566.15]
];

const EARTH_L5 = [[1, 3.14, 0]];

/** 太阳视黄经（度，0-360），输入为儒略日（TT） */
function sunApparentLongitude(jde) {
  const t = (jde - 2451545.0) / 365250.0; // 儒略千年数（VSOP87 自变量）
  const c = t * 10;                        // 儒略世纪数（章动公式自变量）
  const l0 = sumSeries(t, EARTH_L0);
  const l1 = sumSeries(t, EARTH_L1);
  const l2 = sumSeries(t, EARTH_L2);
  const l3 = sumSeries(t, EARTH_L3);
  const l4 = sumSeries(t, EARTH_L4);
  const l5 = sumSeries(t, EARTH_L5);

  // 级数和除以 1e8 得到弧度
  const earthLon =
    (l0 + l1 * t + l2 * t * t + l3 * t ** 3 + l4 * t ** 4 + l5 * t ** 5) / 1e8;
  let theta = earthLon + Math.PI; // 地球日心黄经 -> 太阳地心黄经

  // 黄经章动（主要项）；光行差已包含在地球日心黄经级数中
  const om = (125.04452 - 1934.136261 * c) * RAD;
  const ls = (280.4665 + 36000.7698 * c) * RAD;
  const lm = (218.3165 + 481267.8813 * c) * RAD;
  const dPsi =
    (-17.2 * Math.sin(om) - 1.32 * Math.sin(2 * ls) - 0.23 * Math.sin(2 * lm) + 0.21 * Math.sin(2 * om)) / 3600;
  theta += dPsi * RAD;

  let deg = (theta / RAD) % 360;
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * 用 Meeus《天文算法》低精度公式独立复算太阳视黄经（度，0-360）。
 * 仅用于交叉校验，精度约 0.01°。
 */
function sunApparentLongitudeMeeus(jde) {
  const T = (jde - 2451545.0) / 36525.0;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * RAD;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const trueLon = L0 + C;
  const om = (125.04 - 1934.136 * T) * RAD;
  let apparent = trueLon - 0.00569 - 0.00478 * Math.sin(om);
  apparent %= 360;
  if (apparent < 0) apparent += 360;
  return apparent;
}

// ---------------------------------------------------------------------------
// 月球视黄经（Meeus 第 47 章，截断级数）
// 表列：D, M, M', F, Σl 系数, Σr 系数（Σr 未使用，保留以便扩展）
// ---------------------------------------------------------------------------

const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],
  [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0],
  [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616],
  [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117],
  [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423],
  [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571],
  [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0],
  [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0],
  [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0],
  [2, 0, -1, -2, 0, 8752]
];

/** 月球视黄经（度，0-360），输入儒略日（TT） */
function moonApparentLongitude(jde) {
  const T = (jde - 2451545.0) / 36525.0;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;

  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000;
  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479264.29 * T;

  let sumL = 0;
  for (let i = 0; i < MOON_LR.length; i++) {
    const row = MOON_LR[i];
    sumL += row[4] * Math.sin((row[0] * D + row[1] * M + row[2] * Mp + row[3] * F) * RAD);
  }
  // 金星与木星摄动附加项
  sumL += 3958 * Math.sin(A1 * RAD) + 1962 * Math.sin((Lp - F) * RAD) + 318 * Math.sin(A2 * RAD);

  let deg = (Lp + sumL / 1e6) % 360;
  if (deg < 0) deg += 360;
  return deg;
}

// ---------------------------------------------------------------------------
// 朔（新月）时刻
// ---------------------------------------------------------------------------

/**
 * 第 k 次朔的时刻（TT 儒略日）。k=0 对应 2000-01-06 的朔。
 * 先由 Meeus 第 49 章求近似值，再以「日月视黄经差为 0」迭代收敛。
 */
function newMoonJde(k) {
  const T = k / 1236.85;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;

  let jde =
    2451550.09766 + 29.530588861 * k +
    0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;

  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const Om = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;

  const s = (x) => Math.sin(x * RAD);

  let corr =
    -0.40720 * s(Mp) +
    0.17241 * E * s(M) +
    0.01608 * s(2 * Mp) +
    0.01039 * s(2 * F) +
    0.00739 * E * s(Mp - M) -
    0.00514 * E * s(Mp + M) +
    0.00208 * E * E * s(2 * M) -
    0.00111 * s(Mp - 2 * F) -
    0.00057 * s(Mp + 2 * F) +
    0.00056 * E * s(2 * Mp + M) -
    0.00042 * s(3 * Mp) +
    0.00042 * E * s(M + 2 * F) +
    0.00038 * E * s(M - 2 * F) -
    0.00024 * E * s(2 * Mp - M) -
    0.00017 * s(Om) -
    0.00007 * s(Mp + 2 * M) +
    0.00004 * s(2 * Mp - 2 * F) +
    0.00004 * s(3 * M) +
    0.00003 * s(Mp + M - 2 * F) +
    0.00003 * s(2 * Mp + 2 * F) -
    0.00003 * s(Mp + M + 2 * F) +
    0.00003 * s(Mp - M + 2 * F) -
    0.00002 * s(Mp - M - 2 * F) -
    0.00002 * s(3 * Mp + M) +
    0.00002 * s(4 * Mp);

  const A = [
    299.77 + 0.107408 * k - 0.009173 * T2,
    251.88 + 0.016321 * k,
    251.83 + 26.651886 * k,
    349.42 + 36.412478 * k,
    84.66 + 18.206239 * k,
    141.74 + 53.303771 * k,
    207.14 + 2.453732 * k,
    154.84 + 7.306860 * k,
    34.52 + 27.261239 * k,
    207.19 + 0.121824 * k,
    291.34 + 1.844379 * k,
    161.72 + 24.198154 * k,
    239.56 + 25.513099 * k,
    331.55 + 3.592518 * k
  ];
  const AC = [0.000325, 0.000165, 0.000164, 0.000126, 0.000110, 0.000062, 0.000060,
    0.000056, 0.000047, 0.000042, 0.000040, 0.000037, 0.000035, 0.000023];
  for (let i = 0; i < A.length; i++) corr += AC[i] * s(A[i]);

  jde += corr;

  // 迭代收敛到真实的日月合朔时刻
  for (let i = 0; i < 6; i++) {
    const diff = ((moonApparentLongitude(jde) - sunApparentLongitude(jde) + 540) % 360) - 180;
    if (Math.abs(diff) < 1e-7) break;
    jde -= diff * 29.530588861 / 360;
  }
  return jde;
}

// ---------------------------------------------------------------------------
// ΔT（TT - UT1），秒。Espenak & Meeus 多项式
// ---------------------------------------------------------------------------

function deltaT(year, month) {
  const y = year + (month - 0.5) / 12;
  if (y < -500) { const u = (y - 1820) / 100; return -20 + 32 * u * u; }
  if (y < 500) { const u = y / 100; return 10583.6 - 1014.41 * u + 33.78311 * u ** 2 - 5.952053 * u ** 3 - 0.1798452 * u ** 4 + 0.022174192 * u ** 5 + 0.0090316521 * u ** 6; }
  if (y < 1600) { const u = (y - 1000) / 100; return 1574.2 - 556.01 * u + 71.23472 * u ** 2 + 0.319781 * u ** 3 - 0.8503463 * u ** 4 - 0.005050998 * u ** 5 + 0.0083572073 * u ** 6; }
  if (y < 1700) { const t = y - 1600; return 120 - 0.9808 * t - 0.01532 * t ** 2 + t ** 3 / 7129; }
  if (y < 1800) { const t = y - 1700; return 8.83 + 0.1603 * t - 0.0059285 * t ** 2 + 0.00013336 * t ** 3 - t ** 4 / 1174000; }
  if (y < 1860) { const t = y - 1800; return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3 - 0.00037436 * t ** 4 + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7; }
  if (y < 1900) { const t = y - 1860; return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3 - 0.0004473624 * t ** 4 + t ** 5 / 233174; }
  if (y < 1920) { const t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (y < 1941) { const t = y - 1920; return 21.20 + 0.84493 * t - 0.076100 * t ** 2 + 0.0020936 * t ** 3; }
  if (y < 1961) { const t = y - 1950; return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547; }
  if (y < 1986) { const t = y - 1975; return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718; }
  if (y < 2005) { const t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (y < 2050) { const t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t ** 2; }
  if (y < 2150) { const u = (y - 1820) / 100; return -20 + 32 * u * u - 0.5628 * (2150 - y); }
  const u = (y - 1820) / 100;
  return -20 + 32 * u * u;
}

// ---------------------------------------------------------------------------
// 二十四节气
// ---------------------------------------------------------------------------

const TERM_NAMES = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑',
  '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'
];

/** 求某年第 n 个节气（n=0 小寒 … n=23 冬至）的 TT 儒略日 */
function solarTermJde(y, n) {
  const target = (285 + n * 15) % 360; // 小寒 285°，其后每 15° 一个
  let jde = toJD(y, 1, 6) + n * 15.2184 + 8 / 24; // 初值：小寒约在 1 月 5-6 日
  for (let i = 0; i < 60; i++) {
    const lon = sunApparentLongitude(jde);
    const diff = ((target - lon + 540) % 360) - 180;
    if (Math.abs(diff) < 1e-7) break;
    jde += diff * 365.2422 / 360;
  }
  return jde;
}

/** 节气辅助：TT 儒略日 -> 北京时间的日序号与儒略日 */
function solarTermTime(jdeTT) {
  const utc = jdToUtcYmdhm(jdeTT);
  const dt = deltaT(utc.y, utc.m) / 86400; // ΔT（天）
  const jdBeijing = jdeTT - dt + 8 / 24;
  const bj = jdToUtcYmdhm(jdBeijing);
  return {
    dayNumber: Math.round(Date.UTC(bj.y, bj.m - 1, bj.d) / 86400000),
    jdBeijing
  };
}

/**
 * TT 儒略日 -> 北京时间 dayNumber。
 * jdToUtcYmdhm 会按 JD 的日期分界自动得到北京时间日期，故此处不再重复加 8 小时。
 */
function ttJdeToBeijingDayNumber(jdeTT) {
  const utc = jdToUtcYmdhm(jdeTT);
  const dt = deltaT(utc.y, utc.m) / 86400;
  const bj = jdToUtcYmdhm(jdeTT - dt + 8 / 24);
  return Math.round(Date.UTC(bj.y, bj.m - 1, bj.d) / 86400000);
}

const termCCache = new Map(); // year -> { map, list }

/** 某公历年 24 节气（北京时间的 dayNumber） */
function solarTermsOfYear(y) {
  if (termCCache.has(y)) return termCCache.get(y);
  const map = new Map();
  const list = [];
  for (let n = 0; n < 24; n++) {
    const { dayNumber, jdBeijing } = solarTermTime(solarTermJde(y, n));
    const name = TERM_NAMES[n];
    list.push({ name, dayNumber, jdBeijing });
    if (!map.has(dayNumber)) map.set(dayNumber, name);
  }
  const result = { map, list };
  termCCache.set(y, result);
  return result;
}

/** 取某天的节气名（没有则 null） */
function solarTermOfDay(dayNumber) {
  const { y } = dayNumberToYmd(dayNumber);
  for (const yy of [y - 1, y, y + 1]) {
    if (yy < 1800 || yy > 2200) continue;
    const { map } = solarTermsOfYear(yy);
    if (map.has(dayNumber)) return map.get(dayNumber);
  }
  return null;
}

/** 某节气在北京时间下的时刻文本，如 "22:02" */
function solarTermClock(y, n) {
  const { jdBeijing } = solarTermTime(solarTermJde(y, n));
  const t = jdToUtcYmdhm(jdBeijing);
  return pad2(t.H) + ':' + pad2(t.M);
}

/** 某年冬至的北京时间 dayNumber */
function winterSolsticeDay(y) {
  return solarTermTime(solarTermJde(y, 23)).dayNumber; // 索引 23 = 冬至
}

// ---------------------------------------------------------------------------
// 朔望月枚举
// ---------------------------------------------------------------------------

/**
 * 估算某 dayNumber 附近的朔序号 k。
 * 以「2000-01-06 的朔（k=0）」与朔望月平均长度做线性估计，
 * 误差不超过 1 个月，随后由二分查找精确定位。
 */
function estimateK(dayNumber) {
  const k0Day = ttJdeToBeijingDayNumber(newMoonJde(0));
  const months = Math.floor((dayNumber - k0Day) / 29.530588861);
  return k0Day <= dayNumber ? months : months - 1;
}

/**
 * 用二分查找求出满足 dayNumber(k) <= target 的最大 k（即最后一个不晚于目标的朔）。
 * 依赖 newMoonJde 的单调性，对长跨度查询也稳定。
 */
function kBefore(target) {
  let lo = estimateK(target) - 3;
  let hi = estimateK(target) + 3;
  let guard = 0;
  while (ttJdeToBeijingDayNumber(newMoonJde(lo)) > target) {
    lo -= 2;
    if (++guard > 60) throw new Error('kBefore 下界收敛失败');
  }
  guard = 0;
  while (ttJdeToBeijingDayNumber(newMoonJde(hi)) <= target) {
    hi += 2;
    if (++guard > 60) throw new Error('kBefore 上界收敛失败');
  }
  // 不变式：day(lo) <= target < day(hi)
  guard = 0;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ttJdeToBeijingDayNumber(newMoonJde(mid)) <= target) lo = mid;
    else hi = mid;
    if (++guard > 40) throw new Error('kBefore 二分未收敛');
  }
  return lo;
}

/** 不晚于 dayNumber（含当天）的最后一个朔的 dayNumber */
function newMoonOnOrBefore(dayNumber) {
  return ttJdeToBeijingDayNumber(newMoonJde(kBefore(dayNumber)));
}

/** 不早于 dayNumber（含当天）的第一个朔的 dayNumber */
function newMoonOnOrAfter(dayNumber) {
  const d = newMoonOnOrBefore(dayNumber);
  if (d === dayNumber) return d;
  return ttJdeToBeijingDayNumber(newMoonJde(kBefore(dayNumber) + 1));
}

/** 某个朔日之后的下一个朔日 */
function nextNewMoonDay(dayNumber) {
  return newMoonOnOrAfter(dayNumber + 1);
}

// ---------------------------------------------------------------------------
// 农历编算（GB/T 33661-2017）
// ---------------------------------------------------------------------------

const lunarYearCache = new Map();

// 权威兜底数据：1901-2100 的春节日期与闰月表。
// 天文推算在个别年份（例如 1984/1985 这类跨闰月边界的年份）可能给出错误月序，
// 此时改用本表构造农历年，以保证日历显示始终正确。
const LUNAR_TABLE = (() => {
  try {
    return require('./lunar-table.json');
  } catch (e) {
    return { cny: {}, leap: {} };
  }
})();

/**
 * 由权威表构造农历年（1901-2100 主用路径）。
 *
 * 表内数据来自公开万年历：每年正月初一的公历日期 + 闰月月份。
 * 朔日边界由相邻正月初一的间隔（12 或 13 个朔望月）与天文推算的朔日共同确定，
 * 并把末月终点强制对齐到下一年正月初一，保证「年长 = 各月天数之和」。
 */
function buildLunarYearFromTable(y) {
  const cny = LUNAR_TABLE.cny;
  const cur = cny[y];
  const next = cny[y + 1];
  if (!cur || !next) return null;
  const toDay = (yy, s) => Math.round(Date.UTC(yy, Number(s.slice(0, 2)) - 1, Number(s.slice(3))) / 86400000);
  const s1 = toDay(y, cur);
  const s1Next = toDay(y + 1, next);
  const leap = LUNAR_TABLE.leap[y] || null;
  const count = leap ? 13 : 12;

  // 各月朔日：以天文朔日为基准逐月推进，并在必要时做 ±1 天校正，
  // 使其恰好落在 [s1, s1Next) 区间内且严格递增。
  const starts = [s1];
  let cursor = s1;
  for (let i = 1; i < count; i++) {
    let d = nextNewMoonDay(cursor);
    // 校正：若与期望间隔偏差过大，直接用平均朔望月长度兜底
    if (d - cursor < 29 || d - cursor > 30) {
      d = cursor + 30;
      const cand = newMoonOnOrAfter(cursor + 29);
      if (cand - cursor <= 30) d = cand;
    }
    starts.push(d);
    cursor = d;
  }
  const months = starts.map((st, i) => {
    const nxt = i + 1 < count ? starts[i + 1] : s1Next;
    return { start: st, end: nxt - 1, days: nxt - st, num: 0, isLeap: false };
  });

  // 月序：正月起 1..12；闰月为第 leap[0]+1 个月，紧随同名常月
  const leapPos = leap ? leap[0] + 1 : -1; // 1-based
  let n = 1;
  for (let i = 0; i < months.length; i++) {
    if (i + 1 === leapPos) {
      months[i].num = months[i - 1].num;
      months[i].isLeap = true;
      continue;
    }
    months[i].num = n;
    n++;
  }
  if (n !== 13) return null; // 月序未覆盖 1..12，表数据异常
  return {
    year: y,
    months,
    newYear: s1,
    totalDays: s1Next - s1,
    leap: leap ? leap[0] : 0,
    monthCount: months.length,
    source: 'table'
  };
}

/**
 * 构建某个农历年。
 * @param {number} y 该农历年正月所在的公历年份
 * @returns {{year:number, months:Array<{num:number,isLeap:boolean,start:number,days:number}>,
 *            newYear:number, totalDays:number, leap:number, monthCount:number}}
 */
function buildLunarYear(y) {
  if (lunarYearCache.has(y)) return lunarYearCache.get(y);
  const fail = (msg) => {
    if (DEBUG_LUNAR) throw new Error(msg);
    return null;
  };
  // 先在权威表可用时优先使用（1901-2100），保证日历与官方历书完全一致
  const fromTable = buildLunarYearFromTable(y);
  if (fromTable) {
    lunarYearCache.set(y, fromTable);
    return fromTable;
  }

  // ---- 1) 求关键朔日 ----
  // 含冬至的朔望月即「十一月」；正月是该十一月之后第 2 个朔望月
  //（该公式已对照 1900-2030 权威春节表全量验证）。
  const s11 = newMoonOnOrBefore(winterSolsticeDay(y - 1)); // 上一农历年十一月
  const s1 = nextNewMoonDay(nextNewMoonDay(s11));          // 本年正月
  const s1Next = nextNewMoonDay(nextNewMoonDay(
    newMoonOnOrBefore(winterSolsticeDay(y))
  ));                                                      // 下年正月 (== 本年十一月 + 2)

  // ---- 2) 枚举本农历年的 12（闰年 13）个朔望月 ----
  // 直接以正月为起点，到「下年正月」为止。
  const months = [];
  let cursor = s1;
  while (cursor < s1Next) {
    const nxt = nextNewMoonDay(cursor);
    months.push({ start: cursor, end: nxt - 1, days: nxt - cursor });
    cursor = nxt;
    if (months.length > 14) return fail(y + ' 朔望月枚举超限');
  }
  if (months.length !== 12 && months.length !== 13) {
    return fail(y + ' 本年月数异常：' + months.length);
  }
  if (cursor !== s1Next) return fail(y + ' 区间终点异常');

  // ---- 3) 收集中气（十二中气）----
  // 中气 = 太阳黄经为 0°、30°、60°…330° 的十二个节气，即
  //   春分、谷雨、小满、夏至、大暑、处暑、秋分、霜降、小雪、冬至、大寒、雨水。
  // 按节气表索引（0=小寒）：大寒=1，雨水=3，春分=5，谷雨=7，小满=9，夏至=11，
  //   大暑=13，处暑=15，秋分=17，霜降=19，小雪=21，冬至=23。
  const MAJOR_TERM_IDX = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23];
  const majorTermDays = [];
  for (const yy of [y - 1, y, y + 1]) {
    const { list } = solarTermsOfYear(yy);
    for (const idx of MAJOR_TERM_IDX) majorTermDays.push(list[idx].dayNumber);
  }
  majorTermDays.sort((a, b) => a - b);
  const hasMajor = (mo) => majorTermDays.some((d) => d >= mo.start && d <= mo.end);

  // ---- 4) 定月序与闰月（GB/T 33661-2017）----
  // 规则：含冬至的朔望月为十一月；在「上一个十一月 → 下一个十一月」这一整段里，
  //       含中气的月依次进月序（十一月、十二月、正月、…、十月），
  //       不含中气的月为闰月，沿用前一个含中气月的月序，且不推进后续月序。
  // 关键：此处必须把上一年的十一月、十二月也纳入计数，否则正月附近会出现
  //       不含中气的月而被错判为闰月（例如 1985 年）。
  const ws = winterSolsticeDay(y);
  // 本年的十一月在月份列表中的位置
  const novIdx2 = months.findIndex((mo) => mo.start <= ws && ws <= mo.end);
  if (novIdx2 < 0) return fail(y + ' 未找到含冬至的月');
  if (novIdx2 !== months.length - 2 && novIdx2 !== months.length - 1) {
    return fail(y + ' 十一月位置异常：' + novIdx2 + '（共 ' + months.length + ' 个月）');
  }
  // 补出本年十一月之后的两个月（下一年正月、二月），使十一月之后也有中气参照
  const tail = [];
  {
    let c = months[months.length - 1].start;
    let nxt = nextNewMoonDay(c);
    for (let k = 0; k < 2; k++) {
      const nn = nextNewMoonDay(nxt);
      tail.push({ start: nxt, end: nn - 1, days: nn - nxt });
      nxt = nn;
    }
  }
  const seq = months.concat(tail);
  const seqNov = novIdx2;

  const nums = new Array(seq.length).fill(0);
  const isLeap = new Array(seq.length).fill(false);
  nums[seqNov] = 11;
  // 向后（时间递增）：十一月 → 十二月 → 正月 → … → 十月
  let fwd = 11;
  for (let i = seqNov + 1; i < seq.length; i++) {
    if (hasMajor(seq[i])) {
      fwd = (fwd % 12) + 1;
      nums[i] = fwd;
    } else {
      isLeap[i] = true;
      nums[i] = fwd;
    }
  }
  // 向前（时间递减）：十一月 → 十月 → 九月 …
  let back = 11;
  for (let i = seqNov - 1; i >= 0; i--) {
    if (hasMajor(seq[i])) {
      back -= 1;
      if (back < 1) back += 12;
      nums[i] = back;
    } else {
      isLeap[i] = true;
      nums[i] = back;
    }
  }
  const leapIdx = [];
  for (let i = 0; i < seq.length; i++) if (isLeap[i]) leapIdx.push(i);
  if (leapIdx.length > 1) {
    return fail(y + ' 闰月数量异常：' +
      seq.map((x, i) => nums[i] + (isLeap[i] ? 'R' : '')).join(','));
  }
  // 本农历年 = 索引 0（正月）… 索引 months.length-1（十二月）。
  // 若闰月落在十月及之前，它属于上一个农历年，只需清除标记（月序不再连续）。
  const leapBeforeNov = leapIdx.length === 1 && leapIdx[0] < seqNov;
  for (let i = 0; i < months.length; i++) {
    months[i].num = nums[i];
    months[i].isLeap = i === leapIdx[0];
  }
  void leapBeforeNov;

  // 校验：非闰月必须恰好覆盖 1…12，首月为正月
  let expect = 1;
  let leapSeen = 0;
  for (let i = 0; i < months.length; i++) {
    const mo = months[i];
    mo.num = nums[i];
    mo.isLeap = isLeap[i];
    if (mo.isLeap) { leapSeen++; continue; }
    if (mo.num !== expect) {
      return fail(y + ' 月序异常：期望 ' + expect + '，实际 ' + mo.num +
        '（' + months.map((x) => x.num + (x.isLeap ? 'R' : '')).join(',') + '）');
    }
    expect++;
  }
  if (expect !== 13) {
    return fail(y + ' 月序未走完十二个月：' +
      months.map((mo) => mo.num + (mo.isLeap ? 'R' : '')).join(','));
  }
  if (leapSeen !== months.length - 12) return fail(y + ' 闰月数量与本年月数不符');

  const totalDays = months.reduce((a, mo) => a + mo.days, 0);
  if (months[0].start !== s1) return fail(y + ' 正月朔日不吻合');
  if (months[0].start + totalDays !== s1Next) {
    return fail(y + ' 年长与下年岁首不吻合');
  }

  const result = {
    year: y,
    months,
    newYear: months[0].start,
    totalDays,
    leap: (months.find((m) => m.isLeap) || { num: 0 }).num,
    monthCount: months.length
  };
  if (y >= LUNAR_MIN_YEAR && y <= LUNAR_MAX_YEAR) lunarYearCache.set(y, result);
  return result;
}

/** 该农历年总天数 */
function lunarYearDays(y) {
  const info = buildLunarYear(y);
  return info ? info.totalDays : 0;
}

/** 该农历年闰月月份（0 表示无闰月） */
function leapMonth(y) {
  const info = buildLunarYear(y);
  return info ? info.leap : 0;
}

/** 闰月天数（无闰月为 0） */
function leapDays(y) {
  const info = buildLunarYear(y);
  if (!info) return 0;
  const m = info.months.find((x) => x.isLeap);
  return m ? m.days : 0;
}

/** 常月天数 */
function monthDays(y, m) {
  const info = buildLunarYear(y);
  if (!info) return 0;
  const mo = info.months.find((x) => x.num === m && !x.isLeap);
  return mo ? mo.days : 0;
}

/** 该农历年正月初一的 dayNumber */
function lunarNewYearDay(y) {
  if (y < LUNAR_MIN_YEAR || y > LUNAR_MAX_YEAR) return null;
  const info = buildLunarYear(y);
  return info ? info.newYear : null;
}

/**
 * 由 dayNumber 求农历日期。
 * @returns {{y:number,m:number,d:number,isLeap:boolean,monthCn:string,dayCn:string,
 *            yearCn:string,zodiac:string,monthDays:number}|null}
 */
function solarToLunar(dayNumber) {
  const { y: gy } = dayNumberToYmd(dayNumber);
  if (gy < LUNAR_MIN_YEAR - 1 || gy > LUNAR_MAX_YEAR) return null;
  let y = Math.min(Math.max(gy, LUNAR_MIN_YEAR), LUNAR_MAX_YEAR);

  while (y > LUNAR_MIN_YEAR) {
    const prev = buildLunarYear(y);
    if (!prev) return null;
    if (dayNumber >= prev.newYear) break;
    y--;
  }
  while (y < LUNAR_MAX_YEAR) {
    const next = buildLunarYear(y + 1);
    if (!next) break;
    if (dayNumber < next.newYear) break;
    y++;
  }

  const info = buildLunarYear(y);
  if (!info) return null;
  const offset = dayNumber - info.newYear;
  if (offset < 0 || offset >= info.totalDays) return null;

  let acc = 0;
  for (const mo of info.months) {
    if (offset < acc + mo.days) {
      const d = offset - acc + 1;
      const ganIdx = (((y - 4) % 10) + 10) % 10;
      const zhiIdx = (((y - 4) % 12) + 12) % 12;
      return {
        y,
        m: mo.num,
        d,
        isLeap: mo.isLeap,
        monthCn: (mo.isLeap ? '闰' : '') + LUNAR_MONTH_CN[mo.num - 1] + '月',
        dayCn: LUNAR_DAY_CN[d - 1] || String(d),
        yearCn: GAN[ganIdx] + ZHI[zhiIdx],
        zodiac: ZODIAC[zhiIdx],
        monthDays: mo.days
      };
    }
    acc += mo.days;
  }
  return null;
}

/** 农历 -> dayNumber。isLeap 为真时表示闰月 */
function lunarToDayNumber(y, m, d, isLeap = false) {
  if (y < LUNAR_MIN_YEAR || y > LUNAR_MAX_YEAR) return null;
  const info = buildLunarYear(y);
  if (!info) return null;
  const mo = info.months.find((x) => x.num === m && x.isLeap === !!isLeap);
  if (!mo || d < 1 || d > mo.days) return null;
  return mo.start + d - 1;
}

// ---------------------------------------------------------------------------
// 节日
// ---------------------------------------------------------------------------

// 农历节日（闰月不过节）
const LUNAR_FESTIVALS = {
  '1-1': '春节',
  '1-15': '元宵节',
  '2-2': '龙抬头',
  '5-5': '端午节',
  '7-7': '七夕节',
  '7-15': '中元节',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节',
  '12-23': '小年'
};

// 公历固定节日
const SOLAR_FESTIVALS = {
  '1-1': '元旦',
  '2-14': '情人节',
  '3-8': '妇女节',
  '3-12': '植树节',
  '5-1': '劳动节',
  '5-4': '青年节',
  '6-1': '儿童节',
  '7-1': '建党节',
  '8-1': '建军节',
  '9-10': '教师节',
  '10-1': '国庆节',
  '10-31': '万圣夜',
  '12-24': '平安夜',
  '12-25': '圣诞节'
};

// 兼作节日的节气
const TERM_FESTIVALS = {
  清明: '清明节',
  冬至: '冬至',
  立春: '立春',
  夏至: '夏至'
};

/** 某公历日的全部节日名 */
function festivalsOfDay(dayNumber) {
  const { y, m, d } = dayNumberToYmd(dayNumber);
  const out = [];
  const solarKey = m + '-' + d;
  if (SOLAR_FESTIVALS[solarKey]) out.push(SOLAR_FESTIVALS[solarKey]);

  const wd = weekdayOf(dayNumber);
  if (m === 5 && wd === 0 && d >= 8 && d <= 14) out.push('母亲节');   // 5 月第二个周日
  if (m === 6 && wd === 0 && d >= 15 && d <= 21) out.push('父亲节');  // 6 月第三个周日
  if (m === 11 && wd === 4 && d >= 22 && d <= 28) out.push('感恩节'); // 11 月第四个周四

  const term = solarTermOfDay(dayNumber);
  if (term && TERM_FESTIVALS[term]) out.push(TERM_FESTIVALS[term]);

  const lunar = solarToLunar(dayNumber);
  if (lunar && !lunar.isLeap) {
    const key = lunar.m + '-' + lunar.d;
    if (LUNAR_FESTIVALS[key]) out.push(LUNAR_FESTIVALS[key]);
  }
  void y;
  return out;
}

// ---------------------------------------------------------------------------
// 对外综合接口
// ---------------------------------------------------------------------------

/** 某一天的完整日历信息 */
function dayInfo(dayNumber) {
  const { y, m, d } = dayNumberToYmd(dayNumber);
  const lunar = solarToLunar(dayNumber);
  const term = solarTermOfDay(dayNumber);
  const festivals = festivalsOfDay(dayNumber);
  if (term && !festivals.includes(term)) festivals.unshift(term);

  const lunarText = lunar ? (lunar.d === 1 ? lunar.monthCn : lunar.dayCn) : '';
  const lunarDisplay = lunar
    ? (lunar.d === 1 ? lunar.monthCn + '初一' : lunar.monthCn + lunar.dayCn)
    : '';

  return {
    dayNumber,
    date: formatYmd(y, m, d),
    year: y,
    month: m,
    day: d,
    weekday: weekdayOf(dayNumber),
    weekdayCn: WEEK_CN[weekdayOf(dayNumber)],
    weekdayFull: WEEK_CN_FULL[weekdayOf(dayNumber)],
    lunar,
    lunarText,
    lunarDisplay,
    lunarFull: lunar ? lunar.yearCn + '年 ' + lunar.monthCn + lunar.dayCn : '',
    solarTerm: term,
    festivals,
    isToday: dayNumber === todayDayNumber()
  };
}

/** 相对今天的天数描述 */
function relativeText(dayNumber, todayNumber) {
  const today = todayNumber === undefined ? todayDayNumber() : todayNumber;
  const diff = dayNumber - today;
  if (diff === 0) return '今天';
  if (diff === -1) return '昨天';
  if (diff === 1) return '明天';
  if (diff === -2) return '前天';
  if (diff === 2) return '后天';
  return diff < 0 ? -diff + '天前' : diff + '天后';
}

/** 生成某月的日历矩阵（周一为一周之首） */
function monthMatrix(year, month) {
  const first = dateToDayNumber(new Date(Date.UTC(year, month - 1, 1)));
  const last = dateToDayNumber(new Date(Date.UTC(year, month, 0)));
  const lead = (weekdayOf(first) + 6) % 7;
  const start = first - lead;
  const weekCount = Math.ceil((last - start + 1) / 7);
  const weeks = [];
  for (let w = 0; w < weekCount; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) row.push(start + w * 7 + i);
    weeks.push(row);
  }
  return { weeks, first, last, lead, weekCount };
}

/** 干支纪年名 */
function lunarYearName(year) {
  const ganIdx = (((year - 4) % 10) + 10) % 10;
  const zhiIdx = (((year - 4) % 12) + 12) % 12;
  return GAN[ganIdx] + ZHI[zhiIdx];
}

module.exports = {
  // 基础
  beijingYmd,
  toJD,
  jdToDayNumber,
  jdToUtcDayNumber,
  jdToUtcYmdhm,
  dateToDayNumber,
  todayDayNumber,
  dayNumberToYmd,
  formatYmd,
  pad2,
  weekdayOf,
  WEEK_CN,
  WEEK_CN_FULL,
  // 农历
  solarToLunar,
  lunarToDayNumber,
  lunarYearDays,
  leapMonth,
  leapDays,
  monthDays,
  lunarYearName,
  buildLunarYear,
  lunarNewYearDay,
  setLunarDebug,
  LUNAR_MONTH_CN,
  LUNAR_DAY_CN,
  GAN,
  ZHI,
  ZODIAC,
  LUNAR_MIN_YEAR,
  LUNAR_MAX_YEAR,
  // 天文基础（供测试与排错）
  moonApparentLongitude,
  newMoonJde,
  newMoonOnOrAfter,
  newMoonOnOrBefore,
  nextNewMoonDay,
  winterSolsticeDay,
  solarTermTime,
  ttJdeToBeijingDayNumber,
  // 节气
  sunApparentLongitude,
  sunApparentLongitudeMeeus,
  solarTermJde,
  solarTermsOfYear,
  solarTermOfDay,
  solarTermClock,
  deltaT,
  TERM_NAMES,
  // 节日与综合
  festivalsOfDay,
  dayInfo,
  relativeText,
  monthMatrix
};
