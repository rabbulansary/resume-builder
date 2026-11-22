import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

function canvas(page, index = 0) {
    return page.locator(`#pages-viewport > [data-page-index="${index}"] .upper-canvas`);
}

async function drawStroke(page, target, x, y) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    await page.mouse.move(box.x + x, box.y + y);
    await page.mouse.down();
    await page.mouse.move(box.x + x + 70, box.y + y + 20, { steps: 8 });
    await page.mouse.move(box.x + x + 125, box.y + y, { steps: 8 });
    await page.mouse.up();
}

async function exportPdf(page) {
    const pending = page.waitForEvent('download', { timeout: 6000 });
    await page.locator('#btn-export-pdf').click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('document_edited.pdf');
    return PDFDocument.load(await readFile(await download.path()));
}

async function startBlank(page) {
    await page.goto('/pdf/editor');
    await page.locator('#btn-start-blank').click();
    await expect(canvas(page)).toBeVisible();
}

test('keeps document actions floating inside the canvas while scrolling', async ({ page }) => {
    await startBlank(page);
    const actions = page.getByRole('group', { name: 'PDF document actions' });
    await expect(page.locator('header').getByRole('button')).toHaveCount(0);
    const box = await actions.boundingBox();
    const workspace = page.locator('#workspace-container');
    await expect(page.locator('main').getByRole('group', { name: 'PDF document actions' })).toBeVisible();
    expect(box.y).toBeGreaterThan((await workspace.boundingBox()).y);

    for (const name of ['Upload PDF', 'Add Page', 'Download PDF']) {
        const button = actions.getByRole('button', { name, exact: true });
        await expect(button).toHaveText('');
        expect(await button.evaluate((element) => getComputedStyle(element, '::after').display)).toBe('none');
        await button.hover();
        const tooltip = await button.evaluate((element) => {
            const style = getComputedStyle(element, '::after');
            return { display: style.display, content: style.content };
        });
        expect(tooltip).toEqual({ display: 'block', content: JSON.stringify(name) });
    }

    const input = page.waitForEvent('filechooser');
    await actions.getByRole('button', { name: 'Upload PDF' }).click();
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await (await input).setFiles({
        name: 'floating-toolbar.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await pdf.save()),
    });
    await expect(page.locator('#doc-meta')).toContainText('floating-toolbar.pdf');
    await expect(canvas(page)).toBeVisible();

    await actions.getByRole('button', { name: 'Add Page' }).click();
    await workspace.evaluate((element) => { element.scrollTop = 350; });
    await expect.poll(() => workspace.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await actions.boundingBox()).toEqual(box);
    expect((await exportPdf(page)).getPageCount()).toBe(2);

    for (const width of [1440, 700, 390]) {
        await page.setViewportSize({ width, height: 700 });
        await expect(actions.getByRole('button', { name: 'Download PDF' })).toBeVisible();
        const toolbar = await actions.boundingBox();
        const viewport = await workspace.boundingBox();
        expect(viewport.y).toBe((await page.locator('main').boundingBox()).y);
        expect(toolbar.y).toBeGreaterThan(viewport.y);

        await workspace.evaluate((element) => {
            const canvas = element.querySelector('.upper-canvas');
            element.scrollTop += canvas.getBoundingClientRect().top - element.getBoundingClientRect().top + 20;
        });
        const pageBox = await canvas(page).boundingBox();
        expect(pageBox.y).toBeLessThan(viewport.y);
        expect(pageBox.y + pageBox.height).toBeGreaterThan(toolbar.y + toolbar.height);
        expect(await actions.boundingBox()).toEqual(toolbar);

        const x = (Math.max(pageBox.x, viewport.x) + toolbar.x) / 2;
        const y = toolbar.y + toolbar.height / 2;
        expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('upper-canvas'), { x, y })).toBe(true);
    }
});

test('starts a blank PDF and supports zoom, panning, grid, and page navigation', async ({ page }) => {
    await startBlank(page);
    await expect(page.locator('#page-nav-label')).toHaveText('Page 1 / 1');
    await page.locator('#btn-zoom-in').click();
    await expect(page.locator('#zoom-input')).toHaveValue('115%');
    await page.locator('#btn-zoom-out').click();
    await expect(page.locator('#zoom-input')).toHaveValue('100%');
    await page.locator('#btn-fit-width').click();
    await expect(page.locator('#zoom-input')).not.toHaveValue('100%');
    await page.locator('#zoom-input').fill('75');
    await page.locator('#zoom-input').press('Enter');
    await expect(page.locator('#zoom-input')).toHaveValue('75%');
    await page.locator('#btn-toggle-grid').click();
    await expect(page.locator('.guidelines-grid')).toBeVisible();
    await page.locator('#btn-toggle-grid').click();
    await expect(page.locator('.guidelines-grid')).toBeHidden();
    await page.locator('#btn-add-page').click();
    await page.locator('#btn-next-page').click();
    await expect(page.locator('#page-nav-label')).toHaveText('Page 2 / 2');
    await page.locator('#btn-prev-page').click();
    await expect(page.locator('#page-nav-label')).toHaveText('Page 1 / 2');
    await page.keyboard.press('h');
    await expect(page.locator('#tool-hand')).toHaveClass(/btn-tool-active/);
    await drawStroke(page, canvas(page), 160, 300);
    await page.keyboard.press('h');
    await expect(page.locator('#tool-select')).toHaveClass(/btn-tool-active/);
    await page.locator('.btn-delete-page[data-page-index="1"]').click();
    await expect(page.locator('#page-nav-label')).toHaveText('Page 1 / 1');
    expect((await exportPdf(page)).getPageCount()).toBe(1);
});

test('pans all four PDF edges to the canvas center at wider viewport sizes', async ({ page }) => {
    for (const width of [700, 1440]) {
        await page.setViewportSize({ width, height: 700 });
        await startBlank(page);
        const workspace = page.locator('#workspace-container');
        const viewport = await workspace.boundingBox();
        const centerX = viewport.x + viewport.width / 2;
        const centerY = viewport.y + viewport.height / 2;
        const editingCanvas = canvas(page);
        await expect.poll(async () => (await editingCanvas.boundingBox()).y).toBeLessThan(centerY);
        await page.getByRole('button', { name: 'Hand', exact: true }).click();

        const drag = async (fromX, fromY, toX, toY) => {
            await page.mouse.move(fromX, fromY);
            await page.mouse.down();
            await page.mouse.move(toX, toY, { steps: 4 });
            await page.mouse.up();
        };
        const left = viewport.x + viewport.width / 4;
        const right = viewport.x + viewport.width * 3 / 4;
        await drag(left, centerY, right, centerY);
        await drag(left, centerY, right, centerY);
        await expect.poll(async () => (await editingCanvas.boundingBox()).x).toBeGreaterThanOrEqual(centerX - 1);

        for (let gesture = 0; gesture < 3; gesture++) {
            await drag(right, centerY, left, centerY);
        }
        await expect.poll(async () => {
            const box = await editingCanvas.boundingBox();
            return box.x + box.width;
        }).toBeLessThanOrEqual(centerX + 1);

        await drag(centerX, centerY - 140, centerX, centerY + 170);
        await expect.poll(async () => (await editingCanvas.boundingBox()).y).toBeGreaterThanOrEqual(centerY - 1);
        await workspace.evaluate((element) => {
            element.scrollTop = element.scrollHeight - element.clientHeight - 60;
        });
        await drag(centerX, centerY + 70, centerX, centerY - 70);
        await expect.poll(async () => {
            const box = await editingCanvas.boundingBox();
            return box.y + box.height;
        }).toBeLessThanOrEqual(centerY + 1);
    }
});

test('pans all four PDF edges to the canvas center with mobile touch', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 680 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
    });
    try {
        const page = await context.newPage();
        await startBlank(page);
        const zoom = page.locator('#zoom-input');
        await zoom.fill('81');
        await zoom.press('Enter');
        await page.getByRole('button', { name: 'Hand', exact: true }).tap();

        const workspace = page.locator('#workspace-container');
        const editingCanvas = canvas(page);
        const leftDock = await page.locator('#dock-tools').boundingBox();
        const actions = await page.getByRole('group', { name: 'PDF document actions' }).boundingBox();
        expect((await editingCanvas.boundingBox()).y).toBeGreaterThan(actions.y + actions.height);
        const cdp = await context.newCDPSession(page);
        const swipe = async (fromX, fromY, toX, toY) => {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: fromY }] });
            for (const fraction of [0.25, 0.5, 0.75, 1]) {
                await cdp.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [{ x: fromX + fraction * (toX - fromX), y: fromY + fraction * (toY - fromY) }],
                });
            }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };

        const workspaceBox = await workspace.boundingBox();
        const centerX = workspaceBox.x + workspaceBox.width / 2;
        const centerY = workspaceBox.y + workspaceBox.height / 2;
        const openingScrollLeft = await workspace.evaluate((element) => element.scrollLeft);
        await swipe(185, 320, 185, 495);
        await expect.poll(async () => (await editingCanvas.boundingBox()).y).toBeGreaterThanOrEqual(centerY);
        await swipe(185, 495, 185, 320);

        await expect.poll(async () => (await editingCanvas.boundingBox()).x).toBeGreaterThan(leftDock.x + leftDock.width);
        await swipe(300, 440, 95, 340);
        await swipe(300, 440, 95, 340);
        await expect.poll(async () => {
            const box = await editingCanvas.boundingBox();
            return box.x + box.width;
        }).toBeLessThanOrEqual(centerX + 1);
        await expect.poll(() => workspace.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await swipe(95, 340, 300, 440);
        await swipe(95, 340, 300, 440);
        await swipe(95, 340, 300, 440);
        await expect.poll(async () => (await editingCanvas.boundingBox()).x).toBeGreaterThanOrEqual(centerX - 1);
        await expect(workspace).not.toHaveClass(/is-panning/);

        await workspace.evaluate((element, left) => { element.scrollLeft = left; }, openingScrollLeft);
        await page.locator('#tool-draw').press('Enter');
        await expect(editingCanvas).toHaveCSS('pointer-events', 'auto');
        await swipe(160, 400, 235, 415);
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();

        await page.getByRole('button', { name: 'Add Page' }).click();
        await page.getByRole('button', { name: 'Hand', exact: true }).press('Enter');
        await workspace.evaluate((element) => {
            element.scrollTop = element.scrollHeight - element.clientHeight - 60;
        });
        await swipe(185, 465, 185, 355);
        await expect.poll(async () => {
            const box = await canvas(page, 1).boundingBox();
            return box.y + box.height;
        }).toBeLessThanOrEqual(centerY);
    } finally {
        await context.close();
    }
});

test('redraws edits at display density while preserving their coordinates and export resolution', async ({ page }) => {
    await startBlank(page);
    const editingCanvas = canvas(page);
    await expect.poll(() => editingCanvas.evaluate((element) => element.width / element.clientWidth)).toBeCloseTo(2, 1);

    const zoom = page.locator('#zoom-input');
    await zoom.fill('225');
    await zoom.press('Enter');
    await expect.poll(() => editingCanvas.evaluate((element) =>
        element.width / element.getBoundingClientRect().width,
    )).toBeGreaterThanOrEqual(1);
    await expect.poll(() => editingCanvas.evaluate((element) => element.width / element.clientWidth)).toBeCloseTo(2.5, 1);

    await page.locator('#tool-draw').click();
    const box = await editingCanvas.boundingBox();
    await page.mouse.move(box.x + 80, box.y + 170);
    await page.mouse.down();
    await page.mouse.move(box.x + 210, box.y + 170, { steps: 12 });
    await page.mouse.up();

    const alphaAtStroke = () => page.locator('#fabric-canvas-0').evaluate((element) => {
        const ratio = element.width / parseFloat(element.style.width);
        const x = Math.round((145 / 2.25) * ratio);
        const y = Math.round((170 / 2.25) * ratio);
        return element.getContext('2d').getImageData(x, y, 1, 1).data[3];
    });
    await expect.poll(alphaAtStroke).toBeGreaterThan(150);
    await zoom.fill('100');
    await zoom.press('Enter');
    await expect.poll(alphaAtStroke).toBeGreaterThan(150);
    await expect.poll(() => editingCanvas.evaluate((element) => element.width / element.clientWidth)).toBeCloseTo(2, 1);

    // Export dimensions are independent of the current editor zoom and device density.
    await zoom.fill('225');
    await zoom.press('Enter');
    const pdf = await exportPdf(page);
    const pdfPage = pdf.getPage(0);
    const xObjects = pdfPage.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
    const overlay = xObjects.lookup(xObjects.keys()[0]);
    expect(overlay.dict.get(PDFName.of('Width')).asNumber()).toBe(Math.floor(pdfPage.getWidth() * 3));
    expect(overlay.dict.get(PDFName.of('Height')).asNumber()).toBe(Math.floor(pdfPage.getHeight() * 3));
});

test('avoids undersampling edits on a high-density screen when zoomed in', async ({ browser }) => {
    const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 1000 },
    });
    try {
        const page = await context.newPage();
        await startBlank(page);
        const zoom = page.locator('#zoom-input');
        await zoom.fill('150');
        await zoom.press('Enter');
        await expect.poll(() => canvas(page).evaluate((element) =>
            element.width / element.getBoundingClientRect().width,
        )).toBeCloseTo(2, 1);
    } finally {
        await context.close();
    }
});

const optionIcon = (page, name) => page.getByRole('complementary', { name: 'Tool options' })
    .getByRole('button', { name, exact: true });

test('opens tool submenus to the left of the vertical icon palette', async ({ page }) => {
    await startBlank(page);
    const options = page.getByRole('complementary', { name: 'Tool options' });
    const palette = page.getByRole('group', { name: 'Contextual tool options' });
    await expect(options).toBeHidden();

    for (const [tool, icon, menu] of [
        ['tool-draw', 'Pen color', 'pen-colors'],
        ['tool-highlighter', 'Highlighter size', 'highlighter-size'],
        ['tool-shapes-btn', 'Shapes', 'shapes-menu'],
        ['tool-text', 'Text placement', 'text-placement-banner'],
        ['tool-edit-text', 'Edit text options', 'edit-text-placement-banner'],
        ['tool-table', 'Table options', 'table-options'],
        ['tool-sign', 'Signature options', 'sign-placement-banner'],
    ]) {
        await page.locator(`#${tool}`).click();
        const panel = options.locator(`#${menu}`);
        await expect(panel).toBeHidden();
        await optionIcon(page, icon).click();
        await expect(optionIcon(page, icon)).toHaveAttribute('aria-expanded', 'true');
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('heading')).toHaveCount(0);
        const submenu = await panel.boundingBox();
        const icons = await palette.boundingBox();
        expect(submenu.x + submenu.width).toBeLessThan(icons.x);
        expect(submenu.y).toBe(icons.y);

        if (tool === 'tool-draw' || tool === 'tool-highlighter') {
            if (tool === 'tool-highlighter') await optionIcon(page, 'Highlighter color').click();
            const colors = options.locator('.tool-submenu:visible').locator('button, input[type="color"]');
            const swatches = await colors.evaluateAll((controls) =>
                controls.map((control) => control.getBoundingClientRect().toJSON()),
            );
            expect(swatches).toHaveLength(tool === 'tool-draw' ? 6 : 7);
            for (const [index, swatch] of swatches.entries()) {
                expect(swatch.x + swatch.width / 2).toBe(swatches[0].x + swatches[0].width / 2);
                if (index > 0) expect(swatch.y).toBeGreaterThan(swatches[index - 1].bottom);
            }
        }
    }

    await page.locator('#btn-cancel-sign-tool').click();
    await expect(options).toBeHidden();
    await page.locator('#tool-draw').click();
    const color = optionIcon(page, 'Pen color');
    const size = optionIcon(page, 'Pen size');
    const first = await color.boundingBox();
    const second = await size.boundingBox();
    expect(first.x).toBe(second.x);
    expect(first.y).toBeLessThan(second.y);

    await color.click();
    await page.locator('[data-pen-color="#2563eb"]').click();
    await expect(page.locator('[data-pen-color="#2563eb"]')).toHaveAttribute('aria-pressed', 'true');
    await size.click();
    const penPreview = page.locator('#pen-stroke-preview');
    const penWidth = page.getByRole('combobox', { name: 'Pen stroke width' });
    await expect(penPreview).toHaveCSS('height', '2px');
    await expect(penPreview).toHaveCSS('background-color', 'rgb(37, 99, 235)');
    const selectBox = await penWidth.boundingBox();
    const previewBox = await penPreview.boundingBox();
    expect(selectBox.x + selectBox.width).toBeLessThan(previewBox.x);
    expect(selectBox.y).toBeLessThan(previewBox.y);
    expect(selectBox.y + selectBox.height).toBeGreaterThan(previewBox.y + previewBox.height);
    await expect(color).toHaveAttribute('aria-expanded', 'false');
    await expect(size).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(size).toHaveAttribute('aria-expanded', 'false');
    await expect(size).toBeFocused();

    await page.setViewportSize({ width: 390, height: 490 });
    await size.click();
    const narrow = await page.locator('#pen-size').boundingBox();
    const leftDock = await page.getByRole('complementary', { name: 'Document Tools' }).boundingBox();
    expect(narrow.x).toBeGreaterThan(leftDock.x + leftDock.width);
    expect(narrow.y + narrow.height).toBeLessThan(490);
    await page.locator('#prop-pen-width').selectOption('6');
    await expect(penPreview).toHaveCSS('height', '6px');

    await page.locator('#tool-highlighter').click();
    await optionIcon(page, 'Highlighter size').click();
    await page.getByRole('combobox', { name: 'Highlighter stroke width' }).selectOption('26');
    await expect(page.locator('#highlighter-stroke-preview')).toHaveCSS('height', '26px');
});

test('removes a shape fill while preserving its outline', async ({ page }) => {
    await startBlank(page);
    await page.locator('#tool-shapes-btn').click();
    await optionIcon(page, 'Shapes').click();
    await page.locator('[data-shape="rect"]').click();
    await optionIcon(page, 'Object formatting').click();

    const noFill = page.getByRole('button', { name: 'No fill', exact: true });
    const sample = () => page.locator('#fabric-canvas-0').evaluate((element) => {
        const context = element.getContext('2d');
        const x = Math.floor(element.width / 2);
        const y = Math.floor(element.height / 3);
        const density = element.height / parseFloat(element.style.height);
        const outlineY = y - Math.round(30 * density);
        return {
            center: Array.from(context.getImageData(x, y, 1, 1).data),
            outline: Array.from(context.getImageData(x, outlineY - 3, 1, 7).data),
        };
    });

    await expect(noFill).toHaveAttribute('aria-pressed', 'true');
    const unfilled = await sample();
    expect(unfilled.center[3]).toBe(0);
    expect(unfilled.outline.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);

    await page.locator('#prop-fill-color').fill('#2563eb');
    await expect(noFill).toHaveAttribute('aria-pressed', 'false');
    expect((await sample()).center).toEqual([37, 99, 235, 255]);
    await noFill.click();
    await expect(noFill).toHaveAttribute('aria-pressed', 'true');
    expect(await sample()).toEqual(unfilled);
});

test('adds text, each shape, a table, a picture, pen and highlighter, then undoes and redoes edits', async ({
    page,
}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await startBlank(page);
    await expect(page.locator('#btn-undo')).toBeDisabled();
    await page.locator('#tool-text').click();
    await canvas(page).click({ position: { x: 80, y: 90 } });
    await page.keyboard.insertText('Migration test');
    await page.keyboard.press('Escape');
    await optionIcon(page, 'Text formatting').click();
    await expect(page.locator('#prop-text-group')).toBeVisible();
    await page.locator('#prop-font-family').selectOption('Courier New');
    await page.locator('#prop-font-size').fill('24');
    await page.getByRole('combobox', { name: 'Text alignment' }).selectOption('center');
    await expect(page.getByRole('combobox', { name: 'Text alignment' })).toHaveValue('center');
    for (const property of ['bold', 'italic', 'underline']) {
        await page.locator(`#prop-${property}`).click();
        await expect(page.locator(`#prop-${property}`)).toHaveClass(/bg-slate-200/);
    }

    for (const tool of ['rect', 'circle', 'line', 'arrow', 'whiteout']) {
        await page.locator('#tool-shapes-btn').click();
        await optionIcon(page, 'Shapes').click();
        await page.locator(`[data-shape="${tool}"]`).click();
        await expect(optionIcon(page, 'Object formatting')).toBeVisible();
    }
    await optionIcon(page, 'Object formatting').click();
    await page.locator('#prop-stroke-width').fill('3');
    await expect(page.locator('#border-stroke-preview')).toHaveCSS('height', '3px');
    await optionIcon(page, 'Object actions').click();
    await page.locator('#prop-bring-forward').click();
    await page.locator('#prop-send-backward').click();
    await page.locator('#prop-delete').click();
    await page.locator('#btn-undo').click();
    await expect(page.locator('#btn-redo')).toBeEnabled();
    await page.locator('#btn-redo').click();
    await expect(page.locator('#btn-redo')).toBeDisabled();

    await page.locator('#tool-table').click();
    await optionIcon(page, 'Table options').click();
    await page.locator('#table-rows').fill('2');
    await page.locator('#table-cols').fill('3');
    await page.locator('#btn-insert-table').click();
    await expect(page.locator('#table-options')).toBeHidden();
    const editCell = async (value) => {
        let previous;
        page.once('dialog', async (dialog) => {
            previous = dialog.defaultValue();
            if (value === undefined) await dialog.dismiss();
            else await dialog.accept(value);
        });
        await canvas(page).dblclick({ position: { x: 180, y: 300 } });
        return previous;
    };
    expect(await editCell('Name')).toBe('Col 1');
    await page.locator('#btn-undo').click();
    expect(await editCell()).toBe('Col 1');
    await page.locator('#btn-redo').click();
    expect(await editCell()).toBe('Name');

    await page.locator('#image-upload-input').setInputFiles(signatureImage);
    await expect(optionIcon(page, 'Object formatting')).toBeVisible();

    await page.locator('#tool-draw').click();
    await optionIcon(page, 'Pen color').click();
    await page.locator('[data-pen-color="#2563eb"]').click();
    await optionIcon(page, 'Pen size').click();
    await page.locator('#prop-pen-width').selectOption('4');
    await drawStroke(page, canvas(page), 45, 170);
    await page.locator('#tool-highlighter').click();
    await optionIcon(page, 'Highlighter color').click();
    await page.locator('[data-hl-color="#4ade80"]').click();
    await drawStroke(page, canvas(page), 45, 230);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#btn-redo')).toBeEnabled();
    await page.keyboard.press('Control+y');
    await expect(page.locator('#btn-redo')).toBeDisabled();

    const pdf = await exportPdf(page);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).node.Resources().toString()).toContain('/XObject');
    expect(errors).toEqual([]);
});

const signatureImage = {
    name: 'signature.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="65">' +
            '<rect width="180" height="65" fill="white"/>' +
            '<path d="M8 44 Q35 5 60 39 T110 37 L164 27" fill="none" stroke="#262322" stroke-width="4"/>' +
            '</svg>',
    ),
};

test('places drawn and uploaded signatures and exports entirely in the browser', async ({ page }) => {
    const mutations = [];
    page.on('request', (request) => {
        if (request.url().startsWith('http') && request.method() !== 'GET') mutations.push(request.url());
    });
    await startBlank(page);
    await page.locator('#tool-sign').click();
    await canvas(page).click({ position: { x: 120, y: 210 } });
    await expect(page.locator('#sig-coords-badge')).toContainText(/Target: Page 1 at \(1(?:19|20), 210\)/);
    await page.locator('[data-color="#0f2b5c"]').click();
    await drawStroke(page, page.locator('#signature-draw-canvas'), 20, 40);
    await page.locator('#btn-clear-draw').click();
    await expect(page.locator('#draw-hint')).toBeVisible();
    await drawStroke(page, page.locator('#signature-draw-canvas'), 20, 40);
    await page.locator('#modal-confirm-sig-btn').click();
    await expect(page.locator('#signature-modal')).toBeHidden();
    await expect(page.locator('#btn-undo')).toBeEnabled();

    await page.locator('#tool-sign').click();
    await optionIcon(page, 'Signature options').click();
    await page.locator('#btn-open-sign-pad-now').click();
    await page.locator('#tab-upload-btn').click();
    await page.locator('#sig-image-file-input').setInputFiles(signatureImage);
    await expect(page.locator('#sig-extracted-preview-img')).toBeVisible();
    await expect(page.locator('#sig-extracted-preview-img')).toHaveAttribute('src', /^data:image\/png/);
    await page.locator('#cutoff-slider').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#cutoff-val')).not.toHaveText('210');
    await page.locator('input[name="sig-ink-recolor"][value="original"]').check();
    await page.locator('#modal-confirm-sig-btn').click();
    await expect(page.locator('#signature-modal')).toBeHidden();

    const pdf = await exportPdf(page);
    expect(pdf.getPage(0).node.Resources().toString()).toContain('/XObject');
    expect(mutations).toEqual([]);
});

test('uploads an existing multipage PDF, edits its original text and keeps the correct pages on export', async ({
    page,
}) => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    source.addPage([350, 460]).drawText('First page', { x: 50, y: 410, size: 20, font });
    source.addPage([400, 500]).drawText('Second page', { x: 50, y: 450, size: 20, font });
    await page.goto('/pdf/editor');
    await page.locator('#empty-file-input').setInputFiles({
        name: 'source.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await source.save()),
    });
    await expect(page.locator('#doc-meta')).toHaveText('source.pdf • 2 pages');
    await expect(canvas(page, 1)).toBeVisible();
    await page.locator('.btn-delete-page[data-page-index="0"]').click();
    await expect(canvas(page)).toHaveCount(1);
    await page.locator('#tool-edit-text').click();
    await canvas(page).click({ position: { x: 60, y: 40 } });
    await page.keyboard.insertText('Edited second page');
    await page.keyboard.press('Escape');
    await optionIcon(page, 'Text formatting').click();
    await expect(page.locator('#prop-text-group')).toBeVisible();
    await page.locator('#btn-add-page').click();
    const pdf = await exportPdf(page);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 400, height: 500 });
    expect(pdf.getPage(0).node.Resources().toString()).toContain('/XObject');
    expect(pdf.getPage(1).getSize()).toEqual({ width: 595.28, height: 841.89 });
});

test('workspace switcher cancels and confirms navigation to the resume builder', async ({ page }) => {
    await page.goto('/pdf/editor');
    const handle = page.getByRole('button', { name: 'Switch Workspace' });
    const backdrop = page.locator('#workspace-backdrop');
    const resume = page.locator('#btn-switch-resume-builder');
    const label = resume.locator('.workspace-option-label');

    await handle.press('Space');
    await expect(resume).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    await expect(handle).toBeFocused();

    await page.mouse.move(6, 500);
    await expect(backdrop).toHaveCSS('opacity', '1');
    await expect(backdrop).toHaveCSS('transition-property', 'opacity, visibility');
    await expect(label).toHaveCSS('opacity', '0');
    await resume.hover();
    await expect(label).toHaveCSS('opacity', '1');
    await resume.click();
    await expect(page.locator('#redirect-confirm-modal')).toBeVisible();
    await page.locator('#btn-cancel-redirect').click();
    await expect(page.locator('#redirect-confirm-modal')).toBeHidden();
    await page.mouse.move(6, 500);
    await expect(page.locator('#workspace-backdrop')).toBeVisible();
    await page.locator('#btn-switch-resume-builder').click();
    await page.locator('#btn-confirm-redirect').click();
    await expect(page).toHaveURL(/\/resume\/editor$/);
});

test('opens the workspace switcher on a rightward touch swipe and keeps the mobile label visible', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 700 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: 'reduce',
    });
    try {
        const page = await context.newPage();
        await page.goto('/pdf/editor');
        const handle = page.getByRole('button', { name: 'Switch Workspace' });
        const backdrop = page.locator('#workspace-backdrop');
        await handle.tap();
        await expect(handle).toHaveAttribute('aria-expanded', 'true');
        await page.touchscreen.tap(300, 120);
        await expect(handle).toHaveAttribute('aria-expanded', 'false');

        const position = await handle.boundingBox();
        const x = position.x + 16;
        const y = position.y + position.height / 2;
        const session = await context.newCDPSession(page);
        const swipe = async (dx, dy) => {
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            for (const fraction of [0.25, 0.5, 0.75, 1]) {
                await session.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [{ x: x + dx * fraction, y: y + dy * fraction }],
                });
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };

        await swipe(0, 65);
        await expect(handle).toHaveAttribute('aria-expanded', 'false');
        await swipe(80, 6);
        await expect(handle).toHaveAttribute('aria-expanded', 'true');
        await expect(backdrop).toBeVisible();
        await expect(backdrop).toHaveCSS('transition-duration', '0s');
        await expect(backdrop.locator('#btn-switch-resume-builder .workspace-option-label')).toHaveCSS('opacity', '1');
    } finally {
        await context.close();
    }
});
