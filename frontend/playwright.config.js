import { defineConfig } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendPort = process.env.RESUME_E2E_BACKEND_PORT ?? '3101';
const frontendPort = process.env.RESUME_E2E_FRONTEND_PORT ?? '3100';
const backendOrigin = `http://127.0.0.1:${backendPort}`;
const baseURL = `http://127.0.0.1:${frontendPort}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const templateDirectory = mkdtempSync(join(tmpdir(), 'resume-builder-e2e-'));
process.once('exit', () => rmSync(templateDirectory, { recursive: true, force: true }));

export default defineConfig({
    testDir: './test',
    use: {
        baseURL,
        viewport: { width: 1440, height: 1000 },
        launchOptions: { executablePath },
        trace: 'retain-on-failure',
    },
    webServer: [
        {
            command: 'pnpm dev',
            cwd: fileURLToPath(new URL('../backend/', import.meta.url)),
            env: {
                BACKEND_PORT: backendPort,
                RESUME_TEMPLATE_DIR: templateDirectory,
            },
            url: backendOrigin,
            timeout: 60_000,
        },
        {
            command: `pnpm dev --hostname 127.0.0.1 --port ${frontendPort}`,
            env: { BACKEND_ORIGIN: backendOrigin, NEXT_TELEMETRY_DISABLED: '1' },
            url: baseURL,
            timeout: 60_000,
        },
    ],
});
