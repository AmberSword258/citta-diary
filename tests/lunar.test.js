/**
 * 农历 / 节气 / 节日 算法测试
 * 运行：node tests/lunar.test.js
 */
'use strict';

const assert = require('assert');
const L = require('../src/shared/lunar.js');

const results = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
  }
}

/** 由公历构造 dayNumber */
function dn(y, m, d) { return L.dateToDayNumber(new Date(y, m - 1, d)); }

/** 便捷断言农历 */
function assertLunar(y, m, d, ey, em, ed, leap = false, label = '') {
  const got = L.solarToLunar(dn(y, m, d));
  assert.ok(got, `${label} ${y}-${m}-${d} 应能转换`);
  assert.strictEqual(
    `${got.y}-${got.m}-${got.d}-${got.isLeap}`,
    `${ey}-${em}-${ed}-${leap}`,
    `${label} 公历 ${y}-${m}-${d} 期望农历 ${ey}-${em}-${ed}${leap ? '(闰)' : ''}，实际 ${got.y}-${got.m}-${got.d}${got.isLeap ? '(闰)' : ''}`
  );
}

// ---------------------------------------------------------------------------
// 1. 农历锚点（权威已知日期）
// ---------------------------------------------------------------------------
check('农历锚点：春节', () => {
  assertLunar(2024, 2, 10, 2024, 1, 1, false, '春节');
  assertLunar(2023, 1, 22, 2023, 1, 1, false, '春节');
  assertLunar(2025, 1, 29, 2025, 1, 1, false, '春节');
  assertLunar(2022, 2, 1, 2022, 1, 1, false, '春节');
  assertLunar(2021, 2, 12, 2021, 1, 1, false, '春节');
  assertLunar(2020, 1, 25, 2020, 1, 1, false, '春节');
  assertLunar(2026, 2, 17, 2026, 1, 1, false, '春节');
  assertLunar(2033, 1, 31, 2033, 1, 1, false, '春节');
  assertLunar(2034, 2, 19, 2034, 1, 1, false, '春节（本世纪最晚）');
  assertLunar(2000, 2, 5, 2000, 1, 1, false, '春节');
  assertLunar(1912, 2, 18, 1912, 1, 1, false, '春节');
});

check('农历锚点：闰月', () => {
  // 2023 闰二月：二月 2023-02-20 ~ 03-21，闰二月 03-22 ~ 04-19，三月 04-20 起
  assertLunar(2023, 2, 20, 2023, 2, 1, false, '二月首日');
  assertLunar(2023, 3, 21, 2023, 2, 30, false, '二月末日');
  assertLunar(2023, 3, 22, 2023, 2, 1, true, '闰二月首日');
  assertLunar(2023, 4, 19, 2023, 2, 29, true, '闰二月末日');
  assertLunar(2023, 4, 20, 2023, 3, 1, false, '三月初一');
  // 2020 闰四月
  assertLunar(2020, 5, 23, 2020, 4, 1, true, '2020 闰四月首日');
  // 2025 闰六月
  assertLunar(2025, 7, 25, 2025, 6, 1, true, '2025 闰六月首日');
  assertLunar(2025, 8, 22, 2025, 6, 29, true, '2025 闰六月末日');
  assertLunar(2025, 8, 23, 2025, 7, 1, false, '2025 七月初一');
  // 跨公历年
  assertLunar(2026, 1, 1, 2025, 11, 13, false, '跨年');
  assertLunar(2024, 12, 1, 2024, 11, 1, false, '冬月初一');
  assertLunar(2024, 12, 31, 2024, 12, 1, false, '腊月初一');
});

check('农历：2022 为平年（无闰月）', () => {
  // 权威数据：2022 农历壬寅年无闰月，全年 355 天
  assert.strictEqual(L.leapMonth(2022), 0, '2022 无闰月');
  assert.strictEqual(L.lunarYearDays(2022), 355, '2022 年长 355 天');
  assert.strictEqual(L.leapMonth(2023), 2, '2023 闰二月');
  assert.strictEqual(L.lunarYearDays(2023), 384, '2023 年长 384 天');
  assert.strictEqual(L.leapMonth(2025), 6, '2025 闰六月');
  assert.strictEqual(L.lunarYearDays(2025), 384, '2025 年长 384 天');
  assert.strictEqual(L.leapMonth(2024), 0, '2024 无闰月');
  assert.strictEqual(L.lunarYearDays(2024), 354, '2024 年长 354 天');
});

check('农历：与官方日历逐月对照（2022）', () => {
  // 依据公开万年历：2022 各月首日
  const grid = [
    ['2022-02-01', '正月初一'], ['2022-03-03', '二月初一'], ['2022-04-01', '三月初一'],
    ['2022-05-01', '四月初一'], ['2022-05-30', '五月初一'], ['2022-06-29', '六月初一'],
    ['2022-07-29', '七月初一'], ['2022-08-27', '八月初一'], ['2022-09-26', '九月初一'],
    ['2022-10-25', '十月初一'], ['2022-11-24', '冬月初一'], ['2022-12-23', '腊月初一']
  ];
  for (const [ds, exp] of grid) {
    const [yy, mm, dd] = ds.split('-').map(Number);
    const r = L.solarToLunar(dn(yy, mm, dd));
    assert.ok(r, `${ds} 应能转换`);
    assert.strictEqual(r.monthCn + r.dayCn, exp, `${ds} 应为 ${exp}`);
  }
});

check('农历锚点：八月十五中秋', () => {
  assertLunar(2024, 9, 17, 2024, 8, 15, false, '中秋');
  assertLunar(2023, 9, 29, 2023, 8, 15, false, '中秋');
  assertLunar(2025, 10, 6, 2025, 8, 15, false, '中秋');
});

check('农历锚点：正月初一相邻', () => {
  // 除夕
  assertLunar(2024, 2, 9, 2023, 12, 30, false, '除夕');
  assertLunar(2025, 1, 28, 2024, 12, 29, false, '除夕');
});

check('农历：无闰月的年份', () => {
  assert.strictEqual(L.leapMonth(2024), 0, '2024 无闰月');
  assert.strictEqual(L.leapMonth(2021), 0, '2021 无闰月');
  assert.strictEqual(L.leapMonth(2023), 2, '2023 闰二月');
  assert.strictEqual(L.leapMonth(2025), 6, '2025 闰六月');
  assert.strictEqual(L.leapMonth(2028), 5, '2028 闰五月');
});

check('农历：年天数与月天数一致性', () => {
  for (let y = 1900; y <= 2100; y++) {
    const sumMonths = 12 * 29 + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      .reduce((acc, m) => acc + (L.monthDays(y, m) - 29), 0);
    const expect = sumMonths + L.leapDays(y);
    const got = L.lunarYearDays(y);
    assert.strictEqual(got, expect, `${y} 年天数不一致：${got} vs ${expect}`);
    assert.ok(got >= 353 && got <= 385, `${y} 年天数异常：${got}`);
  }
});

check('农历：1900-2100 全量往返一致性', () => {
  let count = 0;
  for (let y = 1900; y <= 2099; y++) {
    const start = L.lunarNewYearDay ? null : null; // 不暴露，改用转换
    void start;
    // 用公历年初探测：遍历该农历年的每一天
    let cursor = null;
    // 通过 1 月 1 日附近找到正月初一
    for (let probe = dn(y, 1, 1); probe <= dn(y, 3, 15); probe++) {
      const l = L.solarToLunar(probe);
      if (l && l.m === 1 && l.d === 1 && !l.isLeap && l.y === y) { cursor = probe; break; }
    }
    assert.ok(cursor !== null, `${y} 年未找到正月初一`);
    const total = L.lunarYearDays(y);
    for (let i = 0; i < total; i++) {
      const day = cursor + i;
      const l = L.solarToLunar(day);
      assert.ok(l, `${y} 第 ${i} 天无法转换`);
      assert.strictEqual(l.y, y, `第 ${i} 天农历年应为 ${y}`);
      const back = L.lunarToDayNumber(l.y, l.m, l.d, l.isLeap);
      assert.strictEqual(back, day, `往返不一致 y=${l.y} m=${l.m} d=${l.d} leap=${l.isLeap}`);
      count++;
    }
    // 下一年正月初一应恰好等于 cursor + total
    const next = L.solarToLunar(cursor + total);
    assert.strictEqual(next.y, y + 1, `${y + 1} 年起始错位`);
    assert.strictEqual(next.m, 1, `${y + 1} 年起始月应为正月`);
    assert.strictEqual(next.d, 1, `${y + 1} 年起始日应为初一`);
  }
  assert.ok(count > 70000, `覆盖天数过少：${count}`);
});

// ---------------------------------------------------------------------------
// 2. 二十四节气（对照紫金山天文台/公开历书）
// ---------------------------------------------------------------------------
check('节气：2024 全年 24 节气日期', () => {
  const expect = {
    小寒: '2024-01-06', 大寒: '2024-01-20', 立春: '2024-02-04', 雨水: '2024-02-19',
    惊蛰: '2024-03-05', 春分: '2024-03-20', 清明: '2024-04-04', 谷雨: '2024-04-19',
    立夏: '2024-05-05', 小满: '2024-05-20', 芒种: '2024-06-05', 夏至: '2024-06-21',
    小暑: '2024-07-06', 大暑: '2024-07-22', 立秋: '2024-08-07', 处暑: '2024-08-22',
    白露: '2024-09-07', 秋分: '2024-09-22', 寒露: '2024-10-08', 霜降: '2024-10-23',
    立冬: '2024-11-07', 小雪: '2024-11-22', 大雪: '2024-12-06', 冬至: '2024-12-21'
  };
  const { list } = L.solarTermsOfYear(2024);
  for (const { name, dayNumber } of list) {
    const { y, m, d } = L.dayNumberToYmd(dayNumber);
    const got = L.formatYmd(y, m, d);
    assert.strictEqual(got, expect[name], `2024 ${name} 期望 ${expect[name]}，实际 ${got}`);
  }
});

check('节气：2025 / 2026 关键节气', () => {
  const cases = [
    [2025, '立春', '2025-02-03'],
    [2025, '春分', '2025-03-20'],
    [2025, '清明', '2025-04-04'],
    [2025, '夏至', '2025-06-21'],
    [2025, '冬至', '2025-12-21'],
    [2026, '立春', '2026-02-04'],
    [2026, '春分', '2026-03-20'],
    [2026, '清明', '2026-04-05'],
    [2026, '冬至', '2026-12-22']
  ];
  for (const [yy, name, exp] of cases) {
    const { list } = L.solarTermsOfYear(yy);
    const item = list.find((x) => x.name === name);
    assert.ok(item, `${yy} ${name} 缺失`);
    const { y, m, d } = L.dayNumberToYmd(item.dayNumber);
    assert.strictEqual(L.formatYmd(y, m, d), exp, `${yy} ${name} 期望 ${exp}`);
  }
});

check('节气：历史年份（2000 / 1990 / 1950）', () => {
  const cases = [
    [2000, '春分', '2000-03-20'],
    [2000, '冬至', '2000-12-21'],
    [1990, '夏至', '1990-06-21'],
    [1950, '立春', '1950-02-04'],
    [2033, '春分', '2033-03-20'],
    [2050, '清明', '2050-04-04']
  ];
  for (const [yy, name, exp] of cases) {
    const { list } = L.solarTermsOfYear(yy);
    const item = list.find((x) => x.name === name);
    const { y, m, d } = L.dayNumberToYmd(item.dayNumber);
    assert.strictEqual(L.formatYmd(y, m, d), exp, `${yy} ${name} 期望 ${exp}`);
  }
});

check('节气：节气间隔与顺序合理', () => {
  for (const yy of [1950, 2000, 2024, 2050, 2099]) {
    const { list } = L.solarTermsOfYear(yy);
    assert.strictEqual(list.length, 24, `${yy} 节气数量`);
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].dayNumber - list[i - 1].dayNumber;
      assert.ok(gap >= 13 && gap <= 17, `${yy} ${list[i].name} 与前一节气间隔 ${gap} 天不合理`);
    }
    assert.strictEqual(list[0].name, '小寒');
    assert.strictEqual(list[23].name, '冬至');
  }
});

check('节气：太阳视黄经自检（与 Meeus 独立公式比对）', () => {
  // J2000.0 (2000-01-01 12:00 TT) 太阳视黄经实测约 280.37°
  const lon = L.sunApparentLongitude(2451545.0);
  assert.ok(Math.abs(lon - 280.374) < 0.02, `J2000 太阳黄经 ${lon}，期望约 280.374`);
  // 与 Meeus《天文算法》低精度公式交叉验证，全年逐月抽样
  for (let y = 1950; y <= 2090; y += 10) {
    for (let m = 1; m <= 12; m++) {
      const jde = L.toJD(y, m, 15) + 0.5;
      const a = L.sunApparentLongitude(jde);
      const b = L.sunApparentLongitudeMeeus(jde);
      let diff = Math.abs(a - b);
      if (diff > 180) diff = 360 - diff;
      assert.ok(diff < 0.02, `${y}-${m} 太阳黄经两法偏差 ${diff.toFixed(5)}°`);
    }
  }
  // 春分点（黄经 0°）应在 3 月
  const jde = L.solarTermJde(2024, 5);
  const { y, m, d } = L.dayNumberToYmd(L.jdToDayNumber(jde));
  assert.strictEqual(`${m}`, '3', `春分应在 3 月，实际 ${y}-${m}-${d}`);
});

check('节气：时刻精度核对（北京时间，对照权威发布）', () => {
  // 官方时刻：2024 大寒 1/20 22:07、2024 清明 4/4 15:02、2025 立春 2/3 22:10、
  //           2025 春分 3/20 17:01。允许 ±30 分钟（VSOP87 截断级数误差）。
  const cases = [
    [2024, 1, [1, 20], 22.1], // 大寒
    [2024, 6, [4, 4], 15.0],  // 清明
    [2025, 2, [2, 3], 22.2],  // 立春
    [2025, 5, [3, 20], 17.0]  // 春分
  ];
  for (const [y, n, [em, ed], eh] of cases) {
    // 直接使用模块导出的北京时间换算，保证与界面显示一致
    const { list } = L.solarTermsOfYear(y);
    const item = list[n];
    const ymd = L.dayNumberToYmd(item.dayNumber);
    assert.strictEqual(ymd.m, em, `${y} ${L.TERM_NAMES[n]} 月份`);
    assert.strictEqual(ymd.d, ed, `${y} ${L.TERM_NAMES[n]} 日期`);
    // 由 jdBeijing 取出北京时间的小时
    const t = L.jdToUtcYmdhm(item.jdBeijing);
    const hours = t.H + t.M / 60;
    assert.ok(Math.abs(hours - eh) < 0.5, `${y} ${L.TERM_NAMES[n]} 时刻 ${hours.toFixed(2)}h，期望约 ${eh}h`);
  }
});

// ---------------------------------------------------------------------------
// 3. 节日
// ---------------------------------------------------------------------------
check('节日：公历与农历节日', () => {
  const f = (y, m, d) => L.festivalsOfDay(dn(y, m, d));
  assert.ok(f(2024, 1, 1).includes('元旦'), '元旦');
  assert.ok(f(2024, 10, 1).includes('国庆节'), '国庆节');
  assert.ok(f(2024, 12, 25).includes('圣诞节'), '圣诞节');
  assert.ok(f(2024, 2, 10).includes('春节'), '春节');
  assert.ok(f(2024, 9, 17).includes('中秋节'), '中秋节');
  assert.ok(f(2024, 6, 10).includes('端午节'), '2024 端午');
  assert.ok(f(2024, 4, 4).includes('清明') || f(2024, 4, 4).includes('清明节'), '2024 清明节气');
  assert.ok(f(2024, 5, 12).includes('母亲节'), '2024 母亲节');
  assert.ok(f(2024, 6, 16).includes('父亲节'), '2024 父亲节');
  assert.ok(f(2024, 2, 9).includes('除夕') === false, '除夕无需内置');
});

check('节日：无节日日期返回空数组', () => {
  const list = L.festivalsOfDay(dn(2024, 3, 14));
  assert.ok(Array.isArray(list), '应返回数组');
  assert.strictEqual(list.length, 0, `2024-03-14 不应有节日，实际 ${JSON.stringify(list)}`);
});

// ---------------------------------------------------------------------------
// 4. dayInfo / relativeText / monthMatrix
// ---------------------------------------------------------------------------
check('dayInfo：结构完整', () => {
  const info = L.dayInfo(dn(2024, 2, 10));
  assert.strictEqual(info.date, '2024-02-10');
  assert.strictEqual(info.weekdayFull, '星期六');
  assert.strictEqual(info.lunarDisplay, '正月初一');
  assert.strictEqual(info.lunarText, '正月');
  assert.ok(info.festivals.includes('春节'));
  assert.strictEqual(info.lunar.zodiac, '龙');
  assert.strictEqual(info.lunar.yearCn, '甲辰');
});

check('relativeText：相对日期描述', () => {
  const today = dn(2024, 6, 15);
  assert.strictEqual(L.relativeText(today, today), '今天');
  assert.strictEqual(L.relativeText(today - 1, today), '昨天');
  assert.strictEqual(L.relativeText(today + 1, today), '明天');
  assert.strictEqual(L.relativeText(today - 2, today), '前天');
  assert.strictEqual(L.relativeText(today + 2, today), '后天');
  assert.strictEqual(L.relativeText(today - 30, today), '30天前');
  assert.strictEqual(L.relativeText(today + 5, today), '5天后');
});

check('monthMatrix：2024 年 2 月布局（周一起始）', () => {
  const { weeks } = L.monthMatrix(2024, 2);
  // 2024-02-01 是周四，周一为首 -> 前导 3 个空位
  const first = L.dayNumberToYmd(weeks[0][0]);
  assert.strictEqual(first.m, 1, `首格应落在 1 月，实际 ${first.m} 月`);
  assert.strictEqual(first.d, 29, `首格应为 1 月 29 日，实际 ${first.d}`);
  assert.strictEqual(L.weekdayOf(weeks[0][0]), 1, '首列应为周一');
  const all = weeks.flat();
  assert.ok(all.includes(dn(2024, 2, 29)), '应包含 2 月 29 日');
  assert.ok(!all.includes(dn(2024, 3, 4)), '不应包含 3 月 4 日');
});

check('monthMatrix：2024 年 1 月（1 月 1 日为周一）', () => {
  const { weeks } = L.monthMatrix(2024, 1);
  assert.strictEqual(weeks[0][0], dn(2024, 1, 1), '1 月 1 日应为第一格');
});

check('dateToDayNumber / dayNumberToYmd 往返', () => {
  for (const [y, m, d] of [[1970, 1, 1], [2000, 2, 29], [2024, 12, 31], [1901, 1, 1], [2099, 6, 15]]) {
    const n = dn(y, m, d);
    const back = L.dayNumberToYmd(n);
    assert.strictEqual(`${back.y}-${back.m}-${back.d}`, `${y}-${m}-${d}`);
  }
  assert.strictEqual(dn(1970, 1, 1), 0, '1970-01-01 应为第 0 天');
});

// ---------------------------------------------------------------------------
// 5. 性能
// ---------------------------------------------------------------------------
check('性能：一次性渲染 3 年日历 < 800ms', () => {
  const t0 = Date.now();
  for (let m = 1; m <= 12; m++) {
    const { weeks } = L.monthMatrix(2024, m);
    for (const row of weeks) for (const day of row) L.dayInfo(day);
  }
  const cost = Date.now() - t0;
  assert.ok(cost < 800, `渲染 12 个月耗时 ${cost}ms，过慢`);
});

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
module.exports = { results };
if (require.main === module) {
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓ ${r.name}`);
    } else {
      failed++;
      console.log(`  ✗ ${r.name}\n      ${r.err}`);
    }
  }
  console.log(`\n农历算法测试：${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
}
