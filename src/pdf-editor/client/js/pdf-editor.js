import * as pdfjsLib from '/pdf-editor/vendor/pdf.min.mjs';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf-editor/vendor/pdf.worker.min.mjs';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

// State
const state = {
    pdfDoc: null,
    pdfBytes: null,
    pages: [], // Array of { index, width, height, container, bgCanvas, fabricCanvas, isNew }
    zoom: 1.0,
    activeTool: 'select',
    activePageIndex: 0,
    signPlacement: null, // { pageIndex, x, y }
    showGrid: false,
    selectedObject: null,
    uploadedSigImg: null,
};

// DOM Elements
const docMeta = document.getElementById('doc-meta');
const emptyState = document.getElementById('empty-state');
const pagesViewport = document.getElementById('pages-viewport');
const viewportControls = document.getElementById('viewport-controls');
const zoomLabel = document.getElementById('zoom-label');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnFitWidth = document.getElementById('btn-fit-width');
const btnToggleGrid = document.getElementById('btn-toggle-grid');
const btnAddPage = document.getElementById('btn-add-page');
const btnExportPdf = document.getElementById('btn-export-pdf');
const pdfFileInput = document.getElementById('pdf-file-input');
const emptyFileInput = document.getElementById('empty-file-input');
const btnStartBlank = document.getElementById('btn-start-blank');
const imageUploadInput = document.getElementById('image-upload-input');
const signPlacementBanner = document.getElementById('sign-placement-banner');
const btnCancelSignTool = document.getElementById('btn-cancel-sign-tool');
const btnOpenSignPadNow = document.getElementById('btn-open-sign-pad-now');
const textPlacementBanner = document.getElementById('text-placement-banner');
const btnCancelTextTool = document.getElementById('btn-cancel-text-tool');
const btnAddTextCenter = document.getElementById('btn-add-text-center');

function getCanvasPointer(opt, fCanvas) {
    if (opt.scenePoint) {
        return { x: opt.scenePoint.x, y: opt.scenePoint.y };
    }
    if (fCanvas && fCanvas.getScenePoint) {
        const pt = fCanvas.getScenePoint(opt.e);
        return { x: pt.x, y: pt.y };
    }
    if (fCanvas && fCanvas.getPointer) {
        const pt = fCanvas.getPointer(opt.e);
        return { x: pt.x, y: pt.y };
    }
    return { x: opt.e ? opt.e.offsetX : 100, y: opt.e ? opt.e.offsetY : 100 };
}

function findTextItemAt(textItems, px, py) {
    if (!textItems || textItems.length === 0) return null;
    return textItems.find((item) => {
        return (
            px >= item.x - 6 &&
            px <= item.x + item.width + 6 &&
            py >= item.y - 4 &&
            py <= item.y + item.height + 4
        );
    });
}

// Context properties DOM
const contextProps = document.getElementById('context-properties');
const propTextGroup = document.getElementById('prop-text-group');
const propShapeGroup = document.getElementById('prop-shape-group');
const propFontFamily = document.getElementById('prop-font-family');
const propFontSize = document.getElementById('prop-font-size');
const propBold = document.getElementById('prop-bold');
const propItalic = document.getElementById('prop-italic');
const propUnderline = document.getElementById('prop-underline');
const propTextColor = document.getElementById('prop-text-color');
const propFillColor = document.getElementById('prop-fill-color');
const propStrokeColor = document.getElementById('prop-stroke-color');
const propStrokeWidth = document.getElementById('prop-stroke-width');
const propBringForward = document.getElementById('prop-bring-forward');
const propSendBackward = document.getElementById('prop-send-backward');
const propDelete = document.getElementById('prop-delete');

// Tool buttons
const toolButtons = document.querySelectorAll('[data-tool]');
const toolShapesBtn = document.getElementById('tool-shapes-btn');
const shapesMenu = document.getElementById('shapes-menu');

// Modals
const signatureModal = document.getElementById('signature-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalConfirmSigBtn = document.getElementById('modal-confirm-sig-btn');
const tabDrawBtn = document.getElementById('tab-draw-btn');
const tabUploadBtn = document.getElementById('tab-upload-btn');
const tabDrawContent = document.getElementById('tab-draw-content');
const tabUploadContent = document.getElementById('tab-upload-content');
const sigDrawCanvas = document.getElementById('signature-draw-canvas');
const drawHint = document.getElementById('draw-hint');
const btnClearDraw = document.getElementById('btn-clear-draw');
const drawStrokeWidthSelect = document.getElementById('draw-stroke-width');
const sigImageFileInput = document.getElementById('sig-image-file-input');
const sigExtractPreviewContainer = document.getElementById('sig-extract-preview-container');
const sigExtractedPreviewImg = document.getElementById('sig-extracted-preview-img');
const cutoffSlider = document.getElementById('cutoff-slider');
const cutoffVal = document.getElementById('cutoff-val');
const sigCoordsBadge = document.getElementById('sig-coords-badge');

const tableModal = document.getElementById('table-modal');
const tableModalClose = document.getElementById('table-modal-close');
const tableModalCancel = document.getElementById('table-modal-cancel');
const tableModalInsert = document.getElementById('table-modal-insert');
const tableRowsInput = document.getElementById('table-rows');
const tableColsInput = document.getElementById('table-cols');

// ---------------------------------------------------------------------------
// 1. Signature Pad Engine (Canvas 2D Smooth Curves)
// ---------------------------------------------------------------------------
let sigCtx = null;
let isDrawingSig = false;
let sigStrokeColor = '#000000';
let sigStrokeWidth = 3;
let sigPoints = [];

function initSignaturePad() {
    sigCtx = sigDrawCanvas.getContext('2d');
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';

    const getPos = (e) => {
        const rect = sigDrawCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (sigDrawCanvas.width / rect.width),
            y: (clientY - rect.top) * (sigDrawCanvas.height / rect.height),
        };
    };

    const startDraw = (e) => {
        isDrawingSig = true;
        drawHint.classList.add('hidden');
        sigPoints = [getPos(e)];
    };

    const moveDraw = (e) => {
        if (!isDrawingSig) return;
        e.preventDefault();
        const pt = getPos(e);
        sigPoints.push(pt);

        sigCtx.strokeStyle = sigStrokeColor;
        sigCtx.lineWidth = sigStrokeWidth;

        if (sigPoints.length >= 3) {
            const p0 = sigPoints[sigPoints.length - 3];
            const p1 = sigPoints[sigPoints.length - 2];
            const p2 = sigPoints[sigPoints.length - 1];
            const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
            const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

            sigCtx.beginPath();
            sigCtx.moveTo(mid1.x, mid1.y);
            sigCtx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
            sigCtx.stroke();
        } else {
            sigCtx.beginPath();
            sigCtx.arc(pt.x, pt.y, sigStrokeWidth / 2, 0, Math.PI * 2);
            sigCtx.fillStyle = sigStrokeColor;
            sigCtx.fill();
        }
    };

    const endDraw = () => {
        isDrawingSig = false;
    };

    sigDrawCanvas.addEventListener('mousedown', startDraw);
    sigDrawCanvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', endDraw);

    sigDrawCanvas.addEventListener('touchstart', startDraw, { passive: false });
    sigDrawCanvas.addEventListener('touchmove', moveDraw, { passive: false });
    window.addEventListener('touchend', endDraw);

    btnClearDraw.addEventListener('click', clearSigDrawCanvas);

    document.querySelectorAll('.ink-color-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.ink-color-btn').forEach((b) => b.classList.remove('ring-2', 'ring-indigo-500', 'ring-offset-1'));
            btn.classList.add('ring-2', 'ring-indigo-500', 'ring-offset-1');
            sigStrokeColor = btn.dataset.color;
        });
    });

    drawStrokeWidthSelect.addEventListener('change', (e) => {
        sigStrokeWidth = parseInt(e.target.value, 10);
    });
}

function clearSigDrawCanvas() {
    if (!sigCtx) return;
    sigCtx.clearRect(0, 0, sigDrawCanvas.width, sigDrawCanvas.height);
    sigPoints = [];
    drawHint.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// 2. Background-less Signature Extraction Engine (Client-Side Pixel Processing)
// ---------------------------------------------------------------------------
function extractSignatureBackground(imgElement, cutoff = 210, recolor = 'black') {
    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth || imgElement.width;
    canvas.height = imgElement.naturalHeight || imgElement.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;
    let hasInk = false;

    // Target ink colors
    const inkMap = {
        black: [0, 0, 0],
        navy: [15, 43, 92],
    };

    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        // If pixel is already fully transparent (e.g. untouched canvas), keep it transparent!
        if (a === 0) {
            continue;
        }

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Perceived luminance
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        if (lum >= cutoff) {
            // Paper background -> completely transparent
            data[i + 3] = 0;
        } else {
            // Ink stroke detected!
            hasInk = true;
            const x = (i / 4) % canvas.width;
            const y = Math.floor(i / 4 / canvas.width);

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;

            // Antialiased alpha smoothing at edge
            const alphaFactor = Math.min(1.0, Math.max(0.2, (cutoff - lum) / 35.0));
            data[i + 3] = Math.round(a * alphaFactor);

            if (recolor in inkMap) {
                data[i] = inkMap[recolor][0];
                data[i + 1] = inkMap[recolor][1];
                data[i + 2] = inkMap[recolor][2];
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);

    // Auto-crop to bounding box with padding
    if (!hasInk || minX >= maxX || minY >= maxY) {
        return canvas.toDataURL('image/png');
    }

    const pad = 8;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(canvas.width - cropX, maxX - minX + pad * 2);
    const cropH = Math.min(canvas.height - cropY, maxY - minY + pad * 2);

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const cropCtx = croppedCanvas.getContext('2d');
    cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    return croppedCanvas.toDataURL('image/png');
}

function updateUploadedSigPreview() {
    if (!state.uploadedSigImg) return;
    const cutoff = parseInt(cutoffSlider.value, 10);
    cutoffVal.textContent = cutoff;
    const recolor = document.querySelector('input[name="sig-ink-recolor"]:checked')?.value || 'black';

    const transparentPng = extractSignatureBackground(state.uploadedSigImg, cutoff, recolor);
    sigExtractedPreviewImg.src = transparentPng;
    sigExtractPreviewContainer.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// 3. Document Loader & Multi-Page Viewport Coordinator
// ---------------------------------------------------------------------------
async function loadPdfBuffer(buffer, filename = 'document.pdf') {
    state.pdfBytes = new Uint8Array(buffer);
    state.pages = [];
    pagesViewport.innerHTML = '';

    const loadingTask = pdfjsLib.getDocument({ data: state.pdfBytes });
    state.pdfDoc = await loadingTask.promise;

    docMeta.textContent = `${filename} • ${state.pdfDoc.numPages} ${state.pdfDoc.numPages === 1 ? 'page' : 'pages'}`;
    emptyState.classList.add('hidden');
    pagesViewport.classList.remove('hidden');
    viewportControls.classList.remove('hidden');

    for (let pageNum = 1; pageNum <= state.pdfDoc.numPages; pageNum++) {
        await createPageElement(pageNum);
    }

    applyZoom(1.0);
}

function startWithBlankA4() {
    state.pdfDoc = null;
    state.pdfBytes = null;
    state.pages = [];
    pagesViewport.innerHTML = '';

    docMeta.textContent = 'Untitled Document • 1 page';
    emptyState.classList.add('hidden');
    pagesViewport.classList.remove('hidden');
    viewportControls.classList.remove('hidden');

    appendBlankPage();
    applyZoom(1.0);
}

async function createPageElement(pageNum) {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });

    const pageIndex = pageNum - 1;
    const width = viewport.width;
    const height = viewport.height;

    const pageContainer = document.createElement('div');
    pageContainer.className = 'relative flex flex-col items-center group';
    pageContainer.dataset.pageIndex = pageIndex;

    // Header badge
    const header = document.createElement('div');
    header.className = 'w-full flex items-center justify-between py-1 px-2 text-xs font-semibold text-slate-500';
    header.innerHTML = `
        <span class="rounded bg-slate-200/80 px-2 py-0.5">Page ${pageNum}</span>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button class="btn-delete-page rounded px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50" data-page-index="${pageIndex}" title="Delete Page">Delete</button>
        </div>
    `;

    // Canvas container
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'relative rounded-sm shadow-xl bg-white overflow-hidden transition-all';
    canvasWrap.style.width = `${width}px`;
    canvasWrap.style.height = `${height}px`;

    // Layer 1: PDF.js Background Canvas
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = width * 2;
    bgCanvas.height = height * 2;
    bgCanvas.style.width = `${width}px`;
    bgCanvas.style.height = `${height}px`;
    bgCanvas.className = 'absolute inset-0 pointer-events-none z-0';

    const bgCtx = bgCanvas.getContext('2d');
    const renderContext = {
        canvasContext: bgCtx,
        viewport: page.getViewport({ scale: 2.0 }),
    };
    await page.render(renderContext).promise;

    // Extract text items from PDF.js for click-to-edit
    const textItems = [];
    try {
        const textContent = await page.getTextContent();
        for (const item of textContent.items) {
            if (!item.str || !item.str.trim()) continue;
            const tx = item.transform[4];
            const ty = item.transform[5];
            const [vx, vy] = viewport.convertToViewportPoint(tx, ty);
            const fontSize = Math.hypot(item.transform[2], item.transform[3]) || item.height || 12;
            textItems.push({
                str: item.str,
                x: Math.round(vx),
                y: Math.round(Math.max(0, vy - fontSize)),
                width: Math.round(item.width),
                height: Math.round(Math.max(14, fontSize * 1.25)),
                fontSize: Math.max(8, Math.round(fontSize)),
                fontName: item.fontName,
            });
        }
    } catch (e) {
        console.warn('Text extraction failed on page ' + pageNum, e);
    }

    // Layer 2: Fabric.js Interactive Canvas
    const fabricCanvasEl = document.createElement('canvas');
    fabricCanvasEl.id = `fabric-canvas-${pageIndex}`;
    fabricCanvasEl.width = width;
    fabricCanvasEl.height = height;

    canvasWrap.appendChild(bgCanvas);
    canvasWrap.appendChild(fabricCanvasEl);
    pageContainer.appendChild(header);
    pageContainer.appendChild(canvasWrap);
    pagesViewport.appendChild(pageContainer);

    // Initialize Fabric Canvas
    const fabricCanvas = new window.fabric.Canvas(fabricCanvasEl, {
        width,
        height,
        selection: true,
        preserveObjectStacking: true,
    });

    const pageData = {
        index: pageIndex,
        width,
        height,
        container: canvasWrap,
        bgCanvas,
        fabricCanvas,
        isNew: false,
        textItems,
        textMadeEditable: false,
    };

    state.pages.push(pageData);
    bindFabricEvents(fabricCanvas, pageIndex);
}

function makePageTextEditable(pageIndex) {
    const pageData = state.pages[pageIndex] || state.pages[0];
    if (!pageData || !pageData.textItems || pageData.textItems.length === 0) {
        alert('No text detected on Page ' + ((pageIndex || 0) + 1));
        return;
    }
    const canvas = pageData.fabricCanvas;
    if (pageData.textMadeEditable) {
        alert('Existing text on Page ' + (pageData.index + 1) + ' is already editable! Click on any text box to modify it.');
        return;
    }

    // Group adjacent items on the same line to form coherent editable sentences
    const rawItems = [...pageData.textItems].sort((a, b) => (Math.abs(a.y - b.y) < 4 ? a.x - b.x : a.y - b.y));
    const lines = [];
    let currentLine = null;

    for (const item of rawItems) {
        if (!currentLine) {
            currentLine = { ...item };
            continue;
        }
        const sameLine = Math.abs(currentLine.y - item.y) <= 5;
        const adjacent = item.x >= currentLine.x && (item.x - (currentLine.x + currentLine.width)) <= Math.max(20, item.fontSize * 1.6);
        if (sameLine && adjacent) {
            currentLine.str += (currentLine.str.endsWith(' ') || item.str.startsWith(' ') ? '' : ' ') + item.str;
            currentLine.width = (item.x + item.width) - currentLine.x;
            currentLine.height = Math.max(currentLine.height, item.height);
        } else {
            lines.push(currentLine);
            currentLine = { ...item };
        }
    }
    if (currentLine) lines.push(currentLine);

    lines.forEach((line) => {
        const textObj = new window.fabric.IText(line.str, {
            left: Math.round(line.x),
            top: Math.round(line.y),
            originX: 'left',
            originY: 'top',
            fontSize: line.fontSize,
            fontFamily: 'Arial',
            fill: '#000000',
            backgroundColor: '#ffffff',
            padding: 1,
        });
        canvas.add(textObj);
    });

    pageData.textMadeEditable = true;
    canvas.renderAll();
    setActiveTool('select');
    alert(`Converted ${lines.length} text lines on Page ${pageData.index + 1} into editable text boxes! Click on any line to edit text.`);
}

function appendBlankPage() {
    const pageIndex = state.pages.length;
    const width = A4_WIDTH;
    const height = A4_HEIGHT;

    const pageContainer = document.createElement('div');
    pageContainer.className = 'relative flex flex-col items-center group';
    pageContainer.dataset.pageIndex = pageIndex;

    const header = document.createElement('div');
    header.className = 'w-full flex items-center justify-between py-1 px-2 text-xs font-semibold text-slate-500';
    header.innerHTML = `
        <span class="rounded bg-slate-200/80 px-2 py-0.5">Page ${pageIndex + 1} (Blank)</span>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button class="btn-delete-page rounded px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50" data-page-index="${pageIndex}" title="Delete Page">Delete</button>
        </div>
    `;

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'relative rounded-sm shadow-xl bg-white overflow-hidden transition-all';
    canvasWrap.style.width = `${width}px`;
    canvasWrap.style.height = `${height}px`;

    const fabricCanvasEl = document.createElement('canvas');
    fabricCanvasEl.id = `fabric-canvas-${pageIndex}`;
    fabricCanvasEl.width = width;
    fabricCanvasEl.height = height;

    canvasWrap.appendChild(fabricCanvasEl);
    pageContainer.appendChild(header);
    pageContainer.appendChild(canvasWrap);
    pagesViewport.appendChild(pageContainer);

    const fabricCanvas = new window.fabric.Canvas(fabricCanvasEl, {
        width,
        height,
        selection: true,
        preserveObjectStacking: true,
    });

    const pageData = {
        index: pageIndex,
        width,
        height,
        container: canvasWrap,
        bgCanvas: null,
        fabricCanvas,
        isNew: true,
    };

    state.pages.push(pageData);
    bindFabricEvents(fabricCanvas, pageIndex);
    applyZoom(state.zoom);
}

function deletePage(pageIndex) {
    if (state.pages.length <= 1) {
        alert('Document must have at least one page.');
        return;
    }
    const target = state.pages.find((p) => p.index === pageIndex);
    if (!target) return;

    target.fabricCanvas.dispose();
    const container = document.querySelector(`[data-page-index="${pageIndex}"]`);
    if (container) container.remove();

    state.pages = state.pages.filter((p) => p.index !== pageIndex);
    // Reindex remaining pages
    state.pages.forEach((p, idx) => {
        p.index = idx;
        const cont = p.container.parentElement;
        if (cont) {
            cont.dataset.pageIndex = idx;
            const badge = cont.querySelector('span');
            if (badge) badge.textContent = `Page ${idx + 1}`;
        }
    });
}

// ---------------------------------------------------------------------------
// 4. Fabric.js Canvas Event Binding & Tools Interaction
// ---------------------------------------------------------------------------
function bindFabricEvents(fCanvas, pageIndex) {
    fCanvas.on('mouse:down', (opt) => {
        state.activePageIndex = pageIndex;
        const pointer = getCanvasPointer(opt, fCanvas);

        // If Signature tool is primed, click-to-place triggers the signature modal!
        if (state.activeTool === 'sign') {
            state.signPlacement = {
                pageIndex,
                x: pointer.x,
                y: pointer.y,
            };
            openSignatureModal();
            return;
        }

        // If Text tool is primed, click-to-place text at clicked position!
        if (state.activeTool === 'text') {
            if (opt.target) return; // Clicking an existing object selects it instead
            const pageData = state.pages[pageIndex];
            const matchedText = pageData ? findTextItemAt(pageData.textItems, pointer.x, pointer.y) : null;
            if (matchedText) {
                // Edit existing detected text in place!
                const textObj = new window.fabric.IText(matchedText.str, {
                    left: matchedText.x,
                    top: matchedText.y,
                    originX: 'left',
                    originY: 'top',
                    fontFamily: 'Arial',
                    fontSize: matchedText.fontSize,
                    fill: '#000000',
                    backgroundColor: '#ffffff',
                });
                fCanvas.add(textObj);
                fCanvas.setActiveObject(textObj);
                textObj.enterEditing();
                textObj.selectAll();
                fCanvas.renderAll();
                setActiveTool('select');
                return;
            }

            // Otherwise place brand new text with top-left right at clicked coordinate!
            const textObj = new window.fabric.IText('Type text here', {
                left: Math.round(pointer.x),
                top: Math.round(pointer.y),
                originX: 'left',
                originY: 'top',
                fontFamily: 'Arial',
                fontSize: 14,
                fill: '#000000',
            });
            fCanvas.add(textObj);
            fCanvas.setActiveObject(textObj);
            textObj.enterEditing();
            textObj.selectAll();
            fCanvas.renderAll();
            setActiveTool('select');
            return;
        }
    });

    fCanvas.on('selection:created', (e) => onObjectSelected(e.selected[0]));
    fCanvas.on('selection:updated', (e) => onObjectSelected(e.selected[0]));
    fCanvas.on('selection:cleared', () => onSelectionCleared());
}

function onObjectSelected(obj) {
    if (!obj) return;
    state.selectedObject = obj;
    contextProps.classList.remove('hidden');

    if (obj.type === 'i-text' || obj.type === 'text') {
        propTextGroup.classList.remove('hidden');
        propShapeGroup.classList.add('hidden');

        propFontFamily.value = obj.fontFamily || 'Arial';
        propFontSize.value = Math.round(obj.fontSize || 14);
        propTextColor.value = obj.fill || '#000000';
        propBold.classList.toggle('bg-slate-200', obj.fontWeight === 'bold');
        propItalic.classList.toggle('bg-slate-200', obj.fontStyle === 'italic');
        propUnderline.classList.toggle('bg-slate-200', Boolean(obj.underline));
    } else {
        propTextGroup.classList.add('hidden');
        propShapeGroup.classList.remove('hidden');

        if (obj.fill && typeof obj.fill === 'string' && obj.fill.startsWith('#')) {
            propFillColor.value = obj.fill;
        }
        if (obj.stroke && typeof obj.stroke === 'string' && obj.stroke.startsWith('#')) {
            propStrokeColor.value = obj.stroke;
        }
        propStrokeWidth.value = obj.strokeWidth || 1;
    }
}

function onSelectionCleared() {
    state.selectedObject = null;
    contextProps.classList.add('hidden');
    propTextGroup.classList.add('hidden');
    propShapeGroup.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// 5. Active Tool Switcher
// ---------------------------------------------------------------------------
function setActiveTool(tool) {
    state.activeTool = tool;

    // Update toolbar active styles
    toolButtons.forEach((btn) => {
        btn.classList.toggle('btn-tool-active', btn.dataset.tool === tool);
    });

    if (tool === 'sign') {
        signPlacementBanner.classList.remove('hidden');
    } else {
        signPlacementBanner.classList.add('hidden');
    }

    if (tool === 'text') {
        textPlacementBanner?.classList.remove('hidden');
    } else {
        textPlacementBanner?.classList.add('hidden');
    }

    // Toggle freehand drawing mode across all page canvases
    state.pages.forEach((p) => {
        const isDrawing = tool === 'draw' || tool === 'highlighter';
        p.fabricCanvas.isDrawingMode = isDrawing;
        if (isDrawing) {
            if (!p.fabricCanvas.freeDrawingBrush) {
                p.fabricCanvas.freeDrawingBrush = new window.fabric.PencilBrush(p.fabricCanvas);
            }
            if (tool === 'draw') {
                p.fabricCanvas.freeDrawingBrush.color = '#000000';
                p.fabricCanvas.freeDrawingBrush.width = 2;
            } else if (tool === 'highlighter') {
                p.fabricCanvas.freeDrawingBrush.color = 'rgba(254, 240, 138, 0.45)'; // Semi-transparent yellow
                p.fabricCanvas.freeDrawingBrush.width = 18;
            }
        }
    });
}

function getActiveCanvas() {
    const page = state.pages[state.activePageIndex] || state.pages[0];
    return page ? page.fabricCanvas : null;
}

// Add Text
function addText(x, y) {
    const canvas = getActiveCanvas();
    if (!canvas) return;

    const posX = typeof x === 'number' ? x : canvas.width / 2 - 60;
    const posY = typeof y === 'number' ? y : canvas.height / 3;

    const text = new window.fabric.IText('Type text here', {
        left: posX,
        top: posY,
        originX: 'left',
        originY: 'top',
        fontFamily: 'Arial',
        fontSize: 14,
        fill: '#000000',
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
    canvas.renderAll();
    setActiveTool('select');
}

// Add Shape
function addShape(shapeType) {
    const canvas = getActiveCanvas();
    if (!canvas) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 3;
    let shape = null;

    if (shapeType === 'rect') {
        shape = new window.fabric.Rect({
            left: centerX - 60,
            top: centerY - 30,
            originX: 'left',
            originY: 'top',
            width: 120,
            height: 60,
            fill: 'transparent',
            stroke: '#000000',
            strokeWidth: 2,
        });
    } else if (shapeType === 'circle') {
        shape = new window.fabric.Circle({
            left: centerX - 40,
            top: centerY - 40,
            originX: 'left',
            originY: 'top',
            radius: 40,
            fill: 'transparent',
            stroke: '#000000',
            strokeWidth: 2,
        });
    } else if (shapeType === 'line') {
        shape = new window.fabric.Line([centerX - 75, centerY, centerX + 75, centerY], {
            originX: 'left',
            originY: 'top',
            stroke: '#000000',
            strokeWidth: 2,
        });
    } else if (shapeType === 'arrow') {
        const line = new window.fabric.Line([0, 5, 100, 5], {
            stroke: '#000000',
            strokeWidth: 2,
        });
        const head = new window.fabric.Triangle({
            left: 100,
            top: 0,
            width: 10,
            height: 10,
            angle: 90,
            fill: '#000000',
        });
        shape = new window.fabric.Group([line, head], {
            left: centerX - 55,
            top: centerY - 5,
            originX: 'left',
            originY: 'top',
        });
    } else if (shapeType === 'whiteout') {
        // Whiteout to cover/erase existing text on the PDF!
        shape = new window.fabric.Rect({
            left: centerX - 60,
            top: centerY - 12,
            originX: 'left',
            originY: 'top',
            width: 120,
            height: 24,
            fill: '#ffffff',
            stroke: 'transparent',
            strokeWidth: 0,
        });
    }

    if (shape) {
        canvas.add(shape);
        canvas.setActiveObject(shape);
        canvas.renderAll();
    }
    shapesMenu.classList.add('hidden');
    setActiveTool('select');
}

// Add Table
function insertTable(rows = 3, cols = 3) {
    const canvas = getActiveCanvas();
    if (!canvas) return;

    const cellWidth = 100;
    const cellHeight = 32;
    const totalWidth = cols * cellWidth;
    const startX = (canvas.width - totalWidth) / 2;
    const startY = canvas.height / 3;

    const groupObjects = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = startX + c * cellWidth;
            const y = startY + r * cellHeight;

            const rect = new window.fabric.Rect({
                left: x,
                top: y,
                width: cellWidth,
                height: cellHeight,
                fill: r === 0 ? '#f8fafc' : '#ffffff',
                stroke: '#cbd5e1',
                strokeWidth: 1,
            });

            const text = new window.fabric.IText(r === 0 ? `Col ${c + 1}` : `Data`, {
                left: x + 8,
                top: y + 8,
                fontSize: 11,
                fontFamily: 'Arial',
                fill: '#334155',
            });

            groupObjects.push(rect, text);
        }
    }

    const tableGroup = new window.fabric.Group(groupObjects, {
        left: startX,
        top: startY,
    });

    canvas.add(tableGroup);
    canvas.setActiveObject(tableGroup);
    canvas.renderAll();
    setActiveTool('select');
}

// Add Image
function handleImageUpload(file) {
    const canvas = getActiveCanvas();
    if (!canvas || !file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const imgEl = new Image();
        imgEl.onload = async () => {
            const fabricImg = await (window.fabric.FabricImage ? window.fabric.FabricImage.fromURL(e.target.result) : window.fabric.Image.fromURL(e.target.result));

            // Scale image if larger than canvas
            const maxW = canvas.width * 0.6;
            const maxH = canvas.height * 0.4;
            const scale = Math.min(1.0, maxW / fabricImg.width, maxH / fabricImg.height);

            fabricImg.scale(scale);
            fabricImg.set({
                left: (canvas.width - fabricImg.width * scale) / 2,
                top: (canvas.height - fabricImg.height * scale) / 2,
                originX: 'left',
                originY: 'top',
            });

            canvas.add(fabricImg);
            canvas.setActiveObject(fabricImg);
            canvas.renderAll();
            setActiveTool('select');
        };
        imgEl.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ---------------------------------------------------------------------------
// 6. Signature Modal & Placement Engine
// ---------------------------------------------------------------------------
function openSignatureModal() {
    signatureModal.classList.remove('hidden');

    if (state.signPlacement) {
        sigCoordsBadge.textContent = `Target: Page ${state.signPlacement.pageIndex + 1} at (${Math.round(state.signPlacement.x)}, ${Math.round(state.signPlacement.y)})`;
    } else {
        sigCoordsBadge.textContent = 'Target: Active Page Center';
    }

    // Default to Draw Tab
    switchSigTab('draw');
}

function closeSignatureModal() {
    signatureModal.classList.add('hidden');
    setActiveTool('select');
}

function switchSigTab(tab) {
    if (tab === 'draw') {
        tabDrawBtn.className = 'flex items-center gap-1.5 border-b-2 border-indigo-600 px-4 py-2.5 text-xs font-semibold text-indigo-600';
        tabUploadBtn.className = 'flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-xs font-medium text-slate-500 hover:text-slate-700';
        tabDrawContent.classList.remove('hidden');
        tabUploadContent.classList.add('hidden');
    } else {
        tabUploadBtn.className = 'flex items-center gap-1.5 border-b-2 border-indigo-600 px-4 py-2.5 text-xs font-semibold text-indigo-600';
        tabDrawBtn.className = 'flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-xs font-medium text-slate-500 hover:text-slate-700';
        tabUploadContent.classList.remove('hidden');
        tabDrawContent.classList.add('hidden');
    }
}

async function confirmAndPlaceSignature() {
    const isUploadTab = !tabUploadContent.classList.contains('hidden');
    let signatureDataUrl = null;

    if (isUploadTab) {
        if (!state.uploadedSigImg) {
            alert('Please select a signature image first.');
            return;
        }
        signatureDataUrl = sigExtractedPreviewImg.src;
    } else {
        // From Draw Canvas
        if (sigPoints.length === 0) {
            alert('Please sign on the canvas before inserting.');
            return;
        }
        // Extract trimmed signature
        signatureDataUrl = extractSignatureBackground(sigDrawCanvas, 250, 'original');
    }

    if (!signatureDataUrl) return;

    const pageIndex = state.signPlacement ? state.signPlacement.pageIndex : state.activePageIndex;
    const page = state.pages[pageIndex] || state.pages[0];
    if (!page) return;

    const canvas = page.fabricCanvas;

    const fabricImg = await (window.fabric.FabricImage ? window.fabric.FabricImage.fromURL(signatureDataUrl) : window.fabric.Image.fromURL(signatureDataUrl));

    // Target standard signature width ~ 150pt
    const targetWidth = 150;
    const scale = targetWidth / fabricImg.width;
    fabricImg.scale(scale);

    const sigW = fabricImg.width * scale;
    const sigH = fabricImg.height * scale;

    const posX = state.signPlacement ? state.signPlacement.x : (canvas.width - sigW) / 2;
    const posY = state.signPlacement ? state.signPlacement.y : (canvas.height - sigH) / 2;

    fabricImg.set({
        left: Math.max(0, Math.min(canvas.width - sigW, posX)),
        top: Math.max(0, Math.min(canvas.height - sigH, posY)),
        originX: 'left',
        originY: 'top',
        hasRotatingPoint: true,
        backgroundColor: 'transparent',
    });

    canvas.add(fabricImg);
    canvas.setActiveObject(fabricImg);
    canvas.renderAll();

    state.signPlacement = null;
    closeSignatureModal();
    clearSigDrawCanvas();
}

// ---------------------------------------------------------------------------
// 7. Zoom & Grid Guidelines
// ---------------------------------------------------------------------------
function applyZoom(newZoom) {
    state.zoom = Math.min(2.0, Math.max(0.4, newZoom));
    zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;

    state.pages.forEach((p) => {
        p.container.style.transform = `scale(${state.zoom})`;
        p.container.style.transformOrigin = 'top center';
        p.container.parentElement.style.height = `${p.height * state.zoom + 32}px`;
        p.container.parentElement.style.width = `${p.width * state.zoom}px`;
    });
}

function toggleGrid() {
    state.showGrid = !state.showGrid;
    btnToggleGrid.classList.toggle('bg-indigo-100', state.showGrid);
    btnToggleGrid.classList.toggle('text-indigo-900', state.showGrid);

    state.pages.forEach((p) => {
        let gridEl = p.container.querySelector('.guidelines-grid');
        if (state.showGrid) {
            if (!gridEl) {
                gridEl = document.createElement('div');
                gridEl.className = 'guidelines-grid pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:20px_20px] opacity-40';
                p.container.appendChild(gridEl);
            }
        } else if (gridEl) {
            gridEl.remove();
        }
    });
}

// ---------------------------------------------------------------------------
// 8. Export Modified PDF (High-Fidelity pdf-lib Compositor)
// ---------------------------------------------------------------------------
async function exportPdfDocument() {
    if (state.pages.length === 0) {
        alert('No document to export.');
        return;
    }

    btnExportPdf.disabled = true;
    const originalText = btnExportPdf.innerHTML;
    btnExportPdf.innerHTML = `
        <svg class="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
        <span>Exporting...</span>
    `;

    try {
        let targetPdfDoc;
        if (state.pdfBytes) {
            targetPdfDoc = await window.PDFLib.PDFDocument.load(state.pdfBytes);
        } else {
            targetPdfDoc = await window.PDFLib.PDFDocument.create();
        }

        // Handle page modifications & newly added pages
        for (let i = 0; i < state.pages.length; i++) {
            const pageData = state.pages[i];
            let pdfPage;

            if (pageData.isNew || i >= targetPdfDoc.getPageCount()) {
                pdfPage = targetPdfDoc.addPage([pageData.width, pageData.height]);
            } else {
                pdfPage = targetPdfDoc.getPage(i);
            }

            // High-resolution overlay render (2x multiplier)
            const overlayPngUrl = pageData.fabricCanvas.toDataURL({
                format: 'png',
                multiplier: 2,
            });

            // If canvas has any added objects or drawings
            if (pageData.fabricCanvas.getObjects().length > 0) {
                const overlayPngBytes = await fetch(overlayPngUrl).then((r) => r.arrayBuffer());
                const embeddedPng = await targetPdfDoc.embedPng(overlayPngBytes);

                pdfPage.drawImage(embeddedPng, {
                    x: 0,
                    y: 0,
                    width: pdfPage.getWidth(),
                    height: pdfPage.getHeight(),
                });
            }
        }

        const finalBytes = await targetPdfDoc.save();
        const blob = new Blob([finalBytes], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = 'document_edited.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
    } catch (err) {
        console.error('PDF export failed:', err);
        alert('Failed to export PDF: ' + err.message);
    } finally {
        btnExportPdf.disabled = false;
        btnExportPdf.innerHTML = originalText;
    }
}

// ---------------------------------------------------------------------------
// 9. Event Listeners Initialization
// ---------------------------------------------------------------------------
function initApp() {
    initSignaturePad();

    // File Upload
    const onFileSelected = (e) => {
        const file = e.target.files && e.target.files[0];
        if (file && file.type === 'application/pdf') {
            const reader = new FileReader();
            reader.onload = (evt) => loadPdfBuffer(evt.target.result, file.name);
            reader.readAsArrayBuffer(file);
        }
    };
    pdfFileInput.addEventListener('change', onFileSelected);
    emptyFileInput.addEventListener('change', onFileSelected);
    btnStartBlank.addEventListener('click', startWithBlankA4);
    btnAddPage.addEventListener('click', appendBlankPage);
    btnExportPdf.addEventListener('click', exportPdfDocument);

    // Zoom
    btnZoomIn.addEventListener('click', () => applyZoom(state.zoom + 0.15));
    btnZoomOut.addEventListener('click', () => applyZoom(state.zoom - 0.15));
    btnFitWidth.addEventListener('click', () => {
        const mainW = document.querySelector('main').clientWidth - 64;
        const pageW = state.pages[0] ? state.pages[0].width : A4_WIDTH;
        applyZoom(mainW / pageW);
    });
    btnToggleGrid.addEventListener('click', toggleGrid);

    // Tool switching
    toolButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tool = btn.dataset.tool;
            if (tool === 'edit-text') {
                makePageTextEditable(state.activePageIndex);
            } else if (tool === 'table') {
                tableModal.classList.remove('hidden');
            } else {
                setActiveTool(tool);
            }
        });
    });

    // Shapes dropdown
    toolShapesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        shapesMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => shapesMenu.classList.add('hidden'));

    shapesMenu.querySelectorAll('[data-shape]').forEach((btn) => {
        btn.addEventListener('click', () => addShape(btn.dataset.shape));
    });

    // Image Upload
    imageUploadInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) handleImageUpload(file);
        imageUploadInput.value = '';
    });

    // Banners controls
    btnCancelSignTool?.addEventListener('click', () => setActiveTool('select'));
    btnOpenSignPadNow?.addEventListener('click', () => openSignatureModal());
    btnCancelTextTool?.addEventListener('click', () => setActiveTool('select'));
    btnAddTextCenter?.addEventListener('click', () => addText());

    // Context Property Bar Bindings
    propFontFamily.addEventListener('change', (e) => {
        if (state.selectedObject) {
            state.selectedObject.set('fontFamily', e.target.value);
            getActiveCanvas().renderAll();
        }
    });

    propFontSize.addEventListener('input', (e) => {
        if (state.selectedObject) {
            state.selectedObject.set('fontSize', parseInt(e.target.value, 10));
            getActiveCanvas().renderAll();
        }
    });

    propBold.addEventListener('click', () => {
        if (state.selectedObject) {
            const isBold = state.selectedObject.fontWeight === 'bold';
            state.selectedObject.set('fontWeight', isBold ? 'normal' : 'bold');
            propBold.classList.toggle('bg-slate-200', !isBold);
            getActiveCanvas().renderAll();
        }
    });

    propItalic.addEventListener('click', () => {
        if (state.selectedObject) {
            const isItalic = state.selectedObject.fontStyle === 'italic';
            state.selectedObject.set('fontStyle', isItalic ? 'normal' : 'italic');
            propItalic.classList.toggle('bg-slate-200', !isItalic);
            getActiveCanvas().renderAll();
        }
    });

    propUnderline.addEventListener('click', () => {
        if (state.selectedObject) {
            const isUnderline = Boolean(state.selectedObject.underline);
            state.selectedObject.set('underline', !isUnderline);
            propUnderline.classList.toggle('bg-slate-200', !isUnderline);
            getActiveCanvas().renderAll();
        }
    });

    propTextColor.addEventListener('input', (e) => {
        if (state.selectedObject) {
            state.selectedObject.set('fill', e.target.value);
            getActiveCanvas().renderAll();
        }
    });

    propFillColor.addEventListener('input', (e) => {
        if (state.selectedObject) {
            state.selectedObject.set('fill', e.target.value);
            getActiveCanvas().renderAll();
        }
    });

    propStrokeColor.addEventListener('input', (e) => {
        if (state.selectedObject) {
            state.selectedObject.set('stroke', e.target.value);
            getActiveCanvas().renderAll();
        }
    });

    propStrokeWidth.addEventListener('input', (e) => {
        if (state.selectedObject) {
            state.selectedObject.set('strokeWidth', parseInt(e.target.value, 10));
            getActiveCanvas().renderAll();
        }
    });

    propBringForward.addEventListener('click', () => {
        if (state.selectedObject) {
            getActiveCanvas().bringForward(state.selectedObject);
            getActiveCanvas().renderAll();
        }
    });

    propSendBackward.addEventListener('click', () => {
        if (state.selectedObject) {
            getActiveCanvas().sendBackwards(state.selectedObject);
            getActiveCanvas().renderAll();
        }
    });

    propDelete.addEventListener('click', () => {
        if (state.selectedObject) {
            getActiveCanvas().remove(state.selectedObject);
            onSelectionCleared();
            getActiveCanvas().renderAll();
        }
    });

    // Delete key shortcut
    window.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedObject && !state.selectedObject.isEditing) {
            getActiveCanvas().remove(state.selectedObject);
            onSelectionCleared();
            getActiveCanvas().renderAll();
        }
    });

    // Page deletion delegate
    pagesViewport.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.btn-delete-page');
        if (delBtn) {
            const pIdx = parseInt(delBtn.dataset.pageIndex, 10);
            deletePage(pIdx);
        }
    });

    // Signature Modal events
    tabDrawBtn.addEventListener('click', () => switchSigTab('draw'));
    tabUploadBtn.addEventListener('click', () => switchSigTab('upload'));
    modalCloseBtn.addEventListener('click', closeSignatureModal);
    modalCancelBtn.addEventListener('click', closeSignatureModal);
    modalConfirmSigBtn.addEventListener('click', confirmAndPlaceSignature);

    sigImageFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                const img = new Image();
                img.onload = () => {
                    state.uploadedSigImg = img;
                    updateUploadedSigPreview();
                };
                img.src = evt.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    cutoffSlider.addEventListener('input', updateUploadedSigPreview);
    document.querySelectorAll('input[name="sig-ink-recolor"]').forEach((r) => r.addEventListener('change', updateUploadedSigPreview));

    // Table Modal
    tableModalClose.addEventListener('click', () => tableModal.classList.add('hidden'));
    tableModalCancel.addEventListener('click', () => tableModal.classList.add('hidden'));
    tableModalInsert.addEventListener('click', () => {
        const r = parseInt(tableRowsInput.value, 10) || 3;
        const c = parseInt(tableColsInput.value, 10) || 3;
        insertTable(r, c);
        tableModal.classList.add('hidden');
    });
}

// Boot
window.addEventListener('DOMContentLoaded', initApp);
