@echo off
rem ============================================================
rem  观心 Citta —— 生成 README 截图
rem
rem  重要：必须先清掉 ELECTRON_RUN_AS_NODE。
rem  如果这个环境变量存在，Electron 会退化成纯 Node 运行，
rem  脚本里的 require('electron').app 就是 undefined，
rem  报错长这样：
rem      TypeError: Cannot read properties of undefined (reading 'setPath')
rem  项目自带的 electron 测试（storage/visual/e2e/fidelity）
rem  失败也是同一个原因。
rem
rem  加 --reset 可清掉演示数据重新生成：
rem      tools\make-screenshots.cmd --reset
rem ============================================================

setlocal
chcp 65001 > nul
cd /d "%~dp0.."

set "ELECTRON=node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
    echo [错误] 未找到 Electron，请先运行：
    echo        npm install
    exit /b 1
)

set "CITTA_TEST=1"
set "ELECTRON_RUN_AS_NODE="

"%ELECTRON%" "tools\make-screenshots.js" %*

echo.
pause
