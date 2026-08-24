import { reconstructFromMasks } from "./core/visual-hull.js";

self.addEventListener("message", (event) => {
  try {
    const mesh = reconstructFromMasks({
      ...event.data,
      onProgress(progress) {
        self.postMessage({ type: "progress", progress });
      },
    });
    self.postMessage({ type: "result", mesh });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: {
        message: error?.message || String(error),
        stack: error?.stack || "",
      },
    });
  }
});

