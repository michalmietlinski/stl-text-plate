/**
 * Text rectangle generator (core).
 * Rectangle plate with raised text, Arial Bold style (opentype) or built-in vector font.
 * Text is scaled to fit the rectangle; plate thickness and letter height are parametrized.
 */

import path from "node:path";
import modeling from "@jscad/modeling";
import { serialize } from "@jscad/stl-serializer";
import earcut from "earcut";

const { primitives, booleans, transforms, text: textModule, geometries, extrusions } = modeling;
const { cuboid } = primitives;
const { union } = booleans;
const { translate } = transforms;
const { geom2, geom3 } = geometries;
const { extrudeLinear } = extrusions;

const BEZIER_SAMPLES = 8;

function toFiniteNumber(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error(`${label} must be a finite number.`);
  return num;
}

/**
 * Flatten opentype path commands to contours (array of [x,y] points per contour).
 * Handles M, L, C, Q, Z.
 */
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
      const x = u3 * x0 + 3 * u2 * t * x1 + 3 * u * t2 * x2 + t3 * x3;
      const y = u3 * y0 + 3 * u2 * t * y1 + 3 * u * t2 * y2 + t3 * y3;
      add(x, y);
    }
  };

  const sampleQuad = (x0, y0, x1, y1, x2, y2) => {
    for (let i = 1; i <= BEZIER_SAMPLES; i++) {
      const t = i / BEZIER_SAMPLES;
      const u = 1 - t;
      const x = u * u * x0 + 2 * u * t * x1 + t * t * x2;
      const y = u * u * y0 + 2 * u * t * y1 + t * t * y2;
      add(x, y);
    }
  };

  const commands = path.commands || path;
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const type = cmd.type || cmd;
    if (type === "M" || type === "m") {
      if (current.length > 0) contours.push(current);
      const x = cmd.x ?? cmd.x1;
      const y = cmd.y ?? cmd.y1;
      current = [[x, y]];
      last = [x, y];
    } else if (type === "L" || type === "l") {
      const x = cmd.x ?? last[0] + (cmd.dx ?? 0);
      const y = cmd.y ?? last[1] + (cmd.dy ?? 0);
      add(x, y);
    } else if (type === "C" || type === "c") {
      const x0 = last[0], y0 = last[1];
      const x1 = cmd.x1 ?? x0 + (cmd.dx1 ?? 0);
      const y1 = cmd.y1 ?? y0 + (cmd.dy1 ?? 0);
      const x2 = cmd.x2 ?? x0 + (cmd.dx2 ?? 0);
      const y2 = cmd.y2 ?? y0 + (cmd.dy2 ?? 0);
      const x3 = cmd.x ?? x0 + (cmd.dx ?? 0);
      const y3 = cmd.y ?? y0 + (cmd.dy ?? 0);
      sampleCubic(x0, y0, x1, y1, x2, y2, x3, y3);
    } else if (type === "Q" || type === "q") {
      const x0 = last[0], y0 = last[1];
      const x1 = cmd.x1 ?? x0 + (cmd.dx1 ?? 0);
      const y1 = cmd.y1 ?? y0 + (cmd.dy1 ?? 0);
      const x2 = cmd.x ?? x0 + (cmd.dx ?? 0);
      const y2 = cmd.y ?? y0 + (cmd.dy ?? 0);
      sampleQuad(x0, y0, x1, y1, x2, y2);
    } else if (type === "Z" || type === "z") {
      if (current.length > 1) current.push([current[0][0], current[0][1]]);
      contours.push(current);
      current = [];
    }
  }
  if (current.length > 0) contours.push(current);
  return contours;
}

/**
 * Signed area of a closed contour (positive = counter-clockwise).
 * JSCAD extrusion expects CCW winding for correct outward normals.
 */
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

/**
 * Ensure contour is counter-clockwise (positive area). Reverse in place if not.
 */
function ensureCounterClockwise(contour) {
  if (signedArea(contour) < 0) contour.reverse();
}

/**
 * Centroid of a closed contour (for point-in-polygon grouping).
 */
function contourCentroid(contour) {
  if (!contour || contour.length < 2) return [0, 0];
  let cx = 0, cy = 0, n = 0;
  const len = contour[0][0] === contour[contour.length - 1][0] && contour[0][1] === contour[contour.length - 1][1]
    ? contour.length - 1
    : contour.length;
  for (let i = 0; i < len; i++) {
    cx += contour[i][0];
    cy += contour[i][1];
    n++;
  }
  return n ? [cx / n, cy / n] : [0, 0];
}

/**
 * Point-in-polygon (ray casting). Point [x,y], contour as array of [x,y].
 */
function pointInPolygon(point, contour) {
  const [px, py] = point;
  let inside = false;
  const n = contour.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = contour[i];
    const [xj, yj] = contour[j];
    if (yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Ensure contour is closed (first point duplicated at end). Returns new array.
 */
function ensureClosed(contour) {
  if (!contour || contour.length < 2) return contour ? [...contour] : [];
  const out = [...contour];
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out;
}

/**
 * Remove duplicate closing point for earcut (earcut expects open ring).
 */
function ringPoints(contour) {
  if (!contour || contour.length < 3) return contour ? [...contour] : [];
  const c = [...contour];
  if (c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) c.pop();
  return c.length >= 3 ? c : contour;
}

/**
 * Triangulate one outer contour and its holes with earcut. Returns array of triangles (each = 3 points [x,y]).
 */
function triangulateShape(outerContour, holeContours) {
  const outer = ringPoints(outerContour);
  if (outer.length < 3) return [];
  const vertices = outer.map((p) => [p[0], p[1]]);
  const holeIndices = [];
  for (const h of holeContours) {
    const ring = ringPoints(h);
    if (ring.length < 3) continue;
    holeIndices.push(vertices.length);
    for (const p of ring) vertices.push([p[0], p[1]]);
  }
  const data = vertices.flat();
  const indices = earcut(data, holeIndices.length ? holeIndices : undefined, 2);
  if (!indices || indices.length < 3) return [];
  const triangles = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertices[indices[i]];
    const b = vertices[indices[i + 1]];
    const c = vertices[indices[i + 2]];
    const tri = [a, b, c];
    if (signedArea(tri) < 0) tri.reverse();
    triangles.push(tri);
  }
  return triangles;
}

/**
 * Get bounding box of contours [[[x,y],...], ...].
 */
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

/**
 * Scale and translate contours to fit inside rectWidth x rectHeight, centered. Padding from edges.
 */
function fitContours(contours, rectWidth, rectHeight, padding = 0) {
  const { minX, minY, width, height } = contoursBounds(contours);
  const innerW = Math.max(0.1, rectWidth - 2 * padding);
  const innerH = Math.max(0.1, rectHeight - 2 * padding);
  const scale = Math.min(innerW / width, innerH / height) || 1;
  const offsetX = rectWidth / 2 - (minX + width / 2) * scale;
  const offsetY = rectHeight / 2 - (minY + height / 2) * scale;

  return contours.map((contour) =>
    contour.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY])
  );
}

/**
 * Load font: from URL (string) or path (Node). Returns opentype Font or null.
 * When URL fetch fails (e.g. Node without network), tries local fallback paths.
 */
export async function loadFont(source) {
  if (!source) return null;
  const { parse } = await import("opentype.js");
  const parseBuf = (buf) => parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  try {
    if (typeof fetch !== "undefined") {
      const res = await fetch(source);
      if (res && res.ok) {
        const buf = await res.arrayBuffer();
        return parse(buf);
      }
    }
  } catch (_) {}

  const fs = await import("node:fs/promises").catch(() => null);
  if (fs) {
    try {
      const buf = await fs.readFile(source);
      return parseBuf(buf);
    } catch (_) {}
    // When source is a URL that failed, try local fallbacks (e.g. examples/OpenSans-Bold.ttf)
    if (typeof source === "string" && (source.startsWith("http://") || source.startsWith("https://"))) {
      const name = (source.split("/").pop() || "font.ttf").split("?")[0];
      for (const dir of ["examples", "fonts", "."]) {
        try {
          const buf = await fs.readFile(path.join(dir, name));
          return parseBuf(buf);
        } catch (_) {}
      }
    }
  }
  return null;
}

/**
 * Get text contours using opentype font. Scaled to fit rect, centered.
 * Uses getPaths() for one path per glyph so we can group contours by letter (TTF and CFF safe).
 * Returns { glyphContours, bounds } where glyphContours = [ [contour, contour, ...], ... ] per glyph.
 */
export function getTextContoursFromFont(font, text, rectWidth, rectHeight, letterHeightMm, padding = 1, opts = {}) {
  if (!text || !font) return { glyphContours: [], bounds: { width: 0, height: 0 } };
  const fontSize = 100;
  let paths = font.getPaths ? font.getPaths(text, 0, 0, fontSize) : null;
  if (!paths || paths.length === 0) paths = [font.getPath(text, 0, 0, fontSize)];
  let glyphRaw = paths.map((path) => flattenPath(path));
  const totalContours = glyphRaw.reduce((s, c) => s + c.length, 0);
  // If getPaths returned many paths but almost no contours (e.g. one path per contour or API quirk), use single getPath
  if (paths.length > 1 && totalContours < 2) {
    const singlePath = font.getPath(text, 0, 0, fontSize);
    glyphRaw = [flattenPath(singlePath)];
    if (opts.debug) console.warn(`[debug getTextContours] fallback to single path: ${glyphRaw[0].length} contours`);
  }
  if (opts.debug) console.warn(`[debug getTextContours] paths=${paths.length} contoursPerPath=[${glyphRaw.map((c) => c.length).join(",")}]`);
  const allRaw = glyphRaw.flat();
  const bounds = contoursBounds(allRaw);
  if (bounds.width < 1e-6 || bounds.height < 1e-6) return { glyphContours: [], bounds };
  const scale = Math.min(
    Math.max(0.1, rectWidth - 2 * padding) / bounds.width,
    Math.max(0.1, rectHeight - 2 * padding) / bounds.height
  ) || 1;
  const offsetX = rectWidth / 2 - (bounds.minX + bounds.width / 2) * scale;
  const offsetY = rectHeight / 2 - (bounds.minY + bounds.height / 2) * scale;
  // Font Y is up; mirror in Y so text is right-side up when viewing from +Z (typical STL viewer)
  const fit = (c) =>
    c.map(([x, y]) => {
      const px = x * scale + offsetX;
      const py = y * scale + offsetY;
      return [px, rectHeight - py];
    });
  const glyphContours = glyphRaw.map((contours) => contours.map((c) => fit(c)));
  return { glyphContours, bounds };
}

/**
 * Get text segments using JSCAD vectorText (built-in font). Returns array of segments (each segment = [[x,y],...]).
 * Scaled to fit rect and centered.
 */
export function getTextSegmentsVector(textStr, rectWidth, rectHeight, padding = 1) {
  if (!textStr) return [];
  const height = 21;
  const segments = textModule.vectorText({ height, align: "center" }, textStr);
  if (segments.length === 0) return [];
  const allPoints = segments.flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of allPoints) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const width = maxX - minX || 1;
  const height2 = maxY - minY || 1;
  const innerW = Math.max(0.1, rectWidth - 2 * padding);
  const innerH = Math.max(0.1, rectHeight - 2 * padding);
  const scale = Math.min(innerW / width, innerH / height2) || 1;
  const offsetX = rectWidth / 2 - (minX + width / 2) * scale;
  const offsetY = rectHeight / 2 - (minY + height2 / 2) * scale;

  return segments.map((seg) =>
    seg.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY])
  );
}

/**
 * Generate STL: rectangle plate + extruded text.
 * Build optional plant stake: bar extending in -Y from plate bottom (orientation to text).
 * Local: width stakeWidth (X), thickness (Z), length stakeHeight (Y). Top at y=0; far end is a triangle tip (single point).
 * Returns geom3 in local coords (stake top at y=0, centered in X, z in [0, thickness]).
 */
function createStake(stakeWidth, thickness, stakeHeight) {
  const w = stakeWidth / 2;
  const t = thickness;
  const H = stakeHeight;
  const tip = [0, -H, t / 2]; // single point at center of end face

  const v = {
    tfl: [-w, 0, 0],
    tfr: [w, 0, 0],
    tbr: [w, 0, t],
    tbl: [-w, 0, t],
    bfl: [-w, -H, 0],
    bfr: [w, -H, 0],
    bbr: [w, -H, t],
    bbl: [-w, -H, t],
  };

  const polygons = [
    [v.tfl, v.tfr, v.tbr, v.tbl], // top (y=0)
    [v.tfl, v.tfr, v.bfr, v.bfl], // front (z=0)
    [v.tbr, v.tbl, v.bbl, v.bbr], // back (z=t)
    [v.tbl, v.tfl, v.bfl, v.bbl], // left (x=-w)
    [v.tfr, v.tbr, v.bbr, v.bfr], // right (x=w)
    [v.bfl, v.bfr, tip], // bottom: 4 triangles meeting at tip
    [v.bfr, v.bbr, tip],
    [v.bbr, v.bbl, tip],
    [v.bbl, v.bfl, tip],
  ];
  return geom3.fromPoints(polygons);
}

/**
 * @param {object} params - { rectangleWidth, rectangleHeight, thickness, letterHeight, text, fontPath?, fontUrl?, padding?, addStake?, stakeWidth?, stakeHeight? }
 */
export async function generate(params, options = {}) {
  const name = options.name || "text_plate";
  const rectangleWidth = toFiniteNumber(params.rectangleWidth ?? 80, "rectangleWidth");
  const rectangleHeight = toFiniteNumber(params.rectangleHeight ?? 40, "rectangleHeight");
  const thickness = toFiniteNumber(params.thickness ?? 2, "thickness");
  const letterHeight = toFiniteNumber(params.letterHeight ?? 2, "letterHeight");
  const text = params.text != null ? String(params.text) : "HELLO";
  const padding = toFiniteNumber(params.padding ?? 2, "padding");
  const fontPath = params.fontPath ?? null;
  const fontUrl = params.fontUrl ?? params.fontPath ?? null;
  const addStake = params.addStake === true;
  const stakeWidth = addStake ? toFiniteNumber(params.stakeWidth ?? 8, "stakeWidth") : 0;
  const stakeHeight = addStake ? toFiniteNumber(params.stakeHeight ?? 60, "stakeHeight") : 0;

  if (rectangleWidth <= 0 || rectangleHeight <= 0 || thickness <= 0 || letterHeight <= 0) {
    throw new Error("rectangleWidth, rectangleHeight, thickness, letterHeight must be > 0.");
  }
  if (addStake && (stakeWidth <= 0 || stakeHeight <= 0)) {
    throw new Error("When addStake is true, stakeWidth and stakeHeight must be > 0.");
  }

  const plate = translate(
    [rectangleWidth / 2, rectangleHeight / 2, thickness / 2],
    cuboid({ size: [rectangleWidth, rectangleHeight, thickness] })
  );

  let glyphContours = [];
  let font = await loadFont(fontUrl);
  if (!font && fontPath) font = await loadFont(fontPath);
  if (options.debug) console.error(`[debug] font loaded: ${!!font} (tried url then path)`);
  if (font) {
    const out = getTextContoursFromFont(font, text, rectangleWidth, rectangleHeight, letterHeight, padding, options);
    glyphContours = out.glyphContours || [];
  }
  if (glyphContours.length === 0) {
    const segments = getTextSegmentsVector(text, rectangleWidth, rectangleHeight, padding);
    if (segments.length > 0) glyphContours = segments.map((s) => [s]);
    if (options.debug) console.error(`[debug] using vector fallback: ${segments.length} segments`);
    if (fontPath || fontUrl) {
      console.error("Warning: Font did not load. You will only see a simple shape (e.g. one circle). Put a TTF file in the same folder as your JSON (e.g. examples/OpenSans-Bold.ttf), set \"fontPath\": \"OpenSans-Bold.ttf\", and run again. See examples/README-font.md.");
    }
  }

  const geometries = [plate];
  const debug = options.debug === true;

  if (debug) {
    console.error(`[debug] glyphContours.length=${glyphContours.length} text="${text}"`);
  }

  // Per-glyph: classify by winding (like 3d-print-letterpress). First contour = outer orientation; same = outer, opposite = hole.
  for (let gi = 0; gi < glyphContours.length; gi++) {
    const glyph = glyphContours[gi];
    const closed = glyph
      .filter((c) => c.length >= 3)
      .map((c) => ensureClosed(c));
    if (closed.length === 0) continue;

    // Base orientation: use first contour, or the contour with largest area (outer is usually biggest)
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
      if (s === baseSign) outers.push({ contour: closed[i], index: i });
      else holes.push(closed[i]);
    }

    // If no outers (e.g. CFF put hole first), treat largest-area contour as outer
    if (outers.length === 0 && closed.length > 0) {
      let bestIdx = 0;
      let bestArea = Math.abs(signedArea(closed[0]));
      for (let i = 1; i < closed.length; i++) {
        const a = Math.abs(signedArea(closed[i]));
        if (a > bestArea) {
          bestArea = a;
          bestIdx = i;
        }
      }
      baseSign = Math.sign(signedArea(closed[bestIdx]));
      for (let i = 0; i < closed.length; i++) {
        const s = Math.sign(signedArea(closed[i]));
        if (s === 0) continue;
        if (s === baseSign) outers.push({ contour: closed[i], index: i });
        else holes.push(closed[i]);
      }
    }

    if (outers.length === 0) continue;

    // Assign each hole to the smallest outer that contains its centroid
    const holesByOuter = outers.map(() => []);
    for (const hole of holes) {
      const cen = contourCentroid(hole);
      let bestK = -1;
      let bestArea = Infinity;
      for (let k = 0; k < outers.length; k++) {
        if (!pointInPolygon(cen, outers[k].contour)) continue;
        const a = Math.abs(signedArea(outers[k].contour));
        if (a < bestArea) {
          bestArea = a;
          bestK = k;
        }
      }
      if (bestK >= 0) holesByOuter[bestK].push(hole);
    }

    if (debug) {
      console.error(`[debug] glyph ${gi}: contours=${closed.length} outers=${outers.length} holes=${holes.length} holesByOuter=[${holesByOuter.map((h) => h.length).join(",")}]`);
    }

    // Triangulate each outer + its holes (earcut), then extrude each triangle — no geom2 subtract
    for (let k = 0; k < outers.length; k++) {
      const contour = outers[k].contour;
      ensureCounterClockwise(contour);
      const holes = holesByOuter[k];
      const triangles = triangulateShape(contour, holes);
      for (const tri of triangles) {
        const g2 = geom2.fromPoints(tri);
        const extruded = extrudeLinear({ height: letterHeight }, g2);
        const raised = translate([0, 0, thickness], extruded);
        geometries.push(raised);
      }
    }
  }

  let geometry = geometries.length === 1 ? plate : union(plate, ...geometries.slice(1));
  if (addStake) {
    const stake = translate(
      [rectangleWidth / 2, 0, 0],
      createStake(stakeWidth, thickness, stakeHeight)
    );
    geometry = union(geometry, stake);
  }
  const rawData = serialize({ binary: false }, geometry);
  const stl =
    typeof rawData === "string"
      ? rawData
      : Array.isArray(rawData) && rawData.length > 0 && typeof rawData[0] === "string"
        ? rawData[0]
        : Buffer.from(rawData).toString("utf8");

  return {
    stl,
    meta: {
      rectangleWidth,
      rectangleHeight,
      thickness,
      letterHeight,
      text,
      name,
      addStake: addStake || undefined,
      stakeWidth: addStake ? stakeWidth : undefined,
      stakeHeight: addStake ? stakeHeight : undefined,
    },
  };
}
