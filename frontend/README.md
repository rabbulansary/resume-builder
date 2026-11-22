# Frontend editors

## Student resume editor

Start the application and open `http://localhost:3000/resume/editor`. Use the
section navigator to switch between compact form panels. On smaller screens,
the **Preview** and **Back to editor** links move between the two panes. The editor
has separate fields for profile and contact, summary, skills, experience,
projects, education, certifications, and achievements. Add or remove entries,
toggle section and contact-link visibility, choose a skills style, and add or
hide education scores. Import accepts a plain resume fixture or a JSON export
from the editor. The editor starts a blank student resume.

Development and production builds compile both editor stylesheets with
Tailwind CSS. Run `pnpm --filter @resume-builder/frontend css` from the root to
regenerate them during development.

Changes trigger a debounced A4 preview. The page indicator reports the actual
PDF page count and the configured limit. Expand **Excluded content** to see
which entries were removed and why. **Download PDF** saves the PDF displayed
in the preview. **Open to print** opens the same file in the browser's PDF
viewer for printing. **Download JSON** keeps the complete validated resume,
including content excluded by fitting, along with the selected preset
revision and resume-specific layout overrides. See the [resume API documentation](../backend/README.md#fit-rules-and-template-presets) for fit rules and presets.

## Standalone PDF Editor & Sign Studio

Open `http://localhost:3000/pdf/editor` to access the standalone full-featured PDF Document Editor and Signature tool. This feature operates independently from the resume generator and does not affect existing resume pipelines.

### Features
- **Upload & Multi-Page View**: Upload any existing PDF or start with a blank A4 canvas. Smooth multi-page vertical scroll with page headers, delete page, and append page actions.
- **Document Elements**:
  - **Text**: Add headings, body text, customize font family, font size, bold, italic, underline, color, and alignment.
  - **Shapes**: Rectangle, circle/oval, line, arrow, and whiteout shape to visually cover existing text. The original PDF text remains in the file.
  - **Pen & Highlighter**: Freehand drawing and semi-transparent highlighting.
  - **Table / Grid**: Customizable row $\times$ column grid generator. Double-click a cell to edit its text.
  - **Images**: Upload and insert PNG, JPG, or SVG images with interactive scaling and rotation.
- **Sign PDF Tool**:
  - Select the **Sign PDF** tool in the toolbar and click directly on the PDF page where you want the signature placed.
  - **Draw Signature**: Interactive canvas with smooth Bézier curve interpolation, color presets (Black, Executive Navy, Royal Blue), stroke thickness controls, and a clear button. Undo removes a placed signature.
  - **Upload Signature Image**: Upload a photo or scan of a paper signature. The client-side pixel extraction engine strips the paper background to a clean transparent PNG outline with real-time sensitivity thresholding and optional ink recoloring.
  - Confirmed signatures drop directly at the clicked coordinates as resizable, movable objects.
- **High-Fidelity PDF Export**: Preserves the retained original pages and adds edited content as image overlays using `pdf-lib` in the browser.

See the [PDF editor feature roadmap](docs/pdf_editor_features_roadmap.md).
