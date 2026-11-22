# Resume Builder and PDF Editor

- [Frontend](frontend/README.md) runs both editors in Next.js. The standalone PDF editor processes documents and signatures in the browser.
- [Backend](backend/README.md) runs the NestJS resume APIs for validation, rendering, layout, export, and versioned presets.

## Development

Use Node.js 24 and pnpm 10.32.1. From the repository root, run

```sh
pnpm install
pnpm dev
```

Turborepo starts both workspaces. Open the [frontend](http://localhost:3000), the [resume builder](http://localhost:3000/resume/editor), or the [PDF editor](http://localhost:3000/pdf/editor). Nest listens on port 3001. The frontend forwards resume API routes to Nest on the same browser origin.

In an interactive terminal, Turbo shows `@resume-builder/backend#dev` and `@resume-builder/frontend#dev` in the task sidebar. Use the up and down arrow keys to switch between their live logs.

Use [backend/.env.example](backend/.env.example) for backend configuration. For a custom local API port, export `BACKEND_PORT` before running Turbo so both workspaces use it. Set `BACKEND_ORIGIN` for a separately hosted API. Next.js reads the origin at dev startup and embeds it in the production build. Set `RESUME_TEMPLATE_DIR` to the absolute path of your existing preset directory if you already have custom presets. The default directory is now `backend/.resume-templates`.

## Production

```sh
pnpm build
pnpm start
```

## Verification

```sh
pnpm lint
pnpm test
pnpm --filter @resume-builder/frontend exec playwright install chromium
pnpm test:e2e
```

The end-to-end command runs the Nest API suite and opens both apps on local test ports for Playwright. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed Chrome or Chromium binary to use it for the browser suite.
