import { strToU8, zipSync } from "../../vendor/fflate.mjs";

const encoder = new TextEncoder();

function colorBytes(mesh, index) {
  const color = mesh.colors?.[index] ?? [0.08, 0.86, 0.94];
  return color.map((value) => Math.max(0, Math.min(255, Math.round(value * 255))));
}

function triangleNormal(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...normal) || 1;
  return normal.map((value) => value / length);
}

export function exportObj(mesh) {
  const lines = ["# Photo23D OBJ", "# unit: arbitrary", "o photo23d_model"];
  mesh.positions.forEach(([x, y, z], index) => {
    const [r, g, b] = mesh.colors?.[index] ?? [0.08, 0.86, 0.94];
    lines.push(`v ${x} ${y} ${z} ${r} ${g} ${b}`);
  });
  mesh.cells.forEach(([a, b, c]) => lines.push(`f ${a + 1} ${b + 1} ${c + 1}`));
  return encoder.encode(`${lines.join("\n")}\n`);
}

export function exportPly(mesh) {
  const header = [
    "ply",
    "format ascii 1.0",
    "comment Photo23D visual hull",
    `element vertex ${mesh.positions.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    `element face ${mesh.cells.length}`,
    "property list uchar uint vertex_indices",
    "end_header",
  ];
  const vertices = mesh.positions.map(([x, y, z], index) => {
    const [r, g, b] = colorBytes(mesh, index);
    return `${x} ${y} ${z} ${r} ${g} ${b}`;
  });
  const faces = mesh.cells.map(([a, b, c]) => `3 ${a} ${b} ${c}`);
  return encoder.encode(`${header.concat(vertices, faces).join("\n")}\n`);
}

export function exportBinaryStl(mesh) {
  const output = new ArrayBuffer(84 + mesh.cells.length * 50);
  const bytes = new Uint8Array(output);
  bytes.set(encoder.encode("Photo23D binary STL").subarray(0, 80));
  const view = new DataView(output);
  view.setUint32(80, mesh.cells.length, true);
  let offset = 84;
  for (const cell of mesh.cells) {
    const vertices = cell.map((index) => mesh.positions[index]);
    const normal = triangleNormal(vertices[0], vertices[1], vertices[2]);
    for (const value of normal) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    for (const vertex of vertices) {
      for (const value of vertex) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return new Uint8Array(output);
}

function align4(value) {
  return (value + 3) & ~3;
}

export function exportGlb(mesh) {
  const positionBytes = mesh.positions.length * 3 * 4;
  const colorBytesLength = mesh.positions.length * 3 * 4;
  const indexBytes = mesh.cells.length * 3 * 4;
  const positionOffset = 0;
  const colorOffset = align4(positionOffset + positionBytes);
  const indexOffset = align4(colorOffset + colorBytesLength);
  const binaryLength = align4(indexOffset + indexBytes);
  const binary = new Uint8Array(binaryLength);
  const binaryView = new DataView(binary.buffer);
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  mesh.positions.forEach((position, index) => {
    position.forEach((value, axis) => {
      binaryView.setFloat32(positionOffset + (index * 3 + axis) * 4, value, true);
      minimum[axis] = Math.min(minimum[axis], value);
      maximum[axis] = Math.max(maximum[axis], value);
    });
    const color = mesh.colors?.[index] ?? [0.08, 0.86, 0.94];
    color.forEach((value, axis) => {
      binaryView.setFloat32(colorOffset + (index * 3 + axis) * 4, value, true);
    });
  });
  mesh.cells.forEach((cell, faceIndex) => {
    cell.forEach((value, axis) => {
      binaryView.setUint32(indexOffset + (faceIndex * 3 + axis) * 4, value, true);
    });
  });

  const gltf = {
    asset: { version: "2.0", generator: "Photo23D" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "Photo23D model" }],
    meshes: [
      {
        name: "Photo23D visual hull",
        primitives: [
          {
            attributes: { POSITION: 0, COLOR_0: 1 },
            indices: 2,
            mode: 4,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: "Photo colors",
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: binaryLength }],
    bufferViews: [
      { buffer: 0, byteOffset: positionOffset, byteLength: positionBytes, target: 34962 },
      { buffer: 0, byteOffset: colorOffset, byteLength: colorBytesLength, target: 34962 },
      { buffer: 0, byteOffset: indexOffset, byteLength: indexBytes, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: mesh.positions.length,
        type: "VEC3",
        min: minimum,
        max: maximum,
      },
      { bufferView: 1, componentType: 5126, count: mesh.positions.length, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: mesh.cells.length * 3, type: "SCALAR" },
    ],
  };
  let json = encoder.encode(JSON.stringify(gltf));
  const paddedJsonLength = align4(json.length);
  if (paddedJsonLength !== json.length) {
    const padded = new Uint8Array(paddedJsonLength);
    padded.fill(0x20);
    padded.set(json);
    json = padded;
  }
  const totalLength = 12 + 8 + json.length + 8 + binary.length;
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.set(json, 20);
  const binaryHeader = 20 + json.length;
  view.setUint32(binaryHeader, binary.length, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

export function export3mf(mesh) {
  const vertices = mesh.positions
    .map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`)
    .join("");
  const triangles = mesh.cells
    .map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
    .join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="zh-CN" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Photo23D 模型</metadata>
  <metadata name="Application">Photo23D</metadata>
  <resources><object id="1" type="model"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object></resources>
  <build><item objectid="1"/></build>
</model>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  return zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(relationships),
      "3D/3dmodel.model": strToU8(model),
    },
    { level: 6 },
  );
}

export function exportAllFormats(mesh) {
  return {
    glb: exportGlb(mesh),
    obj: exportObj(mesh),
    stl: exportBinaryStl(mesh),
    ply: exportPly(mesh),
    "3mf": export3mf(mesh),
  };
}

