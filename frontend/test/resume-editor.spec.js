import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const fixture = fileURLToPath(new URL('../../backend/docs/student_fresher_resume.json', import.meta.url));
const nav = (page, name) =>
    page.getByRole('navigation', { name: 'Resume sections' }).getByRole('button', { name, exact: true });
const panel = (page) => page.locator('#fields > :not([hidden])');
const label = (page, name) =>
    panel(page)
        .getByLabel(name, { exact: true })
        .or(panel(page).getByRole('combobox', { name, exact: true }));

async function download(page, selector) {
    const pending = page.waitForEvent('download');
    await page.locator(selector).click();
    const result = await pending;
    return { filename: result.suggestedFilename(), bytes: await readFile(await result.path()) };
}

async function loadEditor(page) {
    const templates = page.waitForResponse((response) => response.url().endsWith('/resumes/templates'));
    await page.goto('/resume/editor');
    expect((await templates).ok()).toBe(true);
    await nav(page, 'Resume settings').click();
    await expect(label(page, 'Template preset')).toContainText(/Classic ATS/i);
    await nav(page, 'Profile & contact').click();
}

test('builds a resume with every section, link, and edit control, then exports PDF and JSON', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await loadEditor(page);
    await expect(page.locator('#download-pdf')).toBeDisabled();
    await label(page, 'Full name').fill('Migration Student');
    await expect(page.getByRole('alert')).toBeVisible();
    await label(page, 'Headline').fill('Frontend developer');
    await label(page, 'Email').fill('student@example.org');
    await label(page, 'Phone').fill('+1 555 0100');
    await label(page, 'Location').fill('Kolkata');
    await panel(page).getByRole('button', { name: 'Add LinkedIn' }).click();
    await label(page, 'Link URL').fill('https://www.linkedin.com/in/student');
    await label(page, 'Show link').uncheck();

    await nav(page, 'Summary').click();
    await label(page, 'Summary').fill('Builds accessible web applications.');
    await nav(page, 'Skills').click();
    await panel(page).getByRole('button', { name: 'Add entry' }).click();
    await label(page, 'Skills style').selectOption('bullets');
    await label(page, 'Bullet columns').selectOption('2');
    await panel(page).getByRole('button', { name: 'Switch to plain text' }).click();
    await panel(page)
        .getByPlaceholder(/type or paste skills/i)
        .fill('JavaScript, CSS');

    await nav(page, 'Experience').click();
    await panel(page).getByRole('button', { name: 'Add entry' }).click();
    await label(page, 'Role').fill('Intern');
    await label(page, 'Organization').fill('Example Studio');
    await panel(page).getByRole('button', { name: 'Switch to plain text' }).click();
    await panel(page)
        .getByPlaceholder(/type or paste highlights/i)
        .fill('Improved accessibility\nWrote tests');
    await label(page, 'Protect entry from reduction').check();

    await nav(page, 'Projects').click();
    await panel(page).getByRole('button', { name: 'Add entry' }).click();
    await label(page, 'Project name').fill('Portfolio');
    await panel(page).getByRole('button', { name: 'Add project link' }).click();
    await label(page, 'Link label').fill('Source');
    await label(page, 'Link URL').fill('https://example.org/project');
    await label(page, 'Show section').uncheck();
    await expect(page.getByRole('alert')).toBeVisible();
    await label(page, 'Show section').check();

    await nav(page, 'Education').click();
    await panel(page).getByRole('button', { name: 'Add entry' }).click();
    await label(page, 'Qualification').fill('BSc');
    await panel(page).getByRole('button', { name: 'Add score' }).click();
    await label(page, 'Score value').fill('8.5');
    await label(page, 'Show score').uncheck();

    await nav(page, 'Certifications').click();
    await panel(page).getByRole('button', { name: 'Add entry' }).click();
    await label(page, 'Certification name').fill('Web Accessibility');
    await label(page, 'Certificate URL').fill('https://example.org/certificate');

    await nav(page, 'Achievements').click();
    await panel(page).getByRole('button', { name: 'Add entry' }).click();
    await label(page, 'Achievement').fill('Hackathon finalist');
    await panel(page).getByText('Fit settings', { exact: true }).click();
    await label(page, 'Item limit (blank uses preset)').fill('0');

    await nav(page, '+ Add section').click();
    await label(page, 'Section type').selectOption('education');
    await panel(page).getByRole('button', { name: 'Add section', exact: true }).click();
    await expect(nav(page, 'Education 2')).toBeVisible();
    await panel(page).getByRole('button', { name: 'Add entry' }).click();
    await panel(page).getByRole('button', { name: 'Remove entry' }).click();
    await panel(page).getByRole('button', { name: 'Remove section' }).click();
    await expect(nav(page, 'Education 2')).toHaveCount(0);

    await nav(page, 'Resume settings').click();
    await label(page, 'Resume type').selectOption('experienced-professional');
    await label(page, 'Maximum pages (blank uses preset)').fill('2');
    await label(page, 'Education exclusion').selectOption('true');
    await panel(page).getByText('Appearance', { exact: true }).click();
    await label(page, 'Body font size (pt)').fill('10');
    await expect(page.locator('#fit')).toHaveText('1 / 2 pages');
    await expect(page.locator('#preview-pages canvas')).toBeVisible();
    await page.getByText(/Excluded content/).click();
    await expect(page.locator('#excluded-items')).toContainText('Hackathon finalist');

    const pdf = await download(page, '#download-pdf');
    expect(pdf.filename).toBe('resume.pdf');
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(1);
    const json = await download(page, '#download-json');
    expect(json.filename).toBe('resume.json');
    expect(JSON.parse(json.bytes)).toMatchObject({
        resume: {
            profile: { fullName: 'Migration Student' },
            document: { contentVariant: 'experienced-professional' },
        },
        template: { id: 'classic-ats', version: 1 },
        layout: { maxPages: 2, allowEducationExclusion: true, sections: { bullet_list: { maxItems: 0 } } },
    });
    const printTab = page.context().waitForEvent('page');
    await page.locator('#print').click();
    const printer = await printTab;
    await expect(printer).toHaveURL(/^blob:/);
    await printer.close();

    await page.reload();
    await page
        .locator('#import')
        .setInputFiles({ name: json.filename, mimeType: 'application/json', buffer: json.bytes });
    await expect(label(page, 'Full name')).toHaveValue('Migration Student');
    await expect(page.locator('#fit')).toHaveText('1 / 2 pages');
    expect(errors).toEqual([]);
});

test('imports a plain fixture and navigates the preview and editor on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadEditor(page);
    await page
        .locator('#import')
        .setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    await expect(page.getByRole('alert')).toBeVisible();
    await page.locator('#import').setInputFiles(fixture);
    await expect(page.locator('#preview-pages canvas').first()).toBeVisible();
    await page.getByRole('link', { name: 'Preview', exact: true }).click();
    await expect(page).toHaveURL(/#preview-pane$/);
    await page.getByRole('link', { name: 'Back to editor' }).click();
    await expect(page).toHaveURL(/#editor$/);
});

test('displays overflow and blocks PDF actions until the page limit is increased', async ({ page }) => {
    await loadEditor(page);
    const file = {
        resume: {
            schemaVersion: '1.0.0',
            profile: { fullName: 'Overflow Example' },
            sections: [
                { id: 'projects', type: 'projects', title: 'Projects', items: [{ name: 'Portfolio' }] },
                {
                    id: 'experience',
                    type: 'experience',
                    title: 'Experience',
                    protectedItemIndexes: [0],
                    items: [
                        {
                            role: 'Intern',
                            bullets: Array.from({ length: 2 }, () =>
                                'Contributed to the project and documented the results.\n'.repeat(48),
                            ),
                        },
                    ],
                },
            ],
        },
    };
    await page.locator('#import').setInputFiles({
        name: 'overflow.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(file)),
    });
    await expect(page.locator('#fit')).toHaveText('2 / 1 pages');
    await expect(page.locator('#download-pdf')).toBeDisabled();
    await expect(page.locator('#print')).toBeDisabled();
    await nav(page, 'Resume settings').click();
    await label(page, 'Maximum pages (blank uses preset)').fill('2');
    await expect(page.locator('#fit')).toHaveText('2 / 2 pages');
    await expect(page.locator('#preview-pages canvas')).toHaveCount(2);
    await expect(page.locator('#download-pdf')).toBeEnabled();
});

test('lists and applies a saved preset through the Next.js origin', async ({ page, request }) => {
    const path = '/resumes/templates/browser-qa';
    const config = { name: 'Browser QA', maxPages: 2, allowEducationExclusion: false, sections: {} };
    expect(
        (
            await request.post('/resumes/templates', {
                data: { id: 'browser-qa', config: { ...config, maxPages: 1 } },
            })
        ).status(),
    ).toBe(201);
    expect((await request.put(path, { data: { expectedVersion: 1, config } })).status()).toBe(200);

    await loadEditor(page);
    await page.locator('#import').setInputFiles(fixture);
    await expect(page.locator('#download-pdf')).toBeEnabled();
    await nav(page, 'Resume settings').click();
    await label(page, 'Template preset').selectOption('browser-qa@2');
    await expect(page.locator('#fit')).toHaveText('1 / 2 pages');
    const json = JSON.parse((await download(page, '#download-json')).bytes);
    expect(json.template).toEqual({ id: 'browser-qa', version: 2 });

    expect((await request.delete(`${path}?version=2`)).status()).toBe(204);
    expect((await request.get(path)).status()).toBe(404);
    expect((await request.get(`${path}?version=2`)).status()).toBe(200);
});
