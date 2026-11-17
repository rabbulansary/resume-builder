# LLM implementation prompt — NestJS resume JSON to PDF engine

You are a senior NestJS/TypeScript backend engineer and PDF layout specialist. Build a production-quality JSON-driven Resume PDF Generator in the existing NestJS project. The input fixture is `resume_full.json` (provided), extracted from `Sample_Resume.pdf` (provided). Inspect the project conventions and existing dependencies first; follow established patterns instead of creating a parallel architecture.

## Objective
Implement an endpoint accepting a structured resume JSON document and returning an ATS-friendly, selectable-text PDF. The default `classic-ats` template should visually reproduce the reference resume: A4 portrait; centered bold uppercase name, navy job headline and horizontal divider; inline contact details with real clickable links; navy all-caps section titles with thin navy rules; dense, clean typographic hierarchy; right-aligned dates; bullets; italic employer/education metadata where appropriate; skill-group label/value rows; underlined project and certification links; minimal whitespace. Aim for close visual fidelity while ensuring readable output and graceful multipage overflow. DO NOT rasterize the resume or insert the reference PDF as an image. Do not hard-code Aarav Sharma's personal data inside the template.

## Mandatory exact layout and typography specification (override any earlier defaults)
The reference is a single A4 portrait page **210 × 297 mm**. Use **exact page margins**: top **9 mm**, right **14 mm**, bottom **8 mm**, left **14 mm**. The usable content rectangle is therefore **182 × 280 mm**. All font sizes below are **points (pt), not CSS px**. Apply these tokens in CSS with `pt` units; do not allow inherited `em` or browser scaling to change their absolute sizes. Use `@page { size: A4 portrait; margin: 9mm 14mm 8mm 14mm; }`, disable Playwright PDF header/footer, and avoid extra body margins. Use the `rendering.typography` JSON tokens as the authoritative source, with the following values as validated defaults.

| Element | Exact size | Weight and presentation |
| --- | --- | --- |
| Full name (e.g., AARAV SHARMA) | **22 pt** | **Bold (700)**, uppercase, centered |
| Professional title (e.g., Data Analyst) | **11.5 pt** | **Bold (700)**, navy, centered |
| Contact line | **9 pt** | Regular (400), centered |
| Section headings (SKILLS, PROJECTS, etc.) | **11 pt** | **Bold (700)**, navy, all caps; thin divider |
| Job titles, project names, degree titles | **9.8 pt** | **Bold (700)** |
| Company names and education CGPA/score lines | **9 pt** | *Italic (400)*, navy |
| Dates, except education dates | **9.2 pt** | **Bold (700)**, right aligned |
| Education dates | **9.2 pt** | **Bold italic (700)*, right aligned; education-specific override |
| Body paragraphs, bullet text and skills | **9.2 pt** | Regular (400) |

Requirements:
- Never confuse points and pixels: CSS `font-size: 9.2pt`, not `9.2px` or a 9.2px-equivalent. In Playwright PDF output use `scale: 1` and honor CSS page size.
- Company/institution metadata and education CGPA/percentage score lines use the 9pt italic navy style. Keep separate qualification/degree titles at 9.8pt bold. Do not render all education metadata as a bold title.
- Apply education date styling specifically, without accidentally italicizing dates on internships, projects or certifications.
- Dates align to the **right edge of the usable content area**, not the physical paper edge; long left-side titles must wrap without colliding with dates. Prefer grid/flex with a minimum-width date column.
- Navy references the JSON `rendering.colors.primary` token (`#1F3A68` by default); do not improvise unrelated colors. Body text remains the configured dark text.
- Preserve all text, clickable hyperlinks, separators, bullets, and section ordering. Control vertical spacing and line height to resemble the source without modifying specified font sizes or margins. If content overflows A4, generate a second page instead of scaling text or clipping.
- Add automated tests inspecting CSS tokens and PDF MediaBox A4 dimensions, page margins, font sizing, title alignment, date style distinctions, and page overflow. Include visual comparison to reference.

## Architecture and implementation
1. Add a module with controller, service, strict DTO/schema validation, template renderer, and PDF renderer. Prefer Zod with inferred TypeScript types if the project uses Zod; otherwise integrate class-validator/class-transformer consistently. Support the exact `schemaVersion`, `profile`, ordered `sections`, and `rendering` structure in the fixture. Model sections as a discriminated union by `type` (`summary`, `skill_groups`, `experience`, `projects`, `education`, `certifications`, `bullet_list`). Preserve section and item order. Handle optional links, empty lists, missing optional metadata, Unicode, long entries, and multi-page rendering. Reject malformed/unknown section types with actionable 400 errors rather than silently losing content.
2. Use server-side HTML templates with escaped values and CSS @page plus Playwright/Chromium for PDF generation (`page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true })` when supported by installed version). Use a single Chromium instance per application or a bounded browser pool; close pages and clean resources in finally blocks. Ensure the deployment image includes the correct Chromium dependencies. In Docker, configure browser binaries and sandboxing securely; avoid disabling sandbox unless necessary and justified. Do not use an LLM to generate raw HTML/CSS on every request.
3. Expose `POST /resumes/render` with JSON body, Content-Type: application/pdf, Content-Disposition: attachment; filename="resume.pdf", and raw PDF bytes as response. Optional `POST /resumes/preview` can return the rendered HTML or a PNG for local development, subject to existing project routing. Validate request sizes and apply timeouts, concurrency limits, and appropriate error handling. Protect against CSS/HTML/URL/script injection. Only permit safe href schemes (https:, http:, mailto:, tel:); prevent `file:`, `javascript:`, remote resources and local-file access; HTML-escape all user content. Limit any font/image URL feature to a controlled allowlist or leave it disabled. Do not log sensitive resume content.
4. All data must come from JSON. Render header links, project links, and certificate links as working PDF hyperlinks. Keep dates exactly as `dateDisplay`; do not recompute or alter text. Preserve original wording/spelling (e.g., 'analysed', 'visualised'), metrics, punctuation, and section order. Print technologies after each project using `Tech/Tools Used:`. Render education `score` labels/values and certificates' issuers, duration, and year. Do not invent missing data.
5. Use configurable design tokens (fonts, navy colors, margins, exact point sizes, compact spacing) from `rendering` with the mandatory typography/page values above as validated defaults, while retaining style consistency. Enforce sensible limits and prevent page breaks immediately after section headings or inside the first line of a role/project. Allow a page break within a very long description instead of clipping it. Never shrink to illegible font sizes or silently truncate content. Use system fonts or bundled open-licensed fonts that are safe to redistribute.
6. Provide a deterministic, testable rendering engine. Keep data normalization/validation separate from templates and PDF emission. If implementing optional LLM extraction from free-form text into JSON, make it a separate service with structured-output schema validation and deterministic retries; it must not fabricate missing information and must never be required for JSON-to-PDF generation.

## Deliverables
- Actual working NestJS source files, templates/CSS, dependency changes, configuration and (if relevant) Docker instructions.
- The route's request/response contract and OpenAPI/Swagger docs if the project supports Swagger.
- An example curl command that uses `resume_full.json` as the POST body and saves `resume.pdf`.
- Unit tests for JSON validation, escaping and section dispatch; integration test verifying a nonempty PDF buffer that starts with `%PDF`; PDF text extraction test confirming every section and important content is present; hyperlink annotation checks; and multipage/overflow tests.
- Render the exact input fixture and inspect a PNG screenshot of the PDF against the supplied reference, then adjust layout until text is legible and no content overlaps, clips, or unexpectedly disappears. State any visual differences from the reference explicitly.

## Suggested acceptance tests
- All seven sections render in the JSON order; all 2 internships, 3 projects, 2 education entries, 4 certifications and 3 awards are present.
- PDF retains 9 real clickable links (3 header + 2 project + 4 certifications).
- Special characters (en dashes, accents, ampersands, apostrophes) display correctly.
- The PDF contains real searchable/selectable text and prints reliably on A4 paper.
- Invalid schema, missing required name, unsafe URLs, and unsupported types fail with clear, safe errors.
- A longer synthetic resume generates multiple pages without clipped content.

Do not stop at a design proposal. Implement and test the feature end to end in the repository, using the provided reference and fixture as authoritative data sources. If any behavior is ambiguous, make a reasonable documented assumption. Do not modify unrelated modules.
