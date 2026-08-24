/**
 * Expand background holes that are enclosed by foreground by one pixel.
 * The outer silhouette is untouched because border-connected background is
 * explicitly excluded. This is generic mask topology processing; it has no
 * knowledge of filenames, object identity, image dimensions, or benchmark data.
 */
export function expandInternalBackground(mask, radius = 1) {
  if (radius <= 0) return mask;
  const { width, height, data } = mask;
  const outside = new Uint8Array(data.length);
  const queue = new Int32Array(data.length);
  let head = 0;
  let tail = 0;
  const enqueue = (index) => {
    if (data[index] || outside[index]) return;
    outside[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  let current = new Uint8Array(data);
  for (let pass = 0; pass < radius; pass += 1) {
    const next = new Uint8Array(current);
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] || outside[index]) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) next[ny * width + nx] = 0;
        }
      }
    }
    current = next;
  }
  return { width, height, data: current };
}

/** Fill one-pixel silhouette notches without changing broad outlines. */
export function closeMask(mask) {
  const { width, height, data } = mask;
  const dilated = new Uint8Array(data.length);
  const closed = new Uint8Array(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let foreground = 0;
      for (let dy = -1; dy <= 1 && !foreground; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && data[ny * width + nx]) {
            foreground = 1;
            break;
          }
        }
      }
      dilated[y * width + x] = foreground;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let foreground = 1;
      for (let dy = -1; dy <= 1 && foreground; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || !dilated[ny * width + nx]) {
            foreground = 0;
            break;
          }
        }
      }
      closed[y * width + x] = foreground;
    }
  }
  return { width, height, data: closed };
}
