# BLOCKED

## 2026-08-23 · 任务 2 马克杯 IoU 未越过硬阈值

- 当前最佳实测：倒角立方体 `0.88 PASS`、圆柱 `0.92 PASS`、Suzanne `0.92 PASS`、马克杯精确 `0.496642 FAIL`（两位小数显示为 `0.50`，但未达到精确阈值 `0.50`）。
- 原因证据：同一 128³ 网格中马克杯只有 936 个假阴性、98,349 个假阳性；主要假阳性位于杯腔和把手内侧，是 visual hull 无法由外轮廓排除的凹陷体积。
- 已试并回滚：多组亮度/色度阈值、投影足迹、孔洞扩张、统一尺度、5×5 闭运算；均未超过当前 3×3 闭运算结果。按任务路线限制，不改真值、冻结脚本或阈值，也不换在线 AI；任务 2 与总完成条件如实保持未达标。

## 2026-08-23 · 已冻结基准背景不是字节级纯白（继续不受影响部分）

- 证据：Windows 原生 PNG 解码抽查角像素为 `RGB=231,231,231`；生成器把 World strength 固定为 0.8。
- 约束冲突：任务 1 要求纯白背景，但脚本 SHA-256 已写入 `PROGRESS.md` 后又规定不许再改。
- 处理：不回改冻结脚本；合成轮廓前端使用固定 `min(R,G,B) < 225` 阈值，内核仍只收掩码。此项留待领导裁决。
## 2026-08-23 · 任务 0 路径描述偏差（不阻塞任务 1–3）

- 证据：`D:\blender\cutout\package.json` 与 `D:\blender\cutout\node_modules\@huggingface\transformers\package.json` 均不存在，无法按本地 npm 包核验 `@huggingface/transformers` 3.7.6。
- 实际：`D:\blender\cutout\app.js:4` 把版本写死为 `https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6`，模型文件本地加载；这与任务 4 的“运行时不依赖 CDN”冲突。
- 处理：任务 1–3 不受影响继续；任务 4 必须把 transformers.js/ONNX Runtime 依赖下载进本仓库后再接 RMBG，不能直接照搬该 CDN import。

