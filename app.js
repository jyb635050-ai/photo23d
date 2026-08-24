import * as THREE from "./vendor/three.module.js";
import { exportAllFormats } from "./src/core/mesh-export.js";
import { expandInternalBackground } from "./src/core/mask-postprocess.js";

const MODEL_ID = "briaai/RMBG-1.4";
const MODEL_URL = "./models/briaai/RMBG-1.4/onnx/model_quantized.onnx";
const NORMALIZED_SIZE = 256;
const SYNTHETIC_THRESHOLD = 185;

const dom = {
  input: document.querySelector("#photos"),
  dropzone: document.querySelector("#dropzone"),
  assetStatus: document.querySelector("#asset-status"),
  photoCount: document.querySelector("#photo-count"),
  photoStrip: document.querySelector("#photo-strip"),
  stages: [...document.querySelectorAll("#stages li")],
  progressBar: document.querySelector("#progress-bar"),
  progressText: document.querySelector("#progress-text"),
  statusText: document.querySelector("#status-text"),
  exportButtons: [...document.querySelectorAll("[data-export]")],
  canvas: document.querySelector("#preview"),
  viewport: document.querySelector("#viewport"),
  emptyPreview: document.querySelector("#empty-preview"),
  toast: document.querySelector("#toast"),
};

const state = {
  status: "idle",
  assetCheck: "pending",
  error: null,
  mesh: null,
  exportCache: null,
  lastExport: null,
  modelPromise: null,
  worker: null,
  thumbnailUrls: [],
  previewFaces: 0,
};
window.__photo23dState = state;

function showToast(message, error = false) {
  dom.toast.textContent = message;
  dom.toast.classList.toggle("error", error);
  dom.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => dom.toast.classList.remove("show"), 3600);
}

function showError(message, detail = "") {
  state.status = "error";
  state.error = detail ? `${message} ${detail}` : message;
  dom.assetStatus.className = "asset-status error";
  dom.assetStatus.textContent = state.error;
  dom.dropzone.classList.remove("busy");
  setProgress("cutout", 0, "无法开始");
  showToast(state.error, true);
}

function setProgress(stage, percent, text) {
  const order = ["cutout", "carve", "mesh", "color"];
  const activeIndex = order.indexOf(stage);
  dom.stages.forEach((item, index) => {
    item.classList.toggle("done", percent >= 100 || index < activeIndex);
    item.classList.toggle("active", percent < 100 && index === activeIndex);
  });
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  dom.progressBar.style.width = `${safePercent}%`;
  dom.progressText.textContent = `${safePercent}%`;
  dom.statusText.textContent = text;
}

async function registerOffline() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  } catch (error) {
    console.warn("离线缓存注册失败", error);
  }
}

async function verifyModelAsset() {
  try {
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const modelBytes = await response.arrayBuffer();
    if (modelBytes.byteLength < 40 * 1024 * 1024) throw new Error("模型文件长度异常");
    state.assetCheck = "ok";
    dom.assetStatus.className = "asset-status ok";
    dom.assetStatus.textContent = "离线模型已就绪 · 照片不会离开此设备";
  } catch (error) {
    state.assetCheck = "error";
    showError(
      "AI 抠图模型文件没找到。",
      "请检查 models/briaai/RMBG-1.4/onnx/model_quantized.onnx 是否完整。",
    );
    throw error;
  }
}

const assetReady = Promise.all([registerOffline(), verifyModelAsset()]);

async function loadModel() {
  if (state.modelPromise) return state.modelPromise;
  state.modelPromise = (async () => {
    await assetReady;
    setProgress("cutout", 2, "正在载入本地抠图模型");
    const lib = await import("./vendor/transformers.min.js");
    const { env, AutoModel, AutoProcessor } = lib;
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = new URL("./models/", location.href).href;
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = new URL("./vendor/", location.href).href;
      env.backends.onnx.wasm.numThreads = 1;
    }
    const model = await AutoModel.from_pretrained(MODEL_ID, {
      config: { model_type: "custom" },
      dtype: "q8",
      device: "wasm",
      progress_callback(progress) {
        if (progress.status === "progress" && progress.total) {
          setProgress("cutout", Math.min(18, (progress.loaded / progress.total) * 18), "正在载入本地抠图模型");
        }
      },
    });
    const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
      config: {
        do_normalize: true,
        do_pad: false,
        do_rescale: true,
        do_resize: true,
        image_mean: [0.5, 0.5, 0.5],
        image_std: [1, 1, 1],
        feature_extractor_type: "ImageFeatureExtractor",
        resample: 2,
        rescale_factor: 0.00392156862745098,
        size: { width: 1024, height: 1024 },
      },
    });
    return { model, processor, RawImage: lib.RawImage };
  })().catch((error) => {
    state.modelPromise = null;
    throw error;
  });
  return state.modelPromise;
}

function imageDataFromCanvas(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(data.data) };
}

function findMaskBounds(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] < 32) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error("这张照片没有识别出前景物体");
  return { minX, minY, maxX, maxY };
}

function normalizeObservation(sourceCanvas, maskBytes) {
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;
  const bounds = findMaskBounds(maskBytes, sourceWidth, sourceHeight);
  const objectWidth = bounds.maxX - bounds.minX + 1;
  const objectHeight = bounds.maxY - bounds.minY + 1;
  const scale = 188 / Math.max(objectWidth, objectHeight);
  const destinationWidth = objectWidth * scale;
  const destinationHeight = objectHeight * scale;
  const destinationX = (NORMALIZED_SIZE - destinationWidth) / 2;
  const destinationY = (NORMALIZED_SIZE - destinationHeight) / 2;

  const output = document.createElement("canvas");
  output.width = NORMALIZED_SIZE;
  output.height = NORMALIZED_SIZE;
  const outputContext = output.getContext("2d", { willReadFrequently: true });
  outputContext.drawImage(
    sourceCanvas,
    bounds.minX,
    bounds.minY,
    objectWidth,
    objectHeight,
    destinationX,
    destinationY,
    destinationWidth,
    destinationHeight,
  );

  const maskSource = document.createElement("canvas");
  maskSource.width = sourceWidth;
  maskSource.height = sourceHeight;
  const maskContext = maskSource.getContext("2d", { willReadFrequently: true });
  const rgba = maskContext.createImageData(sourceWidth, sourceHeight);
  for (let index = 0; index < maskBytes.length; index += 1) {
    const offset = index * 4;
    rgba.data[offset] = 255;
    rgba.data[offset + 1] = 255;
    rgba.data[offset + 2] = 255;
    rgba.data[offset + 3] = maskBytes[index];
  }
  maskContext.putImageData(rgba, 0, 0);
  const normalizedMaskCanvas = document.createElement("canvas");
  normalizedMaskCanvas.width = NORMALIZED_SIZE;
  normalizedMaskCanvas.height = NORMALIZED_SIZE;
  const normalizedMaskContext = normalizedMaskCanvas.getContext("2d", { willReadFrequently: true });
  normalizedMaskContext.drawImage(
    maskSource,
    bounds.minX,
    bounds.minY,
    objectWidth,
    objectHeight,
    destinationX,
    destinationY,
    destinationWidth,
    destinationHeight,
  );
  const normalizedRgba = normalizedMaskContext.getImageData(0, 0, NORMALIZED_SIZE, NORMALIZED_SIZE).data;
  const mask = new Uint8Array(NORMALIZED_SIZE * NORMALIZED_SIZE);
  for (let index = 0; index < mask.length; index += 1) mask[index] = normalizedRgba[index * 4 + 3] >= 96 ? 1 : 0;
  return {
    canvas: output,
    image: imageDataFromCanvas(output),
    mask: { width: NORMALIZED_SIZE, height: NORMALIZED_SIZE, data: mask },
  };
}

async function segmentFile(file, completed, total) {
  const { model, processor, RawImage } = await loadModel();
  const objectUrl = URL.createObjectURL(file);
  try {
    setProgress("cutout", 18 + (completed / total) * 22, `正在抠图 ${completed + 1}/${total}`);
    const rawImage = await RawImage.fromURL(objectUrl);
    const { pixel_values } = await processor(rawImage);
    const { output } = await model({ input: pixel_values });
    const mask = await RawImage.fromTensor(output[0].mul(255).to("uint8")).resize(rawImage.width, rawImage.height);
    return normalizeObservation(rawImage.toCanvas(), mask.data);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function normalizeVector(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function worldToCamera(location) {
  const forward = normalizeVector(location.map((value) => -value));
  const right = normalizeVector(cross(forward, [0, 0, 1]));
  const up = cross(right, forward);
  return [
    [...right, -dot(right, location)],
    [...up, -dot(up, location)],
    [-forward[0], -forward[1], -forward[2], dot(forward, location)],
    [0, 0, 0, 1],
  ];
}

function estimatedCamera(count) {
  const fov = (42 * Math.PI) / 180;
  const focal = NORMALIZED_SIZE / (2 * Math.tan(fov / 2));
  const views = Array.from({ length: count }, (_, index) => {
    const azimuth = (index / count) * Math.PI * 2;
    const elevation = index === count - 1 ? (55 * Math.PI) / 180 : (20 * Math.PI) / 180;
    const radius = 3.55;
    const location = [
      radius * Math.cos(elevation) * Math.cos(azimuth),
      radius * Math.cos(elevation) * Math.sin(azimuth),
      radius * Math.sin(elevation),
    ];
    return { world_to_camera: worldToCamera(location), azimuth_deg: (index / count) * 360, elevation_deg: (elevation * 180) / Math.PI };
  });
  return {
    schema: "photo23d-estimated-camera-v1",
    resolution: { width: NORMALIZED_SIZE, height: NORMALIZED_SIZE },
    intrinsics: { fx: focal, fy: focal, cx: NORMALIZED_SIZE / 2, cy: NORMALIZED_SIZE / 2 },
    voxel_bounds: [[-1.5, -1.5, -1.5], [1.5, 1.5, 1.5]],
    views,
  };
}

function clearThumbnails() {
  state.thumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
  state.thumbnailUrls = [];
  dom.photoStrip.replaceChildren();
}

function showThumbnails(sources) {
  clearThumbnails();
  for (const source of sources) {
    const image = document.createElement("img");
    image.alt = "环拍照片缩略图";
    image.src = source;
    dom.photoStrip.append(image);
  }
  dom.photoCount.textContent = `已添加 ${sources.length} 张照片`;
}

function reconstruct(observations, camera) {
  return new Promise((resolve, reject) => {
    state.worker?.terminate();
    const worker = new Worker("./src/reconstruct-worker.js", { type: "module" });
    state.worker = worker;
    worker.addEventListener("message", (event) => {
      if (event.data.type === "progress") {
        const progress = event.data.progress;
        if (progress.stage === "carve") {
          const percent = 40 + (progress.completed / progress.total) * 43;
          setProgress("carve", percent, `正在雕刻 ${progress.completed}/${progress.total}`);
        } else {
          setProgress("mesh", 88, "正在生成网格");
        }
      } else if (event.data.type === "result") {
        worker.terminate();
        resolve(event.data.mesh);
      } else if (event.data.type === "error") {
        worker.terminate();
        reject(new Error(event.data.error.message));
      }
    });
    worker.addEventListener("error", (event) => reject(new Error(event.message)));
    worker.postMessage({
      masks: observations.map((item) => item.mask),
      images: observations.map((item) => item.image),
      camera,
      gridSize: 128,
    });
  });
}

async function finishReconstruction(observations, camera) {
  state.status = "processing";
  state.error = null;
  state.mesh = null;
  state.exportCache = null;
  dom.exportButtons.forEach((button) => { button.disabled = true; });
  dom.dropzone.classList.add("busy");
  try {
    const mesh = await reconstruct(observations, camera);
    setProgress("color", 96, "正在投射照片颜色");
    state.mesh = mesh;
    state.previewFaces = mesh.cells.length;
    updatePreview(mesh);
    setProgress("color", 100, "模型已生成");
    dom.exportButtons.forEach((button) => { button.disabled = false; });
    state.status = "ready";
    dom.emptyPreview.hidden = true;
    showToast(`已生成 ${mesh.cells.length.toLocaleString()} 个三角面`);
    return mesh;
  } catch (error) {
    showError("3D 重建失败。", error.message);
    throw error;
  } finally {
    dom.dropzone.classList.remove("busy");
  }
}

async function handleFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (files.length < 12 || files.length > 24) {
    showError("照片数量不合适。", "请一次选择 12–24 张环拍照片。");
    return;
  }
  if (state.assetCheck !== "ok") {
    showError("离线模型尚未就绪。", "请等待资源检查完成后重试。");
    return;
  }
  const urls = files.map((file) => URL.createObjectURL(file));
  state.thumbnailUrls = urls;
  dom.photoStrip.replaceChildren();
  urls.forEach((url) => {
    const image = document.createElement("img");
    image.src = url;
    image.alt = "已选环拍照片";
    dom.photoStrip.append(image);
  });
  dom.photoCount.textContent = `已添加 ${files.length} 张照片`;
  state.status = "segmenting";
  try {
    const observations = [];
    for (let index = 0; index < files.length; index += 1) {
      observations.push(await segmentFile(files[index], index, files.length));
    }
    await finishReconstruction(observations, estimatedCamera(files.length));
  } catch (error) {
    showError(
      "自动抠图失败。",
      error.message.includes("not found locally") ? "本地模型文件不完整。" : "请刷新页面后重试。",
    );
  }
}

dom.input.addEventListener("change", () => handleFiles(dom.input.files));
for (const eventName of ["dragenter", "dragover"]) {
  dom.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dom.dropzone.classList.add("dragover");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dom.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dom.dropzone.classList.remove("dragover");
  });
}
dom.dropzone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));

function download(extension) {
  if (!state.mesh) return;
  state.exportCache ??= exportAllFormats(state.mesh);
  const mime = {
    glb: "model/gltf-binary",
    obj: "text/plain",
    stl: "model/stl",
    ply: "application/octet-stream",
    "3mf": "model/3mf",
  }[extension];
  const blob = new Blob([state.exportCache[extension]], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `photo23d-model.${extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  state.lastExport = extension;
  showToast(`${extension.toUpperCase()} 已生成并开始下载`);
}
dom.exportButtons.forEach((button) => button.addEventListener("click", () => download(button.dataset.export)));

let renderer;
let scene;
let previewCamera;
let previewMesh;
let orbit = { yaw: -0.7, pitch: 0.35, distance: 6.4, dragging: false, x: 0, y: 0 };

function updateCamera() {
  previewCamera.position.set(
    orbit.distance * Math.cos(orbit.pitch) * Math.cos(orbit.yaw),
    orbit.distance * Math.cos(orbit.pitch) * Math.sin(orbit.yaw),
    orbit.distance * Math.sin(orbit.pitch),
  );
  previewCamera.lookAt(0, 0, 0);
}

function initPreview() {
  renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x060b10, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x060b10, 0.07);
  previewCamera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
  previewCamera.up.set(0, 0, 1);
  updateCamera();
  scene.add(new THREE.HemisphereLight(0xdffcff, 0x101018, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(4, -4, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff168d, 1.4);
  rim.position.set(-5, 2, 1);
  scene.add(rim);
  const grid = new THREE.GridHelper(8, 16, 0x11e4f2, 0x152a35);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -1.55;
  grid.material.transparent = true;
  grid.material.opacity = 0.46;
  scene.add(grid);

  const resize = () => {
    const width = Math.max(1, dom.viewport.clientWidth);
    const height = Math.max(1, dom.viewport.clientHeight);
    renderer.setSize(width, height, false);
    previewCamera.aspect = width / height;
    previewCamera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(dom.viewport);
  resize();
  const draw = () => {
    renderer.render(scene, previewCamera);
    requestAnimationFrame(draw);
  };
  draw();
}

function updatePreview(mesh) {
  if (previewMesh) {
    scene.remove(previewMesh);
    previewMesh.geometry.dispose();
    previewMesh.material.dispose();
  }
  const positions = new Float32Array(mesh.positions.length * 3);
  const colors = new Float32Array(mesh.positions.length * 3);
  mesh.positions.forEach((position, index) => positions.set(position, index * 3));
  mesh.colors.forEach((color, index) => colors.set(color, index * 3));
  const indices = new Uint32Array(mesh.cells.length * 3);
  mesh.cells.forEach((cell, index) => indices.set(cell, index * 3));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.76,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  previewMesh = new THREE.Mesh(geometry, material);
  scene.add(previewMesh);
  const radius = geometry.boundingSphere?.radius || 2;
  orbit.distance = Math.max(4.2, radius * 3.2);
  updateCamera();
}

dom.canvas.addEventListener("pointerdown", (event) => {
  orbit.dragging = true;
  orbit.x = event.clientX;
  orbit.y = event.clientY;
  dom.canvas.setPointerCapture(event.pointerId);
});
dom.canvas.addEventListener("pointermove", (event) => {
  if (!orbit.dragging) return;
  orbit.yaw -= (event.clientX - orbit.x) * 0.009;
  orbit.pitch = Math.max(-1.2, Math.min(1.2, orbit.pitch + (event.clientY - orbit.y) * 0.009));
  orbit.x = event.clientX;
  orbit.y = event.clientY;
  updateCamera();
});
dom.canvas.addEventListener("pointerup", () => { orbit.dragging = false; });
dom.canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  orbit.distance = Math.max(2.2, Math.min(16, orbit.distance * Math.exp(event.deltaY * 0.001)));
  updateCamera();
}, { passive: false });

function loadHtmlImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`无法读取 ${url}`));
    image.src = url;
  });
}

function thresholdSynthetic(imageData) {
  const mask = new Uint8Array(imageData.width * imageData.height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    mask[index] = Math.min(imageData.data[offset], imageData.data[offset + 1], imageData.data[offset + 2]) < SYNTHETIC_THRESHOLD ? 1 : 0;
  }
  return { width: imageData.width, height: imageData.height, data: mask };
}

async function loadSyntheticFixture(name = "beveled_cube") {
  await assetReady;
  const base = `./test/fixtures/${name}/`;
  const camera = await fetch(`${base}cameras.json`).then((response) => {
    if (!response.ok) throw new Error(`fixture camera HTTP ${response.status}`);
    return response.json();
  });
  const observations = [];
  const thumbnails = [];
  for (let index = 0; index < camera.views.length; index += 1) {
    const url = `${base}${camera.views[index].image}`;
    const htmlImage = await loadHtmlImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = htmlImage.naturalWidth;
    canvas.height = htmlImage.naturalHeight;
    canvas.getContext("2d").drawImage(htmlImage, 0, 0);
    const image = imageDataFromCanvas(canvas);
    observations.push({ image, mask: thresholdSynthetic(image) });
    thumbnails.push(url);
    setProgress("cutout", ((index + 1) / camera.views.length) * 38, `正在读取轮廓 ${index + 1}/${camera.views.length}`);
  }
  showThumbnails(thumbnails);
  return finishReconstruction(observations, camera);
}

window.__photo23dTest = { loadSyntheticFixture, download };

try {
  initPreview();
} catch (error) {
  showError("3D 预览初始化失败。", error.message);
}
