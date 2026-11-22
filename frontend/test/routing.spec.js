import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('home opens both canonical editor URLs', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Student resume builder' }).click();
    await expect(page).toHaveURL(/\/resume\/editor$/);
    await expect(page.getByRole('heading', { name: 'Student resume builder' })).toBeVisible();
    await page.goto('/');
    await page.getByRole('link', { name: 'PDF editor and signing studio' }).click();
    await expect(page).toHaveURL(/\/pdf\/editor$/);
    await expect(page).toHaveTitle(/PDF Document Studio/);
});

test('legacy editor bookmarks redirect to the canonical routes', async ({ request }) => {
    for (const [oldPath, newPath] of [
        ['/resumes/editor', '/resume/editor'],
        ['/pdf-editor', '/pdf/editor'],
    ]) {
        const response = await request.get(oldPath, { maxRedirects: 0 });
        expect(response.status()).toBe(308);
        expect(response.headers().location).toBe(newPath);
    }
});

test('both editors use the shared shell and can switch between workspaces', async ({ page }) => {
    await page.goto('/resume/editor');
    await expect(page.locator('.editor-header')).toContainText('Student resume builder');
    await expect(page.locator('.editor-footer').getByRole('link', { name: 'Preview', exact: true })).toBeVisible();
    const handle = page.getByRole('button', { name: 'Switch Workspace' });
    await handle.press('Enter');
    const workspaces = page.getByRole('navigation', { name: 'Workspaces' });
    await expect(workspaces.locator('[aria-current="page"]')).toHaveAttribute('href', '/resume/editor');
    await workspaces.locator('[href="/pdf/editor"]').click();
    await expect(page.getByRole('dialog', { name: 'Switch editors?' })).toBeVisible();
    await page.getByRole('button', { name: 'Switch editor', exact: true }).click();
    await expect(page).toHaveURL(/\/pdf\/editor$/);
    await expect(page.locator('.editor-header')).toContainText('PDF Editor & Sign');
    await page.locator('#btn-start-blank').click();
    await expect(page.locator('.editor-footer')).toContainText('Page 1 / 1');
    await handle.press('Enter');
    await expect(workspaces.locator('[aria-current="page"]')).toHaveAttribute('href', '/pdf/editor');
    await workspaces.locator('[href="/resume/editor"]').click();
    await page.getByRole('button', { name: 'Switch editor', exact: true }).click();
    await expect(page).toHaveURL(/\/resume\/editor$/);
});

test('Next serves both documents, stylesheets and local PDF libraries', async ({ request }) => {
    for (const [route, title] of [
        ['/resume/editor', 'Student resume builder'],
        ['/pdf/editor', 'PDF Document Studio & Sign'],
    ]) {
        const document = await request.get(route);
        expect(document.ok()).toBe(true);
        expect(document.headers()['content-type']).toContain('text/html');
        expect(document.headers()['content-security-policy']).toContain("default-src 'none'");
        expect(document.headers()['cache-control']).toContain('no-store');
        expect(await document.text()).toContain(title);
    }
    for (const path of ['/resumes/editor.css', '/pdf-editor/pdf-editor.css']) {
        const css = await request.get(path);
        expect(css.ok()).toBe(true);
        expect(css.headers()['content-type']).toContain('text/css');
        expect((await css.text()).length).toBeGreaterThan(1000);
    }
    for (const path of [
        '/editor-shell/workspace.js',
        '/resumes/editor.js',
        '/pdf-editor/js/pdf-editor.js',
        '/resumes/vendor/pdf.min.mjs',
        '/resumes/vendor/pdf.worker.min.mjs',
        '/pdf-editor/vendor/pdf.min.mjs',
        '/pdf-editor/vendor/pdf.worker.min.mjs',
        '/pdf-editor/vendor/fabric.min.js',
        '/pdf-editor/vendor/pdf-lib.min.js',
    ]) {
        const script = await request.get(path);
        expect(script.ok()).toBe(true);
        expect(script.headers()['content-type']).toContain('javascript');
        expect((await script.text()).length).toBeGreaterThan(1000);
    }
    expect((await request.get('/resumes/vendor/missing.mjs')).status()).toBe(404);
});

test('Next forwards API requests, validation errors and PDF attachments to and from Nest', async ({ request }) => {
    const resume = {
        schemaVersion: '1.0.0',
        profile: { fullName: 'Migration Tester' },
        sections: [{ id: 'projects', type: 'projects', title: 'Projects', items: [{ name: 'Portfolio' }] }],
    };
    const templates = await request.get('/resumes/templates');
    expect(templates.ok()).toBe(true);
    expect(await templates.json()).toContainEqual(expect.objectContaining({ id: 'classic-ats', version: 1 }));
    const pinned = await request.get('/resumes/templates/classic-ats?version=1');
    expect(pinned.ok()).toBe(true);
    expect(await pinned.json()).toMatchObject({ id: 'classic-ats', version: 1 });
    expect((await request.get('/resumes/templates/classic-ats?version=999')).status()).toBe(404);
    expect((await request.post('/resumes/preview', { data: {} })).status()).toBe(400);
    expect((await request.post('/resumes/preview', { data: { resume, oversize: 'a'.repeat(103_000) } })).status()).toBe(
        413,
    );
    for (const [route, data] of [
        ['render', resume],
        ['export/pdf', { resume }],
    ]) {
        const pdf = await request.post(`/resumes/${route}`, { data });
        expect(pdf.ok()).toBe(true);
        expect(pdf.headers()['content-disposition']).toBe('attachment; filename="resume.pdf"');
        expect((await PDFDocument.load(await pdf.body())).getPageCount()).toBe(1);
    }
});
