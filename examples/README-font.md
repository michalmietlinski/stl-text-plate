# Font for CLI

The CLI uses **one canonical font**. When your JSON has `"fontUrl": "https://cdn.jsdelivr.net/npm/opensans-font@1.0.0/OpenSans-Bold.ttf"` (or the same URL), the CLI:

1. **First run:** downloads the font and saves it to `cache/OpenSans-Bold.ttf`.
2. **Later runs:** loads from `cache/` so the same font is always used (no extra downloads).

To fill the cache before going offline, run from the project root:

```bash
npm run download-font
```

To use your own TTF instead, omit `fontUrl` and set `"fontPath": "path/to/your.ttf"` (relative to your input JSON’s folder).
