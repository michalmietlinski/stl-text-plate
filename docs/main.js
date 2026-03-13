(function () {
  "use strict";

  const BEZIER_SAMPLES = 8;
  const DEFAULT_FONT_URL = "https://cdn.jsdelivr.net/npm/open-sans-font@1.0.0/fonts/bold/OpenSans-Bold.ttf";

  function toFiniteNumber(raw, label) {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
    return value;
  }

  function setStatus(message, isError = false) {
    const body = document.querySelector("#status .status-body");
    if (!body) return;
    body.textContent = String(message);
    body.style.color = isError ? "crimson" : "";
  }

  function downloadStlFile(filename, content) {
    const blob = new Blob([content], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function flattenPath(path) {
    const contours = [];
    let current = [];
    let last = [0, 0];
    const add = (x, y) => {
      current.push([x, y]);
      last = [x, y];
    };
    const sampleCubic = (x0, y0, x1, y1, x2, y2, x3, y3) => {
      for (let i = 1; i <= BEZIER_SAMPLES; i++) {
        const t = i / BEZIER_SAMPLES;
        const u = 1 - t;
        const u2 = u * u, u3 = u2 * u;
        const t2 = t * t, t3 = t2 * t;
        add(u3 * x0 + 3 * u2 * t * x1 + 3 * u * t2 * x2 + t3 * x3, u3 * y0 + 3 * u2 * t * y1 + 3 * u * t2 * y2 + t3 * y3);
      }
    };
    const sampleQuad = (x0, y0, x1, y1, x2, y2) => {
      for (let i = 1; i <= BEZIER_SAMPLES; i++) {
        const t = i / BEZIER_SAMPLES;
        const u = 1 - t;
        add(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
      }
    };
    const commands = path.commands || [];
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const type = cmd.type;
      if (type === "M") {
        if (current.length > 0) contours.push(current);
        current = [[cmd.x, cmd.y]];
        last = [cmd.x, cmd.y];
      } else if (type === "L") {
        add(cmd.x, cmd.y);
      } else if (type === "C") {
        sampleCubic(last[0], last[1], cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
      } else if (type === "Q") {
        sampleQuad(last[0], last[1], cmd.x1, cmd.y1, cmd.x, cmd.y);
      } else if (type === "Z") {
        if (current.length > 1) current.push([current[0][0], current[0][1]]);
        contours.push(current);
        current = [];
      }
    }
    if (current.length > 0) contours.push(current);
    return contours;
  }

  function contoursBounds(contours) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const contour of contours) {
      for (const [x, y] of contour) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function fitContours(contours, rectWidth, rectHeight, padding) {
    const { minX, minY, width, height } = contoursBounds(contours);
    const innerW = Math.max(0.1, rectWidth - 2 * padding);
    const innerH = Math.max(0.1, rectHeight - 2 * padding);
    const scale = width > 1e-6 && height > 1e-6 ? Math.min(innerW / width, innerH / height) : 1;
    const offsetX = rectWidth / 2 - (minX + width / 2) * scale;
    const offsetY = rectHeight / 2 - (minY + height / 2) * scale;
    return contours.map((contour) =>
      contour.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY])
    );
  }

  function cuboidTriangles(w, d, h, cx, cy, cz) {
    const hw = w / 2, hd = d / 2, hh = h / 2;
    const x0 = cx - hw, x1 = cx + hw, y0 = cy - hd, y1 = cy + hd, z0 = cz - hh, z1 = cz + hh;
    const v = {
      "000": [x0, y0, z0], "100": [x1, y0, z0], "010": [x0, y1, z0], "110": [x1, y1, z0],
      "001": [x0, y0, z1], "101": [x1, y0, z1], "011": [x0, y1, z1], "111": [x1, y1, z1]
    };
    const tri = (a, b, c) => [v[a], v[b], v[c]];
    return [
      tri("000", "010", "110"), tri("000", "110", "100"),
      tri("001", "101", "111"), tri("001", "111", "011"),
      tri("000", "001", "011"), tri("000", "011", "010"),
      tri("100", "110", "111"), tri("100", "111", "101"),
      tri("000", "001", "101"), tri("000", "101", "100"),
      tri("010", "110", "111"), tri("010", "111", "011")
    ];
  }

  function prismTriangles(ax, ay, bx, by, cx, cy, z0, z1) {
    const a0 = [ax, ay, z0], b0 = [bx, by, z0], c0 = [cx, cy, z0];
    const a1 = [ax, ay, z1], b1 = [bx, by, z1], c1 = [cx, cy, z1];
    return [
      [a0, c0, b0], [a1, b1, c1],
      [a0, b0, b1], [a0, b1, a1],
      [b0, c0, c1], [b0, c1, b1],
      [c0, a0, a1], [c0, a1, c1]
    ];
  }

  function triNormal([a, b, c]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  function trianglesToAsciiStl(triangles, solidName) {
    let out = `solid ${solidName}\n`;
    for (const tri of triangles) {
      const n = triNormal(tri);
      out += `  facet normal ${n[0]} ${n[1]} ${n[2]}\n    outer loop\n`;
      for (const p of tri) out += `      vertex ${p[0]} ${p[1]} ${p[2]}\n`;
      out += `    endloop\n  endfacet\n`;
    }
    out += `endsolid ${solidName}\n`;
    return out;
  }

  function buildPlateStl(params) {
    const w = params.rectangleWidth;
    const h = params.rectangleHeight;
    const thickness = params.thickness;
    const letterHeight = params.letterHeight;
    const padding = params.padding ?? 2;
    const all = [];
    const plateTris = cuboidTriangles(w, h, thickness, w / 2, h / 2, thickness / 2);
    all.push(...plateTris);

    const contours = params.contours || [];
    const z0 = thickness;
    const z1 = thickness + letterHeight;
    for (const contour of contours) {
      if (contour.length < 3) continue;
      const flat = [];
      for (const [x, y] of contour) flat.push(x, y);
      const indices = typeof earcut !== "undefined" ? earcut(flat, [], 2) : [];
      for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
        const ax = flat[i0 * 2], ay = flat[i0 * 2 + 1];
        const bx = flat[i1 * 2], by = flat[i1 * 2 + 1];
        const cx = flat[i2 * 2], cy = flat[i2 * 2 + 1];
        all.push(...prismTriangles(ax, ay, bx, by, cx, cy, z0, z1));
      }
    }
    return trianglesToAsciiStl(all, "text_plate");
  }

  function collectParamsFromForm(form) {
    const el = form?.elements;
    if (!el) throw new Error("Form not found.");
    function val(name, fallback) {
      const control = el[name] ?? el.namedItem?.(name);
      if (control == null) return fallback;
      const v = control.value;
      if (v === undefined || v === null) return fallback;
      return v;
    }
    return {
      rectangleWidth: toFiniteNumber(val("rectangleWidth", 80), "Rectangle width"),
      rectangleHeight: toFiniteNumber(val("rectangleHeight", 40), "Rectangle height"),
      thickness: toFiniteNumber(val("thickness", 2), "Thickness"),
      letterHeight: toFiniteNumber(val("letterHeight", 2), "Letter height"),
      text: (val("text", "HELLO") || "HELLO").trim(),
      padding: toFiniteNumber(val("padding", 2), "Padding"),
      fontUrl: val("fontUrl", "") || null
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event?.target;
    if (!form?.elements) {
      setStatus("Form not available.", true);
      return;
    }
    try {
      const params = collectParamsFromForm(form);
      const fontUrl = params.fontUrl || DEFAULT_FONT_URL;
      let contours = [];
      const ot = typeof opentype !== "undefined" ? opentype : (typeof window !== "undefined" && window.opentype);
      if (ot && fontUrl) {
        try {
          const font = await new Promise((resolve, reject) => {
            ot.load(fontUrl, (err, f) => (err ? reject(err) : resolve(f)));
          });
          if (font && params.text) {
            const path = font.getPath(params.text, 0, 0, 100);
            const raw = flattenPath(path);
            if (raw.length > 0 && contoursBounds(raw).width > 1e-6) {
              contours = fitContours(raw, params.rectangleWidth, params.rectangleHeight, params.padding);
            }
          }
        } catch (_) {
          setStatus("Could not load font; using empty text. Check font URL.", true);
        }
      }
      params.contours = contours;
      const stl = buildPlateStl(params);
      const filename = `plate_${params.rectangleWidth}x${params.rectangleHeight}.stl`;
      downloadStlFile(filename, stl);
      setStatus(
        `Downloaded: ${filename}\n\nPlate: ${params.rectangleWidth}×${params.rectangleHeight} mm, thickness ${params.thickness} mm, letter height ${params.letterHeight} mm\nText: "${params.text}"`,
        false
      );
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  function main() {
    const form = document.getElementById("generator-form");
    if (!form) return;
    form.addEventListener("submit", handleSubmit);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
