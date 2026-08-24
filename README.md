# PHOTO→3D

一个免费、免账号、照片不上云的浏览器 3D 重建工具。用户围绕单件物品拍摄 12–24 张照片，网页在本机完成抠图、多视角轮廓雕刻、网格生成、照片颜色投射，并导出 GLB、OBJ、STL、PLY、3MF。

## 为什么能离线

- 几何路线是纯前端 visual hull，不调用云端 AI 3D 接口。
- RMBG-1.4 量化 ONNX 模型、transformers.js、ONNX Runtime WASM、three.js、marching cubes 与导出代码全部随站点提供。
- Service Worker 缓存页面、运行时和模型；首次完整加载后可断网重载。
- 用户照片只存在于当前浏览器内存，不上传、不建账号。

## 使用方法

1. 保持物体不动，围绕一圈拍 12–24 张；背景尽量干净，再补一张俯拍。
2. 把全部照片一次拖入页面。真实照片会由本地 RMBG 自动抠图。
3. 等待“抠图 → 轮廓雕刻 → 生成网格 → 投射颜色”完成。
4. 在 3D 预览中拖动旋转、滚轮或双指缩放，然后下载需要的格式。

本地运行：

```powershell
python -m http.server 8000
```

打开 `http://127.0.0.1:8000/`。Service Worker、WASM 和浏览器模块不能从 `file://` 正常工作，因此不要直接双击 HTML。

## 验证

生成固定基准数据：

```powershell
& 'D:\Program Files\Blender Foundation\Blender 5.1\blender.exe' -b --factory-startup --python tools/generate_reference.py
```

运行 128³ IoU 基准：

```powershell
node tools/bench.js
```

验证五种导出被 Blender 真导入：

```powershell
node tools/test-exports.js
```

运行桌面、390px、完整下载与断网自测：

```powershell
uv run --no-project --with playwright python tools/selftest.py
```

## 已知局限

visual hull 只知道每个视角的外轮廓。杯子内壁、把手内侧等凹陷区域没有足够的轮廓约束时，无法完整还原；这是方法本身的上限，不是上传更多服务器算力就能消除的 bug。透明、反光、毛发状物体以及拍摄时移动物体，也会显著降低结果质量。

真实照片没有标定文件时，网页按照片顺序估算环形相机位姿，并把最后一张视为较高仰角；请按环绕顺序选择文件。若需要计量级精度，应使用带标定的专业摄影测量流程。

## 仓库结构

- `src/core/visual-hull.js`：只接收轮廓掩码与相机数组的纯 JS 几何内核。
- `src/reconstruct-worker.js`：浏览器后台雕刻，避免阻塞界面。
- `src/core/mesh-export.js`：五种格式导出。
- `models/`、`vendor/`：同源离线模型与运行时。
- `tools/generate_reference.py`、`tools/score_iou.py`：已冻结的基准生成器和 128³ 评分器。
- `tools/selftest.py`、`test/cases/`：编号浏览器验收。

项目的未决项与逐轮证据分别见 `BLOCKED.md` 和 `PROGRESS.md`。
