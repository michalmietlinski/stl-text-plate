# Hole Detection Fix for Mixed-Case Text

## Problem

When rendering text with mixed uppercase and lowercase letters (e.g., "Pomidor Malinowy"), the generated STL would only show the holes/centers of letters (like the middle of 'o', 'p', 'a') instead of the full letter shapes.

### Root Cause

The original implementation used **winding direction** (clockwise vs counter-clockwise) to classify contours as either outer shapes or holes:
- All contours with the same winding as the first/largest contour were considered "outers"
- All contours with opposite winding were considered "holes"

This approach failed when mixing uppercase and lowercase because:
1. Some fonts use different winding directions for uppercase vs lowercase letters
2. A single line of mixed-case text would have contours with both winding directions
3. The algorithm would incorrectly classify entire letters as holes, causing them to disappear

### Example Failures
- ✅ "pomidor malinowy" - worked (all lowercase)
- ✅ "POMIDOR MALINOWY" - worked (all uppercase)  
- ❌ "Pomidor Malinowy" - failed (mixed case)
- ❌ "PomidorMalinowy" - failed (mixed case)

## Solution

Replaced winding-based classification with **spatial containment** algorithm:

```javascript
// 1. Sort contours by area (largest first)
const sorted = closed
  .map((c, i) => ({ contour: c, area: Math.abs(signedArea(c)) }))
  .sort((a, b) => b.area - a.area);

// 2. For each contour, check if its centroid is inside a larger contour
for (let i = 0; i < sorted.length; i++) {
  const cen = contourCentroid(sorted[i].contour);
  let parentIdx = -1;
  
  // Check against all larger contours that are themselves outers
  for (let j = 0; j < i; j++) {
    if (contourParent[j] !== -1) continue; // Skip holes
    if (pointInPolygon(cen, sorted[j].contour)) {
      parentIdx = j; // Found containing contour
      break;
    }
  }
  
  // If inside another contour → it's a hole
  // If not inside → it's an outer contour
  if (parentIdx === -1) {
    outers.push(sorted[i]);
  } else {
    holes.push(sorted[i]);
    assignToParent[i] = parentIdx;
  }
}
```

### How It Works

1. **Sort by area**: Process largest contours first (typically letter outlines)
2. **Containment test**: Check if each contour's centroid is inside any larger contour
3. **Classification**:
   - Not inside any contour → **outer** (letter outline)
   - Inside a contour → **hole** (like the middle of 'o', 'p', 'a')
4. **Winding-independent**: Works regardless of contour direction

### Additional Fixes

Also added filtering for zero-area contours that could occur from spaces or degenerate paths:

```javascript
.filter((c) => Math.abs(signedArea(c)) > 1e-6)
```

This prevents spaces from creating phantom contours that break the classification.

## Results

All text combinations now work correctly:
- ✅ Mixed case with spaces: "Pomidor Malinowy"
- ✅ Mixed case without spaces: "PomidorMalinowy"  
- ✅ All lowercase: "pomidor malinowy"
- ✅ All uppercase: "POMIDOR MALINOWY"
- ✅ Polish characters: "AĄBCĆDEĘFGHIJKLŁMNŃOÓPRSŚTUWYZŹŻ"
- ✅ Multi-line text with mixed case

## Files Modified

- `src/core/textPlate.js` - Core Node.js implementation
- `web/main.js` - Browser version (before build)
- `docs/main.js` - GitHub Pages version (after build)

## Commit

This fix was implemented in commit improving hole detection for mixed-case text rendering.
