# Text Rectangle Generator

Parametric STL generator: rectangular plate with raised text. Text is scaled to fit the rectangle; plate thickness and letter height are parametrized. Arial Bold–style when using a TTF/OTF font (e.g. Open Sans Bold or Arial Bold).

## Installation

```bash
cd text-rectangle-generator
npm install
```

## Usage

### CLI

Generate from JSON:

```bash
npm run generate -- --input examples/example.json --output output/plate.stl
```

**Input JSON (all dimensions in mm):**

| Parameter          | Description                              | Default |
|--------------------|------------------------------------------|---------|
| `rectangleWidth`   | Plate width                              | 80      |
| `rectangleHeight`  | Plate height                             | 40      |
| `thickness`        | Plate thickness                          | 2       |
| `letterHeight`     | Extrusion height of the text             | 2       |
| `text`             | Text string                              | "HELLO" |
| `padding`          | Margin inside rectangle around text      | 2       |
| `fontPath`         | Path to TTF/OTF file (CLI)              | -       |
| `fontUrl`          | URL to TTF/OTF (web or CLI with fetch)   | -       |

**Important:** For proper filled text you need a font. The CLI uses a **single canonical font**: the first time you run with `fontUrl` in your JSON, it downloads the font and saves it under `cache/OpenSans-Bold.ttf`. Later runs load from that cache so you always use the same font and no extra URLs. To prefill the cache (e.g. before going offline), run `npm run download-font`. Without a loaded font, the CLI falls back to a stroke-based vector font and you may only see a single shape instead of full text.

### Web UI

- Open `web/index.html` in a browser or serve the `web/` folder.
- Set dimensions, text, and optional font URL (default: Open Sans Bold from CDN).
- Click **Generate STL** to download the STL.

Build for GitHub Pages:

```bash
npm run build-web
```

Then deploy the `docs/` folder (e.g. Settings → Pages → source branch, folder `/docs`).

## Examples

- `examples/example.json` — 80×40 mm plate, “HELLO”, 2 mm thickness and letter height.

## License

MIT
