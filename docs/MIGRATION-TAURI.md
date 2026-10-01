# 迁移到 Tauri —— 评估与工作清单

> **English TL;DR.** Tauri replaces Electron's bundled Chromium with the system WebView2, so the shipped app would drop from **62.5 MB (7z)** to roughly **6–9 MB**. The good news from the audit below: the 5,655-line renderer has **zero** Node/Electron coupling — it only talks to the backend through 31 IPC calls and a `citta-img://` URL scheme — and the 1,233-line lunar module is pure computation that can simply move into the renderer. The work is therefore concentrated in ~1,150 lines of main-process code (crypto, storage, IPC, window) that must be rewritten in Rust, plus rebuilding the test harness that drives the UI. Estimate: **12–18 person-days**, with a 1-day go/no-go spike on encryption compatibility first. Size alone does not justify it — a packaged Electron app already lands at ~55–62 MB — so treat this as a "do we want a genuinely small distributable and a proper `.exe` icon" decision.

本文是**评估**，不含代码改动。结论在最前面，后面是依据、逐项工作清单、验收标准与风险。

---

## 一、结论

| | 现在（Electron 33） | 迁移后（Tauri 2 + WebView2） |
| --- | --- | --- |
| 发布包体积 | **62.5 MB**（7z，LZMA2） | **约 6–9 MB** |
| 未压缩目录 | 224.7 MB | 约 10–14 MB |
| exe 图标 | Electron 的原子图标（窗口/任务栏是我们的 logo，但**文件图标**改不了） | 直接就是我们的 logo（Tauri 会打进 PE 资源） |
| 冷启动 | 约 1.5–2.5s | 约 0.4–1s（复用系统 WebView2） |
| 内存占用 | 约 120–160 MB | 约 60–90 MB |
| 运行时依赖 | 自带 Chromium（零依赖） | **依赖系统 WebView2**（Win11 自带；Win10 需已装 Edge，否则要下 bootstrapper） |
| 工具链 | Node + Electron（纯 JS） | Node + **Rust 工具链**（约 1.5 GB 安装） |

**建议**：

1. **如果 62.5 MB 可接受**（能发 GitHub Release、能邮件/网盘传）→ 先不迁。收益主要是"体积与图标好看"，而不是功能。
2. **如果必须做到 10 MB 以内**（例如要塞进某个仓库/安装介质/内网分发）→ 值得做，按下面清单推进，但**先花 1 天做第 0 阶段**：验证 Rust 能读懂现有加密数据。这一关过不去，后面的活都不用干。
3. 顺带能拿到的确定收益：exe 文件图标变成自己的 logo（Electron 下改不了）、启动更快、体积降到十分之一。这些是**可以对外说的理由**。

---

## 二、为什么现在是 62.5 MB，而 Tauri 能到 8 MB

Electron 的体积大头是它自带的 Chromium+Node 运行时，与应用代码无关（我们的代码只有 2.2 MB）：

| Electron 组成 | 大小 | Tauri 对应物 |
| --- | --- | --- |
| `观心 Citta.exe`（Chromium + V8 + Node 静态链接） | 180 MB | Rust 可执行文件，**约 3–5 MB** |
| `locales/`（已精简到中英） | 2 MB | 不需要（WebView2 自带） |
| `icudtl.dat` | 10 MB | 不需要 |
| `libGLESv2.dll` / `d3dcompiler_47.dll` / `ffmpeg.dll` | 20 MB | 不需要 |
| `LICENSES.chromium.html` | 8.7 MB | 不需要（改用 WebView2 的许可声明） |
| 应用代码 + 图标 + 数据 | 2.2 MB | 约 2–3 MB（logo.png 需要从 1254² 缩到 256²，省 1.4 MB） |

> 注意：**"压缩后 62.5 MB" 已经是 Electron 的现实下限**。换成 `electron-builder` 的 NSIS/portable 目标大概也是 55–60 MB，所以"再压一压"这条路已经走到头了。真正的数量级变化只有换外壳。

---

## 三、现状盘点（决定工作量的关键数据）

| 模块 | 规模 | 迁移方式 | 工作量 |
| --- | --- | --- | --- |
| **渲染层**（HTML/CSS/JS 11 个文件） | **5,655 行** | **几乎原样搬**：`require()` 0 处、`process.*` 0 处、`electron` 0 处，只通过 `window.citta`（34 个调用点）和 `citta-img://`（14 处引用）与后端来往 | 小 |
| `src/shared/lunar.js` | 1,233 行，零依赖纯计算 | **搬进渲染层当普通脚本**。它不碰密钥，放在前端完全安全，反而省掉 4 个 IPC 通道与一次序列化 | 小（改引入方式） |
| `src/main/crypto.js` | 181 行 | **必须用 Rust 重写**（scrypt + AES-256-GCM） | 中 |
| `src/main/storage.js` | 420 行 | **必须用 Rust 重写**（JSON 落盘、原子写、图片加密、备份导入导出） | 大 |
| `src/main/main.js` | 478 行 | **必须用 Rust 重写**（窗口、31 个 IPC 通道、对话框、单实例、图标、打开目录） | 大 |
| `src/main/preload.js` | 68 行 | 由 Tauri 的 `invoke` 桥接层取代 | 小 |
| `tests/lunar.test.js` `markdown.test.js` | 526 行 | **纯 Node，原样可用** | 零 |
| `tests/storage.test.js` | 197 行 | 需要一份 Rust 版（同样的用例，断言同一套磁盘格式） | 中 |
| `tests/e2e.js` `visual.test.js` | 1,966 行 / 62 条断言 | 驱动方式要重做：现在靠 Electron 的 `executeJavaScript`；Tauri 下改用 `tauri-driver`(WebDriver) 或 WebView2 的 CDP | **大（最大的隐性成本）** |

**一句话**：要写的新代码约 1,100–1,300 行 Rust（约合 600–900 行有效逻辑），要重建的测试脚手架比业务代码本身还费工。

---

## 四、逐项工作清单

### 阶段 0：可行性验证（1 天，**做完再决定是否继续**）

| # | 任务 | 产出 | 验收 |
| --- | --- | --- | --- |
| 0.1 | 装 Rust 工具链，建一个最小 Tauri 2 工程，能开窗 | 空壳能启动 | 窗口出现、能显示"hello" |
| 0.2 | 用现有 Node 实现生成一份**测试密钥库**（已知密码 + 已知密保答案 + 3 篇加密日记） | `tests/fixtures/vault.json`、`entries.json` | 固定 fixture 入库 |
| 0.3 | 用 Rust（`scrypt` + `aes-gcm` crate）**解锁这份 fixture**、读出一篇日记明文 | 一个 Rust 集成测试 | 明文字节与 Node 侧完全一致 |
| 0.4 | Rust 侧写回一篇日记，再用 Node 侧解回来 | 反向验证 | 双向可读 |
| 0.5 | 量一次真实体积：空壳 + 我们的资源，7z 压缩后多大 | 数字 | ≤ 10 MB |

> **Go/No-Go 门槛**：0.3–0.4 必须字节级通过。AES-256-GCM 与 scrypt 在两边只要参数一致就能互通（我们的参数是 scrypt N=16384/r=8/p=1、AES-256-GCM 12 字节 IV、16 字节 tag），但**必须实测**，不能推断。若这关不过，立即停止并保留 Electron。

### 阶段 1：后端骨架（3–5 天）

| # | 任务 | 说明 |
| --- | --- | --- |
| 1.1 | 数据目录**保持原路径** | 现有数据在 `%APPDATA%\观心 Citta`；Rust 里显式用它，不要用 Tauri 默认的 identifier 目录，否则老用户（含你自己的 5 篇）会"丢档" |
| 1.2 | 移植 `crypto.js` | scrypt 派生、主密钥双包裹（密码 + 3 个密保答案）、AES-256-GCM 加解密、随机 IV |
| 1.3 | 移植 `storage.js` | 内存缓存 + 400ms 防抖写盘 + `.tmp` 后 rename 原子替换；单条密文损坏不影响其他条目 |
| 1.4 | 图片存储 | 图片 id 用 32 位十六进制；`gcImages` 垃圾回收 |
| 1.5 | 备份导出/导入 | 覆盖导入与合并导入，格式与现版本 JSON 完全一致（保持向后兼容） |
| 1.6 | 单实例锁 | `tauri-plugin-single-instance`，第二个实例把已有窗口拉到前台 |
| 1.7 | IPC 桥 | 31 个通道逐个映射为 `#[tauri::command]`，并在前端提供同名 `window.citta` 适配层（**渲染层代码不用改**） |
| 1.8 | `citta-img://` 协议 | `register_uri_scheme_protocol`，解密后按 image/png 返回；CSP 里同步白名单 |
| 1.9 | 文件对话框 | 备份导出/导入用 `tauri-plugin-dialog`；"打开数据目录"用 `tauri-plugin-opener` |

### 阶段 2：渲染层适配（2–3 天）

| # | 任务 | 说明 |
| --- | --- | --- |
| 2.1 | 把 `lunar.js` + `lunar-table.json` 移进渲染层 | 删除 `calendar:month/day/today/yearName` 四个 IPC，改为本地调用；日历渲染逻辑不动 |
| 2.2 | 实现 `window.citta` 适配层 | 34 个调用点，签名保持一致，内部转 `invoke()` |
| 2.3 | CSP 调整 | `tauri://localhost` / `http://tauri.localhost`、`data:`、自定义协议 |
| 2.4 | 主题与标题栏 | 现用 `nativeTheme`；Tauri 下用 `window.set_theme` + `data-theme`，深浅色行为要重新验一遍 |
| 2.5 | 字体与排版复核 | WebView2 与 Electron 的字体回退不同，宋体/思源宋体的 fallback 链要实测（我们有逐屏视觉基线，正好用来比对） |
| 2.6 | 图标加载 | 现在主进程用 `nativeImage` 缩放到 200px 再传；Rust 侧用 `image` crate 做同样的事，或直接在构建期生成 256² 版本 |
| 2.7 | 语言（i18n）与 localStorage | localStorage 在 WebView2 下可用，路径与行为需实测一次 |

### 阶段 3：测试脚手架（2–3 天，**不可省**）

| # | 任务 | 说明 |
| --- | --- | --- |
| 3.1 | `lunar.test.js` / `markdown.test.js` | 原样跑（纯 Node），作为"搬家没搬坏"的第一道防线 |
| 3.2 | Rust 版存储/加密测试 | 直接以阶段 0 的 fixture 为基准，覆盖：错误密码、密保找回、改密码后旧密码失效、磁盘无明文、损坏条目隔离、图片 GC、导入导出 |
| 3.3 | 端到端驱动 | 两条路：**(a)** `tauri-driver` + WebdriverIO；**(b)** 让 WebView2 开 CDP 端口，把现有 62 条断言里的 `executeJavaScript` 换成 `Runtime.evaluate`。**(b) 改动最小**，建议优先 |
| 3.4 | 视觉回归 | 现有 962 行视觉测试（几何 + WCAG 对比度 + 深浅两套主题）保留，作为"WebView2 没把版式搞坏"的证据 |
| 3.5 | 检查清单落文件 | 把阶段 0–3 的验收标准写进 CI 脚本（`npm run check`），避免"迁完才发现少了半条流程" |

### 阶段 4：打包与发布（1–2 天）

| # | 任务 | 说明 |
| --- | --- | --- |
| 4.1 | `tauri.conf.json` 的 `bundle.icon` | 打进 PE 资源 → 文件图标即 logo（**这是当前 Electron 方案做不到的**） |
| 4.2 | 产物形态 | 免安装单 exe（`tauri build` 的 portable 目标）+ 可选 NSIS 安装包；两者都远小于 62 MB |
| 4.3 | WebView2 缺失时的提示 | 检测 runtime，给出下载指引（或用 fixed-version 模式，体积 +约 120 MB——一般来说不选） |
| 4.4 | 文档与 README | 更新"打包为免安装应用 / Build the portable app"两节，替换体积数字与构建命令 |
| 4.5 | 双轨过渡 | 保留 `tools/build-portable.js`（Electron 版）一个版本周期，万一 Tauri 版出问题可以退回 |

---

## 五、验收标准（Definition of Done）

迁移完成 = 以下全部为"是"：

1. 用**现有** `%APPDATA%\观心 Citta` 数据直接启动，能解锁、能看到已有日记、能正常编辑保存（**老数据零迁移**）。
2. 阶段 0 的双向加解密字节级测试通过，且写在新磁盘上的格式与旧版一致（旧版 Electron 包能读新写入的日记）。
3. `lunar.test.js`、`markdown.test.js` 全绿；Rust 版存储/加密测试全绿；e2e 62 条断言全绿；视觉测试在浅色/深色下全绿。
4. 7z 发布包 ≤ 10 MB，双击 exe 即可运行，不需要安装程序。
5. exe 文件图标、窗口图标、任务栏图标**都是** logo。
6. 深色模式、导出/导入、图片放大、全文搜索、快捷键逐项手测一遍通过。

---

## 六、风险清单

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| **加密实现细节不一致** | 老数据读不出来（最坏情况：用户丢档） | 阶段 0 必须先过；fixture 双向测试纳入 CI；迁移前要求用户先导出备份 |
| **测试脚手架重建成本被低估** | 迁完失去 62 条端到端与视觉回归的保护，后续改动风险陡增 | 阶段 3 与阶段 1/2 并行推进；宁可多花一天，也别裸奔上线 |
| **WebView2 依赖** | 离线/内网机器没装 WebView2 就起不来 | 启动时检测并给指引；文档里写明系统要求（Win10 1803+ 且装过 Edge / Win11 自带） |
| **WebView2 版本随 Edge 更新** | 某天 Edge 升级导致版式或 API 行为变化 | 现有视觉测试就是防这个的；CSS 用得保守（变量、grid、inset），风险可控但非零 |
| **字体回退差异** | 中文衬线在不同环境里观感变化 | 视觉测试量的是字号/行高/对比度，再加一次人工目视 |
| **Rust 学习与工具链** | 首次配置 1–2 小时 + 团队上手成本 | 只用到 `scrypt` / `aes-gcm` / `serde_json` / `image` 四个 crate，逻辑量不大 |
| **两套代码并存期的维护成本** | 修一个 bug 要改两次 | 过渡期只保留一个版本周期，然后**明确废弃** Electron 版 |

---

## 七、明确的取舍：不做什么

- **不把农历算法移植到 Rust**：1,233 行、零依赖、无密钥，放渲染层最省事，性能也够（现在 3 年日历渲染 < 800ms）。
- **不做 macOS / Linux 版本**：Tauri 在 Linux 用 WebKitGTK、macOS 用 WKWebView，与 Windows 的 WebView2 渲染差异会让我们这套视觉规范需要三份基线。观心目前定位 Windows 单平台。
- **不为省体积引入固定版本 WebView2**（+120 MB），那等于把省下的体积又还回去。
- **不重写 UI**：渲染层 5,655 行原样搬，这正是 Tauri 方案成本可控的原因。

---

## 八、如果你决定做，我建议的推进顺序

```
第 1 天        阶段 0（0.1–0.5）→ 拿体积数字与加密兼容结论 → 决策
第 2–6 天      阶段 1.2–1.5（crypto + storage + 图片 + 备份）＋ Rust 单测
第 5–8 天      阶段 1.1、1.6–1.9（数据路径、单实例、IPC 桥、协议、对话框）
第 8–11 天     阶段 2（渲染层适配、lunar 内迁、CSP、主题、字体）
第 9–13 天     阶段 3（CDP 驱动端到端 + 视觉回归 + 存储测试对齐）
第 13–15 天    阶段 4（图标、打包、文档、双轨过渡）
```

**并行之后大约 3 周（12–18 人日）**。若只有一个人、每天只能投半天，按 5–6 周算。

---

## 九、一页纸决策

- **要"能发出去、体积好看、图标是自己的"** → 做，先跑阶段 0。
- **只是觉得 62.5 MB 有点大** → 不做。GitHub Release 上传 62.5 MB 完全正常，用户的下载体验差别只在一次下载时间。
- **无论做不做**，都建议现在先做两件小事：① 用「导出备份」留一份加密外的归档；② 把 `%-APPDATA%\观心 Citta` 备份一份到别处。迁移与否，这都是零风险的保险。
