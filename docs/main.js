(function () {
  "use strict";

  const BEZIER_SAMPLES = 8;
  // Font bundled with the app (web/fonts/ or docs/fonts/ on GitHub Pages). Run npm run download-font then npm run build-web.
  const LOCAL_FONT_PATH = "fonts/OpenSans-Bold.ttf";

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

  function signedArea(contour) {
    if (!contour || contour.length < 3) return 0;
    let a = 0;
    for (let i = 0; i < contour.length; i++) {
      const j = (i + 1) % contour.length;
      a += contour[i][0] * contour[j][1];
      a -= contour[j][0] * contour[i][1];
    }
    return a / 2;
  }

  function contourCentroid(contour) {
    if (!contour || contour.length < 2) return [0, 0];
    let cx = 0, cy = 0, n = 0;
    const len = (contour[0][0] === contour[contour.length - 1][0] && contour[0][1] === contour[contour.length - 1][1])
      ? contour.length - 1
      : contour.length;
    for (let i = 0; i < len; i++) {
      cx += contour[i][0];
      cy += contour[i][1];
      n++;
    }
    return n ? [cx / n, cy / n] : [0, 0];
  }

  function pointInPolygon(point, contour) {
    const px = point[0], py = point[1];
    let inside = false;
    const n = contour.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = contour[i][0], yi = contour[i][1];
      const xj = contour[j][0], yj = contour[j][1];
      if (yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function ensureClosed(contour) {
    if (!contour || contour.length < 2) return contour ? contour.slice() : [];
    const out = contour.slice();
    const first = out[0], last = out[out.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
    return out;
  }

  function ringPoints(contour) {
    if (!contour || contour.length < 3) return contour ? contour.slice() : [];
    const c = contour.slice();
    if (c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) c.pop();
    return c.length >= 3 ? c : contour;
  }

  function triangulateWithHoles(outerContour, holeContours) {
    const outer = ringPoints(outerContour);
    if (outer.length < 3) return [];
    const vertices = outer.map((p) => [p[0], p[1]]);
    const holeIndices = [];
    for (let h = 0; h < holeContours.length; h++) {
      const ring = ringPoints(holeContours[h]);
      if (ring.length < 3) continue;
      holeIndices.push(vertices.length);
      for (let k = 0; k < ring.length; k++) vertices.push([ring[k][0], ring[k][1]]);
    }
    const data = [];
    for (let v = 0; v < vertices.length; v++) {
      data.push(vertices[v][0], vertices[v][1]);
    }
    const indices = (typeof earcut !== "undefined" ? earcut(data, holeIndices.length ? holeIndices : undefined, 2) : []) || [];
    const triangles = [];
    for (let i = 0; i < indices.length; i += 3) {
      const a = vertices[indices[i]].slice();
      const b = vertices[indices[i + 1]].slice();
      const c = vertices[indices[i + 2]].slice();
      const tri = [a, b, c];
      if (signedArea(tri) < 0) tri.reverse();
      triangles.push(tri);
    }
    return triangles;
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
    // Font Y is up; mirror in Y so text is right-side up in STL viewer (same as CLI)
    return contours.map((contour) =>
      contour.map(([x, y]) => {
        const px = x * scale + offsetX;
        const py = y * scale + offsetY;
        return [px, rectHeight - py];
      })
    );
  }

  /** Stake: bar extending in -Y from plate bottom (orientation to text). Top at (cx, cy), width in X, thickness in Z, length in Y. Triangle tip (single point) at far end. */
  function stakeTriangles(stakeWidth, thickness, stakeHeight, cx, cy) {
    const w = stakeWidth / 2;
    const t = thickness;
    const H = stakeHeight;
    const tr = (x, y, z) => [x + cx, y + cy, z];
    const v = {
      tfl: tr(-w, 0, 0), tfr: tr(w, 0, 0), tbr: tr(w, 0, t), tbl: tr(-w, 0, t),
      bfl: tr(-w, -H, 0), bfr: tr(w, -H, 0), bbr: tr(w, -H, t), bbl: tr(-w, -H, t),
      tip: tr(0, -H, t / 2)
    };
    const tri = (a, b, c) => [v[a], v[b], v[c]];
    return [
      tri("tfl", "tfr", "tbr"), tri("tfl", "tbr", "tbl"),
      tri("tfl", "tfr", "bfr"), tri("tfl", "bfr", "bfl"),
      tri("tbr", "tbl", "bbl"), tri("tbr", "bbl", "bbr"),
      tri("tbl", "tfl", "bfl"), tri("tbl", "bfl", "bbl"),
      tri("tfr", "tbr", "bbr"), tri("tfr", "bbr", "bfr"),
      tri("bfl", "bfr", "tip"), tri("bfr", "bbr", "tip"), tri("bbr", "bbl", "tip"), tri("bbl", "bfl", "tip")
    ];
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
    const z0 = thickness;
    const z1 = thickness + letterHeight;
    const all = [];
    const plateTris = cuboidTriangles(w, h, thickness, w / 2, h / 2, thickness / 2);
    all.push(...plateTris);
    if (params.addStake && params.stakeWidth > 0 && params.stakeHeight > 0) {
      all.push(...stakeTriangles(params.stakeWidth, thickness, params.stakeHeight, w / 2, 0));
    }

    if (params.glyphContours && params.glyphContours.length > 0) {
      for (let gi = 0; gi < params.glyphContours.length; gi++) {
        const glyph = params.glyphContours[gi];
        const closed = glyph.filter((c) => c.length >= 3).map(ensureClosed);
        if (closed.length === 0) continue;
        let baseSign = Math.sign(signedArea(closed[0]));
        if (baseSign === 0) {
          let maxArea = 0;
          for (let i = 0; i < closed.length; i++) {
            const a = Math.abs(signedArea(closed[i]));
            if (a > maxArea) {
              maxArea = a;
              baseSign = Math.sign(signedArea(closed[i]));
            }
          }
        }
        if (baseSign === 0) continue;
        const outers = [];
        const holes = [];
        for (let i = 0; i < closed.length; i++) {
          const s = Math.sign(signedArea(closed[i]));
          if (s === 0) continue;
          if (s === baseSign) outers.push(closed[i]);
          else holes.push(closed[i]);
        }
        if (outers.length === 0 && closed.length > 0) {
          let bestIdx = 0, bestArea = Math.abs(signedArea(closed[0]));
          for (let i = 1; i < closed.length; i++) {
            const a = Math.abs(signedArea(closed[i]));
            if (a > bestArea) {
              bestArea = a;
              bestIdx = i;
            }
          }
          baseSign = Math.sign(signedArea(closed[bestIdx]));
          outers.length = 0;
          holes.length = 0;
          for (let i = 0; i < closed.length; i++) {
            const s = Math.sign(signedArea(closed[i]));
            if (s === 0) continue;
            if (s === baseSign) outers.push(closed[i]);
            else holes.push(closed[i]);
          }
        }
        const holesByOuter = outers.map(() => []);
        for (let hi = 0; hi < holes.length; hi++) {
          const cen = contourCentroid(holes[hi]);
          let bestK = -1, bestArea = Infinity;
          for (let k = 0; k < outers.length; k++) {
            if (!pointInPolygon(cen, outers[k])) continue;
            const a = Math.abs(signedArea(outers[k]));
            if (a < bestArea) {
              bestArea = a;
              bestK = k;
            }
          }
          if (bestK >= 0) holesByOuter[bestK].push(holes[hi]);
        }
        for (let k = 0; k < outers.length; k++) {
          const triangles = triangulateWithHoles(outers[k], holesByOuter[k]);
          for (let t = 0; t < triangles.length; t++) {
            const tri = triangles[t];
            const ax = tri[0][0], ay = tri[0][1], bx = tri[1][0], by = tri[1][1], cx = tri[2][0], cy = tri[2][1];
            all.push(...prismTriangles(ax, ay, bx, by, cx, cy, z0, z1));
          }
        }
      }
    } else {
      const contours = params.contours || [];
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
      addStake: (form?.elements?.addStake && form.elements.addStake.checked) || false,
      stakeWidth: toFiniteNumber(val("stakeWidth", 8), "Stake width"),
      stakeHeight: toFiniteNumber(val("stakeHeight", 60), "Stake height")
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
      let contours = [];
      const ot = typeof opentype !== "undefined" ? opentype : (typeof window !== "undefined" && window.opentype);
      if (ot) {
        try {
          const font = await new Promise((resolve, reject) => {
            ot.load(LOCAL_FONT_PATH, (err, f) => (err ? reject(err) : resolve(f)));
          });
          if (font && params.text) {
            const fontSize = 100;
            const lineHeight = fontSize * 1.2;
            const lines = String(params.text).split(/\r?\n/);
            const allPaths = [];
            for (let i = 0; i < lines.length; i++) {
              const baselineY = -(lines.length - 1 - i) * lineHeight;
              const paths = font.getPaths ? font.getPaths(lines[i], 0, baselineY, fontSize) : [font.getPath(lines[i], 0, baselineY, fontSize)];
              for (let k = 0; k < paths.length; k++) allPaths.push(paths[k]);
            }
            const glyphRaw = allPaths.map((p) => flattenPath(p));
            const allRaw = [];
            for (let g = 0; g < glyphRaw.length; g++) {
              for (let c = 0; c < glyphRaw[g].length; c++) allRaw.push(glyphRaw[g][c]);
            }
            if (allRaw.length > 0 && contoursBounds(allRaw).width > 1e-6) {
              const bounds = contoursBounds(allRaw);
              const rectWidth = params.rectangleWidth;
              const rectHeight = params.rectangleHeight;
              const padding = params.padding ?? 2;
              const innerW = Math.max(0.1, rectWidth - 2 * padding);
              const innerH = Math.max(0.1, rectHeight - 2 * padding);
              const scale = Math.min(innerW / bounds.width, innerH / bounds.height) || 1;
              const offsetX = rectWidth / 2 - (bounds.minX + bounds.width / 2) * scale;
              const offsetY = rectHeight / 2 - (bounds.minY + bounds.height / 2) * scale;
              const fit = (c) =>
                c.map(([x, y]) => {
                  const px = x * scale + offsetX;
                  const py = y * scale + offsetY;
                  return [px, rectHeight - py];
                });
              params.glyphContours = glyphRaw.map((glyphConts) => glyphConts.map(fit));
            }
          }
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          setStatus("Could not load font: " + msg + ". Ensure fonts/OpenSans-Bold.ttf is present (run npm run download-font, then npm run build-web).", true);
        }
      }
      params.contours = contours;
      const stl = buildPlateStl(params);
      const filename = `plate_${params.rectangleWidth}x${params.rectangleHeight}.stl`;
      downloadStlFile(filename, stl);
      const hasNoText = (params.glyphContours && params.glyphContours.length === 0) || (!params.glyphContours && (!params.contours || params.contours.length === 0));
      if (hasNoText && params.text && ot) {
        setStatus(
          `Downloaded: ${filename} (plate only — no text). Font may have failed to load.`,
          true
        );
      } else {
        setStatus(
          `Downloaded: ${filename}\n\nPlate: ${params.rectangleWidth}×${params.rectangleHeight} mm, thickness ${params.thickness} mm, letter height ${params.letterHeight} mm\nText: "${params.text}"`,
          false
        );
      }
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  function main() {
    const form = document.getElementById("generator-form");
    if (!form) return;
    form.addEventListener("submit", handleSubmit);
    const addStakeEl = form.elements?.addStake;
    const stakeFields = document.getElementById("stake-fields");
    if (addStakeEl && stakeFields) {
      addStakeEl.addEventListener("change", () => {
        stakeFields.style.display = addStakeEl.checked ? "flex" : "none";
      });
      stakeFields.style.display = addStakeEl.checked ? "flex" : "none";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
