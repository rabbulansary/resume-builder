<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

NestJS API for generating resume PDFs, fitting content, and versioning template presets.

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development with watch mode
pnpm dev

# production mode
pnpm build
pnpm start
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observer](https://observer.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

## Resume PDF API

From the workspace root, see the [monorepo setup](../README.md) to run the API and editors together.

The PDF generator uses a pure Node.js in-memory PDF engine (PDFKit) with zero browser or headless Chromium dependencies. It renders deterministic, tagged, ATS-friendly A4 PDFs with instant cold starts and minimal memory consumption (~15–25 MB).

The API listens on port 3001 by default. Configure it in `backend/.env` or set
`BACKEND_PORT` in the environment.

### `POST /resumes/render`

Send an uncompressed `application/json` request up to 100 KiB. The request
requires `schemaVersion: "1.0.0"`, `profile.fullName`, and an ordered
`sections` array. Each section requires an `id`, `title`, and a supported
`type`. Use `content` for `summary` and `items` for `skill_groups`,
`experience`, `projects`, `education`, `certifications`, and `bullet_list`.
See [the full fixture](docs/resume_full.json) for each item shape and the
[validation schema](src/resumes/resume.schema.ts) for field limits.

Each section accepts an optional boolean `visible`. It defaults to `true`.
Set it to `false` to omit the heading, content, and links from the PDF.
Hidden sections still follow the same validation rules.

Skills sections (`type: "skill_groups"`) accept an optional `style`.
Use `"grouped"` (the default) for labeled rows or `"bullets"` for one
bullet per skill value, in the original order. Simple bullets fill each row
left to right and accept `columns` of 2, 3 (default), or 4. Each item has
`values`. A `label` is required for Grouped rows and optional for Simple bullets.

```json
{
  "id": "skills",
  "title": "Skills",
  "type": "skill_groups",
  "visible": true,
  "style": "bullets",
  "columns": 3,
  "items": [{ "values": ["TypeScript", "SQL"] }]
}
```

An education item's `score` is optional and can be omitted or set to `null`.
To keep the score in the JSON and hide its line in the PDF, use
`"score": { "label": "CGPA", "value": "8.4/10", "visible": false }`.
When provided, a score is visible by default.

Optional `document` fields describe the source. Only its language affects
output. Dates use `dateDisplay` as supplied. For certifications, use an
abbreviated month and four-digit year such as `Jan 2026`. Older certification
entries with only `year` display that year. The sample fixtures use January
as a placeholder where the source provided only a year. Education dates are
bold and upright. Phone and email are text. Links supplied explicitly in the contact,
project, and certification fields become PDF annotations.
Each item in `profile.contact.links` accepts an optional boolean `visible`
that defaults to `true`. Set it to `false` to hide that contact link's label
and PDF annotation. LinkedIn, GitHub, and Portfolio can be toggled independently.

Omit `rendering` to use the `classic-ats` defaults. The classic template
uses A4 portrait geometry, 9/14/8/14 mm margins, and the default point sizes
shown in the fixture. **Resume settings → Appearance** lets users change body
font size (8–12 pt), line spacing (1.05–1.60×), and letter spacing
(−0.20–0.80 pt). These settings are saved under `rendering.layout` as
`bodyFontSizePt`, `lineHeight`, and `letterSpacingPt`. Body font size also
applies to bullets and skills. Other appearance options include six-digit hex
colors, allowlisted system fonts, and compact or relaxed section spacing. Fonts fall back
to Liberation Sans and the system sans-serif font. Links accept HTTP,
HTTPS, mailto, and tel URLs. The renderer blocks external resources.

| Status | Response |
| --- | --- |
| 200 | Raw tagged PDF, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="resume.pdf"` |
| 400 | Invalid JSON or resume fields. Schema errors include paths and messages. |
| 413 | Request exceeds 100 KiB. |
| 415 | Unsupported content type or request encoding. |
| 500 | PDF generation failed. |
| 503 | Both render slots are busy. Retry shortly. |
| 504 | Rendering exceeded the 15-second deadline. |

```bash
curl --fail-with-body \
  -H 'Content-Type: application/json' \
  --data-binary @docs/resume_full.json \
  http://localhost:3001/resumes/render \
  --output resume.pdf
```

Run `pnpm test` for validation and HTML checks and `pnpm test:e2e` for the
HTTP, PDF, and overflow checks. The fixtures include the full resume, a
student resume, and an experienced professional resume.

## Fit rules and template presets

The built-in `classic-ats` preset defaults to one page and keeps education.
The editor can override the page limit, education exclusion, and the
priority, protection, and item limit for each section type. Student presets
apply when `document.contentVariant` is `student-fresher`. Overrides apply
in this order, from lowest to highest precedence: preset, student overrides,
resume settings.

The layout engine applies item limits, then removes lower-priority content
first if the generated PDF still exceeds the target. Ties favor
keeping earlier sections and entries. Original order is preserved in the
output. To protect specific entries in a section, provide their zero-based
indexes in `protectedItemIndexes`. A protected section keeps all its entries.
Education is eligible for reduction only when education exclusion is enabled
and the relevant content is unprotected. Manual visibility choices still apply.

| Endpoint | Purpose |
| --- | --- |
| `GET /resumes/templates` | List active presets and their latest versions |
| `GET /resumes/templates/:id?version=1` | Read a pinned version, or omit the query for the latest active version |
| `POST /resumes/templates` | Create a preset with `{ id, config }` |
| `PUT /resumes/templates/:id` | Add a version with `{ expectedVersion, config }` |
| `DELETE /resumes/templates/:id?version=2` | Archive the preset if the latest version matches |
| `POST /resumes/preview` | Return a base64-encoded PDF and a fit report |
| `POST /resumes/export/pdf` | Download a fitted PDF, or return 422 with the report when it overflows |
| `POST /resumes/export/json` | Download a round-trippable JSON document with a pinned preset version |

The preview and export endpoints accept `{ resume, template?, layout? }`.
`template` takes `{ id, version? }`. `layout` optionally overrides
`maxPages`, `allowEducationExclusion`, and `sections`, which is keyed by
section type. Each section rule can set `priority` (0–100, higher is kept
first), `maxItems` (0–100), and `protected` (boolean). The report includes
page count after item limits, final page count, measured content height,
overflow status, excluded items, and warnings. The existing
`POST /resumes/render` continues to accept a plain resume and render all
visible content without applying fit rules.

The read-only default configuration lives in
[`default-template.json`](src/resumes/templates/default-template.json).
Custom presets use atomic file writes under `RESUME_TEMPLATE_DIR`, which
defaults to `.resume-templates` in the working directory. Use a persistent
directory with a single application instance. Updates require the current
version, and archived presets remain readable by explicit version so saved
JSON exports can still be opened. Preset management is intended for a local
or access-controlled deployment. Resume contents and generation history
are kept out of server storage.
