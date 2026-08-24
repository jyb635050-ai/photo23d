export function meshToObj(mesh, includeVertexColors = true) {
  const lines = ["# Photo23D visual hull", `o photo23d_${Date.now()}`];
  for (let index = 0; index < mesh.positions.length; index += 1) {
    const [x, y, z] = mesh.positions[index];
    if (includeVertexColors && mesh.colors?.[index]) {
      const [r, g, b] = mesh.colors[index];
      lines.push(`v ${x.toFixed(9)} ${y.toFixed(9)} ${z.toFixed(9)} ${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`);
    } else {
      lines.push(`v ${x.toFixed(9)} ${y.toFixed(9)} ${z.toFixed(9)}`);
    }
  }
  for (const [a, b, c] of mesh.cells) {
    lines.push(`f ${a + 1} ${b + 1} ${c + 1}`);
  }
  return `${lines.join("\n")}\n`;
}

