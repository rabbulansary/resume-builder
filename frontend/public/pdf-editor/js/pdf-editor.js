import * as pdfjsLib from '/pdf-editor/vendor/pdf.min.mjs';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf-editor/vendor/pdf.worker.min.mjs';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const EXPORT_OVERLAY_SCALE = 3;

// State
const state = {
    pdfDoc: null,
    pdfBytes: null,
    pages: [], // Array of { index, width, height, container, bgCanvas, fabricCanvas, sourceIndex, textItems, lines }
    zoom: 1.0,
    activeTool: 'select',
    activePageIndex: 0,
    penColor: '#000000',
    penWidth: 2,
    highlighterColor: '#fde047',
    highlighterWidth: 18,
    signPlacement: null, // { pageIndex, x, y }
    showGrid: false,
    selectedObject: null,
    uploadedSigImg: null,
};

function overlayDensity(zoom) {
    const displayDensity = window.devicePixelRatio || 1;
    // Quantize zoom-driven changes and cap the backing size for multipage documents.
    const zoomDensity = Math.ceil(displayDensity * zoom * 2) / 2;
    return Math.min(Math.max(3, displayDensity), Math.max(2, displayDensity, zoomDensity));
}

class EditCanvas extends window.fabric.Canvas {
    renderDensity = overlayDensity(state.zoom);

    getRetinaScaling() {
        if (!this.enableRetinaScaling) return 1;
        // Fabric also calls this during construction, before field initialization.
        return this.renderDensity ?? overlayDensity(state.zoom);
    }

    updateRenderDensity(zoom) {
        const density = overlayDensity(zoom);
        if (density === this.renderDensity) return;
        this.renderDensity = density;
        // Keep the page coordinates and CSS layout unchanged while reallocating both canvas layers.
        this.setDimensions({ width: this.width, height: this.height }, { backstoreOnly: true });
    }
}

// DOM Elements
const docMeta = document.getElementById('doc-meta');
const emptyState = document.getElementById('empty-state');
const pagesViewport = document.getElementById('pages-viewport');
const workspaceContainer = document.getElementById('workspace-container');
const toolOptions = document.getElementById('tool-options');
const optionButtons = toolOptions.querySelectorAll('button[aria-controls]');
let openOption = null;
const dockHistory = document.getElementById('dock-history');
const dockTools = document.getElementById('dock-tools');
const viewportControls = document.getElementById('viewport-controls');
const dockPageNav = document.getElementById('editor-footer');
const btnPrevPage = document.getElementById('btn-prev-page');
const btnNextPage = document.getElementById('btn-next-page');
const pageNavLabel = document.getElementById('page-nav-label');
const zoomInput = document.getElementById('zoom-input');
const zoomLabel = document.getElementById('zoom-label');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnFitWidth = document.getElementById('btn-fit-width');
const btnToggleGrid = document.getElementById('btn-toggle-grid');
const documentActions = document.getElementById('document-actions');
const btnUploadPdf = document.getElementById('btn-upload-pdf');
const btnAddPage = document.getElementById('btn-add-page');
const btnExportPdf = document.getElementById('btn-export-pdf');
const pdfFileInput = document.getElementById('pdf-file-input');
const emptyFileInput = document.getElementById('empty-file-input');
const btnStartBlank = document.getElementById('btn-start-blank');
const imageUploadInput = document.getElementById('image-upload-input');
const btnCancelSignTool = document.getElementById('btn-cancel-sign-tool');
const btnOpenSignPadNow = document.getElementById('btn-open-sign-pad-now');
const btnCancelTextTool = document.getElementById('btn-cancel-text-tool');
const btnAddTextCenter = document.getElementById('btn-add-text-center');

// Edit PDF Text Tool Banner Elements
const btnCancelEditTextTool = document.getElementById('btn-cancel-edit-text-tool');

// Pen & Highlighter Controls DOM
const propPenColor = document.getElementById('prop-pen-color');
const propPenWidth = document.getElementById('prop-pen-width');
const propHighlighterColor = document.getElementById('prop-highlighter-color');
const propHighlighterWidth = document.getElementById('prop-highlighter-width');

// History Undo / Redo DOM Elements
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');

// Hand Tool & Panning State
let panGesture = null;
let isSpacePressed = false;
let previousToolBeforeSpace = null;

// ---------------------------------------------------------------------------
// 0. Doubly Linked List History Engine (Undo / Redo Architecture)
// ---------------------------------------------------------------------------
class HistoryNode {
    constructor(action) {
        this.action = action; // { pageIndex, undo(), redo(), description }
        this.prev = null;
        this.next = null;
    }
}

class HistoryManager {
    constructor(maxSize = 50) {
        this.head = null;
        this.tail = null;
        this.current = null;
        this.size = 0;
        this.maxSize = maxSize;
        this.isExecuting = false;
    }

    push(action) {
        if (this.isExecuting) return;

        const node = new HistoryNode(action);

        if (!this.current) {
            // First action in history
            this.head = node;
            this.tail = node;
            this.current = node;
            this.size = 1;
        } else {
            // Truncate forward redo branch (replace next with new node)
            this.current.next = node;
            node.prev = this.current;
            this.current = node;
            this.tail = node;

            // Recalculate size from head to current
            let count = 0;
            let temp = this.head;
            while (temp) {
                count++;
                if (temp === this.current) break;
                temp = temp.next;
            }
            this.size = count;

            // Cap at maxSize by advancing head pointer
            while (this.size > this.maxSize && this.head && this.head !== this.current) {
                this.head = this.head.next;
                if (this.head) this.head.prev = null;
                this.size--;
            }
        }

        this.updateUI();
    }

    canUndo() {
        return this.current !== null;
    }

    canRedo() {
        return this.current ? this.current.next !== null : this.head !== null;
    }

    undo() {
        if (!this.canUndo() || this.isExecuting) return false;

        // Reset active drawing/text tool to select to avoid overlapping toolbars
        if (typeof setActiveTool === 'function') {
            setActiveTool('select');
        }

        this.isExecuting = true;
        try {
            const action = this.current.action;
            if (typeof action.pageIndex === 'number' && state.pages[action.pageIndex]) {
                state.activePageIndex = action.pageIndex;
            }

            action.undo();

            // Advance pointer backward
            this.current = this.current.prev;
        } catch (err) {
            console.error('Undo operation failed:', err);
        } finally {
            this.isExecuting = false;
            this.updateUI();
        }
        return true;
    }

    redo() {
        if (!this.canRedo() || this.isExecuting) return false;

        // Reset active drawing/text tool to select to avoid overlapping toolbars
        if (typeof setActiveTool === 'function') {
            setActiveTool('select');
        }

        this.isExecuting = true;
        try {
            const nodeToRedo = this.current ? this.current.next : this.head;
            if (!nodeToRedo) return false;

            const action = nodeToRedo.action;
            if (typeof action.pageIndex === 'number' && state.pages[action.pageIndex]) {
                state.activePageIndex = action.pageIndex;
            }

            action.redo();

            // Advance pointer forward
            this.current = nodeToRedo;
        } catch (err) {
            console.error('Redo operation failed:', err);
        } finally {
            this.isExecuting = false;
            this.updateUI();
        }
        return true;
    }

    removePage(pageIndex) {
        for (let node = this.head; node; node = node.next) {
            const action = node.action;
            if (action.pageIndex > pageIndex) {
                action.pageIndex--;
            } else if (action.pageIndex === pageIndex) {
                if (node.prev) node.prev.next = node.next;
                else this.head = node.next;
                if (node.next) node.next.prev = node.prev;
                else this.tail = node.prev;
                if (this.current === node) this.current = node.prev;
                this.size--;
            }
        }
        this.updateUI();
    }

    clear() {
        this.head = null;
        this.tail = null;
        this.current = null;
        this.size = 0;
        this.updateUI();
    }

    updateUI() {
        const canU = this.canUndo();
        const canR = this.canRedo();
        if (btnUndo) {
            btnUndo.disabled = !canU;
            btnUndo.classList.toggle('opacity-40', !canU);
            btnUndo.classList.toggle('cursor-not-allowed', !canU);
        }
        if (btnRedo) {
            btnRedo.disabled = !canR;
            btnRedo.classList.toggle('opacity-40', !canR);
            btnRedo.classList.toggle('cursor-not-allowed', !canR);
        }
    }
}

const historyManager = new HistoryManager(50);

function hexToRgba(hex, alpha = 0.45) {
    if (!hex) return `rgba(254, 240, 138, ${alpha})`;
    if (hex.startsWith('rgba')) return hex;
    if (hex.startsWith('rgb')) {
        return hex.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
    }
    let c = hex.replace('#', '');
    if (c.length === 3) {
        c = c.split('').map((char) => char + char).join('');
    }
    const num = parseInt(c, 16);
    if (Number.isNaN(num)) return `rgba(254, 240, 138, ${alpha})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
const propFontFamily = document.getElementById('prop-font-family');
const propFontSize = document.getElementById('prop-font-size');
const propTextAlign = document.getElementById('prop-text-align');
const propBold = document.getElementById('prop-bold');
const propItalic = document.getElementById('prop-italic');
const propUnderline = document.getElementById('prop-underline');
const propTextColor = document.getElementById('prop-text-color');
const propFillColor = document.getElementById('prop-fill-color');
const propNoFill = document.getElementById('prop-no-fill');
const propStrokeColor = document.getElementById('prop-stroke-color');
const propStrokeWidth = document.getElementById('prop-stroke-width');
const propBringForward = document.getElementById('prop-bring-forward');
const propSendBackward = document.getElementById('prop-send-backward');
const propDelete = document.getElementById('prop-delete');

// Tool buttons
const toolButtons = document.querySelectorAll('[data-tool]');
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

const btnCancelTable = document.getElementById('btn-cancel-table');
const btnInsertTable = document.getElementById('btn-insert-table');
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
function showDocumentWorkspace() {
    documentActions.hidden = false;
    const { paddingLeft, paddingRight } = getComputedStyle(pagesViewport);
    const leftGutter = parseFloat(paddingLeft);
    const documentWidth = pagesViewport.clientWidth - leftGutter - parseFloat(paddingRight);
    const wideDocument = documentWidth > workspaceContainer.clientWidth;
    // Show the document on open while leaving both horizontal gutters available for panning.
    workspaceContainer.scrollLeft = wideDocument ? Math.max(0, leftGutter - 64) : leftGutter;
    scrollToPage(0, 'instant');
}

async function loadPdfBuffer(buffer, filename = 'document.pdf') {
    historyManager.clear();
    state.pdfBytes = new Uint8Array(buffer);
    state.pages = [];
    state.activePageIndex = 0;
    pagesViewport.innerHTML = '';

    // PDF.js transfers its input buffer to the worker. Keep the original for export.
    const loadingTask = pdfjsLib.getDocument({ data: state.pdfBytes.slice() });
    state.pdfDoc = await loadingTask.promise;

    docMeta.textContent = `${filename} • ${state.pdfDoc.numPages} ${state.pdfDoc.numPages === 1 ? 'page' : 'pages'}`;
    emptyState.classList.add('hidden');
    pagesViewport.classList.remove('hidden');
    dockHistory?.classList.remove('hidden');
    dockHistory?.classList.add('flex');
    dockTools?.classList.remove('hidden');
    dockTools?.classList.add('flex');
    viewportControls?.classList.remove('hidden');
    viewportControls?.classList.add('flex');
    dockPageNav.hidden = false;

    for (let pageNum = 1; pageNum <= state.pdfDoc.numPages; pageNum++) {
        await createPageElement(pageNum);
    }

    applyZoom(1.0);
    showDocumentWorkspace();
}

function startWithBlankA4() {
    historyManager.clear();
    state.pdfDoc = null;
    state.pdfBytes = null;
    state.pages = [];
    state.activePageIndex = 0;
    pagesViewport.innerHTML = '';

    docMeta.textContent = 'Untitled Document • 1 page';
    emptyState.classList.add('hidden');
    pagesViewport.classList.remove('hidden');
    dockHistory?.classList.remove('hidden');
    dockHistory?.classList.add('flex');
    dockTools?.classList.remove('hidden');
    dockTools?.classList.add('flex');
    viewportControls?.classList.remove('hidden');
    viewportControls?.classList.add('flex');
    dockPageNav.hidden = false;

    appendBlankPage();
    applyZoom(1.0);
    showDocumentWorkspace();
}

async function createPageElement(pageNum) {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });

    const pageIndex = pageNum - 1;
    const width = viewport.width;
    const height = viewport.height;

    const scaledWidth = Math.round(width * state.zoom);
    const scaledHeight = Math.round(height * state.zoom);

    const pageContainer = document.createElement('div');
    pageContainer.className = 'relative flex flex-col items-center group';
    pageContainer.dataset.pageIndex = pageIndex;
    pageContainer.style.width = `${scaledWidth}px`;

    // Header badge
    const header = document.createElement('div');
    header.className = 'w-full flex items-center justify-between py-1 px-1 text-xs font-semibold text-slate-500';
    header.innerHTML = `
        <span class="rounded bg-slate-200/80 px-2 py-0.5">Page ${pageNum}</span>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button class="btn-delete-page rounded px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50 cursor-pointer" data-page-index="${pageIndex}" title="Delete Page">Delete</button>
        </div>
    `;

    // Scale wrapper maintains exact scaled layout box in document flow
    const scaleWrapper = document.createElement('div');
    scaleWrapper.className = 'page-scale-wrapper relative rounded-sm shadow-xl bg-white overflow-hidden transition-all';
    scaleWrapper.style.width = `${scaledWidth}px`;
    scaleWrapper.style.height = `${scaledHeight}px`;

    // Canvas container
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'absolute top-0 left-0 transition-none';
    canvasWrap.style.width = `${width}px`;
    canvasWrap.style.height = `${height}px`;
    canvasWrap.style.transform = `scale(${state.zoom})`;
    canvasWrap.style.transformOrigin = '0 0';

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

    // Extract text items from PDF.js for click-to-edit and Edit PDF Text Mode
    const textItems = [];
    try {
        const textContent = await page.getTextContent();
        for (const item of textContent.items) {
            if (!item.str || !item.str.trim()) continue;
            const tx = item.transform[4];
            const ty = item.transform[5];
            const [vx, vy] = viewport.convertToViewportPoint(tx, ty);
            const fontSize = Math.hypot(item.transform[2], item.transform[3]) || item.height || 12;
            const fontName = item.fontName || '';
            const style = textContent.styles && textContent.styles[fontName];
            const isBold = /bold/i.test(fontName) || (style && /bold/i.test(style.fontFamily));
            const isItalic = /italic|oblique/i.test(fontName) || (style && /italic|oblique/i.test(style.fontFamily));
            let fontFamily = 'Arial';
            if (/times/i.test(fontName) || (style && /times|serif/i.test(style.fontFamily))) {
                fontFamily = 'Times New Roman';
            } else if (/courier|mono/i.test(fontName) || (style && /mono/i.test(style.fontFamily))) {
                fontFamily = 'Courier New';
            } else if (/georgia/i.test(fontName)) {
                fontFamily = 'Georgia';
            }

            textItems.push({
                str: item.str,
                x: Math.round(vx),
                y: Math.round(Math.max(0, vy - fontSize * 0.85)),
                width: Math.round(item.width),
                height: Math.round(Math.max(12, fontSize * 1.15)),
                fontSize: Math.max(8, Math.round(fontSize)),
                fontFamily,
                fontWeight: isBold ? 'bold' : 'normal',
                fontStyle: isItalic ? 'italic' : 'normal',
                fill: '#000000',
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
    scaleWrapper.appendChild(canvasWrap);
    pageContainer.appendChild(header);
    pageContainer.appendChild(scaleWrapper);
    pagesViewport.appendChild(pageContainer);

    // Initialize Fabric Canvas
    const fabricCanvas = new EditCanvas(fabricCanvasEl, {
        width,
        height,
        selection: true,
        preserveObjectStacking: true,
    });

    const lines = groupTextItemsIntoLines(textItems);

    const pageData = {
        index: pageIndex,
        width,
        height,
        container: canvasWrap,
        bgCanvas,
        fabricCanvas,
        sourceIndex: pageIndex,
        textItems,
        lines,
    };

    state.pages.push(pageData);
    bindFabricEvents(pageData);
}

function groupTextItemsIntoLines(items) {
    if (!items || items.length === 0) return [];
    const sorted = [...items].sort((a, b) => {
        if (Math.abs(a.y - b.y) <= 3) {
            return a.x - b.x;
        }
        return a.y - b.y;
    });

    const lines = [];
    let current = null;

    for (const item of sorted) {
        if (!current) {
            current = { ...item };
            continue;
        }

        const sameY = Math.abs(current.y - item.y) <= 4;
        const currentRight = current.x + current.width;
        const gap = item.x - currentRight;
        const maxGap = Math.max(16, current.fontSize * 1.6);
        const isAdjacent = gap >= -4 && gap <= maxGap;
        const sameStyle = current.fontWeight === item.fontWeight && current.fontStyle === item.fontStyle;

        if (sameY && isAdjacent && sameStyle) {
            const needSpace = !current.str.endsWith(' ') && !item.str.startsWith(' ') && gap > 1;
            current.str += (needSpace ? ' ' : '') + item.str;
            current.width = (item.x + item.width) - current.x;
            current.height = Math.max(current.height, item.height);
        } else {
            lines.push(current);
            current = { ...item };
        }
    }
    if (current) lines.push(current);

    return lines;
}

function findTextLineAt(lines, px, py) {
    if (!lines || lines.length === 0) return null;
    let closestLine = null;
    let minDistance = Infinity;

    for (const line of lines) {
        if (line.isActivated) continue;
        const withinX = px >= line.x - 6 && px <= line.x + line.width + 6;
        const withinY = py >= line.y - 4 && py <= line.y + line.height + 4;
        if (withinX && withinY) {
            const centerY = line.y + line.height / 2;
            const dist = Math.abs(centerY - py);
            if (dist < minDistance) {
                minDistance = dist;
                closestLine = line;
            }
        }
    }
    return closestLine;
}

function activateTextLine(pageData, line) {
    if (!pageData || !line || line.isActivated) return null;
    const canvas = pageData.fabricCanvas;
    const bgCanvas = pageData.bgCanvas;
    if (!canvas || !bgCanvas) return null;

    const bgCtx = bgCanvas.getContext('2d');

    // 1. Snapshot original background pixels before whiteout masking
    const padX = 2;
    const padY = 1;
    const maskLeft = Math.max(0, (line.x - padX) * 2);
    const maskTop = Math.max(0, (line.y - padY) * 2);
    const maskW = (line.width + padX * 2) * 2;
    const maskH = (line.height + padY * 2) * 2;

    const savedBgPixels = bgCtx.getImageData(maskLeft, maskTop, maskW, maskH);

    bgCtx.fillStyle = '#ffffff';
    bgCtx.fillRect(maskLeft, maskTop, maskW, maskH);

    // 2. Whiteout mask Rect on Fabric canvas so export permanently covers this original text
    const maskRect = new window.fabric.Rect({
        left: line.x - padX,
        top: line.y - padY,
        width: line.width + padX * 2,
        height: line.height + padY * 2,
        fill: '#ffffff',
        selectable: false,
        evented: false,
        originX: 'left',
        originY: 'top',
    });
    canvas.add(maskRect);

    // 3. Live editable IText object for ONLY this selected part
    const textObj = new window.fabric.IText(line.str, {
        left: line.x,
        top: line.y,
        originX: 'left',
        originY: 'top',
        fontSize: line.fontSize,
        fontFamily: line.fontFamily || 'Arial',
        fontWeight: line.fontWeight || 'normal',
        fontStyle: line.fontStyle || 'normal',
        fill: line.fill || '#000000',
        backgroundColor: '#ffffff',
        padding: 2,
        isOriginalText: true,
        maskRectRef: maskRect,
        originalBBox: {
            x: line.x - padX,
            y: line.y - padY,
            width: line.width + padX * 2,
            height: line.height + padY * 2,
        },
    });

    line.isActivated = true;
    line.fabricObject = textObj;

    canvas.add(textObj);
    canvas.setActiveObject(textObj);
    textObj.enterEditing();
    canvas.renderAll();

    // Record Action in History
    historyManager.push({
        pageIndex: pageData.index,
        description: 'Edit PDF Text',
        undo: () => {
            bgCtx.putImageData(savedBgPixels, maskLeft, maskTop);
            canvas.remove(textObj);
            canvas.remove(maskRect);
            line.isActivated = false;
            line.fabricObject = null;
            canvas.discardActiveObject();
            canvas.renderAll();
            onSelectionCleared();
        },
        redo: () => {
            bgCtx.fillStyle = '#ffffff';
            bgCtx.fillRect(maskLeft, maskTop, maskW, maskH);
            canvas.add(maskRect);
            canvas.add(textObj);
            line.isActivated = true;
            line.fabricObject = textObj;
            canvas.setActiveObject(textObj);
            canvas.renderAll();
        },
    });

    return textObj;
}

function deleteSelectedObject() {
    const canvas = getActiveCanvas();
    if (!canvas || !state.selectedObject) return;
    const obj = state.selectedObject;
    const pageIndex = state.activePageIndex;

    let createdMask = null;
    if (obj.isOriginalText && obj.originalBBox) {
        if (!obj.maskRectRef) {
            createdMask = new window.fabric.Rect({
                left: obj.originalBBox.x,
                top: obj.originalBBox.y,
                width: obj.originalBBox.width,
                height: obj.originalBBox.height,
                fill: '#ffffff',
                selectable: false,
                evented: false,
                originX: 'left',
                originY: 'top',
            });
            canvas.add(createdMask);
            canvas.sendObjectToBack(createdMask);
        }
    }
    canvas.remove(obj);
    onSelectionCleared();
    canvas.renderAll();

    historyManager.push({
        pageIndex,
        description: 'Delete Object',
        undo: () => {
            if (createdMask) canvas.remove(createdMask);
            canvas.add(obj);
            canvas.setActiveObject(obj);
            canvas.renderAll();
        },
        redo: () => {
            if (createdMask) {
                canvas.add(createdMask);
                canvas.sendObjectToBack(createdMask);
            }
            canvas.remove(obj);
            canvas.discardActiveObject();
            onSelectionCleared();
            canvas.renderAll();
        },
    });
}

function appendBlankPage() {
    const pageIndex = state.pages.length;
    const width = A4_WIDTH;
    const height = A4_HEIGHT;

    const scaledWidth = Math.round(width * state.zoom);
    const scaledHeight = Math.round(height * state.zoom);

    const pageContainer = document.createElement('div');
    pageContainer.className = 'relative flex flex-col items-center group';
    pageContainer.dataset.pageIndex = pageIndex;
    pageContainer.style.width = `${scaledWidth}px`;

    const header = document.createElement('div');
    header.className = 'w-full flex items-center justify-between py-1 px-1 text-xs font-semibold text-slate-500';
    header.innerHTML = `
        <span class="rounded bg-slate-200/80 px-2 py-0.5">Page ${pageIndex + 1} (Blank)</span>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button class="btn-delete-page rounded px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50 cursor-pointer" data-page-index="${pageIndex}" title="Delete Page">Delete</button>
        </div>
    `;

    // Scale wrapper maintains exact scaled layout box in document flow
    const scaleWrapper = document.createElement('div');
    scaleWrapper.className = 'page-scale-wrapper relative rounded-sm shadow-xl bg-white overflow-hidden transition-all';
    scaleWrapper.style.width = `${scaledWidth}px`;
    scaleWrapper.style.height = `${scaledHeight}px`;

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'absolute top-0 left-0 transition-none';
    canvasWrap.style.width = `${width}px`;
    canvasWrap.style.height = `${height}px`;
    canvasWrap.style.transform = `scale(${state.zoom})`;
    canvasWrap.style.transformOrigin = '0 0';

    const fabricCanvasEl = document.createElement('canvas');
    fabricCanvasEl.id = `fabric-canvas-${pageIndex}`;
    fabricCanvasEl.width = width;
    fabricCanvasEl.height = height;

    canvasWrap.appendChild(fabricCanvasEl);
    scaleWrapper.appendChild(canvasWrap);
    pageContainer.appendChild(header);
    pageContainer.appendChild(scaleWrapper);
    pagesViewport.appendChild(pageContainer);

    const fabricCanvas = new EditCanvas(fabricCanvasEl, {
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
    };

    state.pages.push(pageData);
    bindFabricEvents(pageData);
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
    target.container.closest('[data-page-index]').remove();
    historyManager.removePage(pageIndex);

    state.pages.splice(pageIndex, 1);
    if (state.activePageIndex > pageIndex) state.activePageIndex--;
    state.activePageIndex = Math.min(state.activePageIndex, state.pages.length - 1);
    // Reindex remaining pages
    state.pages.forEach((p, idx) => {
        p.index = idx;
        const cont = p.container ? p.container.closest('[data-page-index]') : null;
        if (cont) {
            cont.dataset.pageIndex = idx;
            const badge = cont.querySelector('span');
            if (badge) badge.textContent = `Page ${idx + 1}`;
            const delBtn = cont.querySelector('.btn-delete-page');
            if (delBtn) delBtn.dataset.pageIndex = idx;
        }
    });
    updatePageNavUI();
}

// ---------------------------------------------------------------------------
// 4. Fabric.js Canvas Event Binding & Tools Interaction
// ---------------------------------------------------------------------------
function bindFabricEvents(pageData) {
    const fCanvas = pageData.fabricCanvas;
    let dragMarqueeEl = null;
    let dragStart = null;

    fCanvas.on('mouse:down', (opt) => {
        state.activePageIndex = pageData.index;
        const pointer = getCanvasPointer(opt, fCanvas);

        // If Signature tool is primed, click-to-place triggers the signature modal!
        if (state.activeTool === 'sign') {
            state.signPlacement = {
                pageIndex: pageData.index,
                x: pointer.x,
                y: pointer.y,
            };
            openSignatureModal();
            return;
        }

        // If Edit PDF Text tool is active: user selects a part of the PDF by clicking or dragging a box
        if (state.activeTool === 'edit-text') {
            if (opt.target && (opt.target.type === 'i-text' || opt.target.type === 'text')) {
                fCanvas.setActiveObject(opt.target);
                opt.target.enterEditing();
                return;
            }
            dragStart = { x: pointer.x, y: pointer.y };
            fCanvas.selection = false;
            return;
        }

        // If Text tool is primed, click-to-place text at clicked position!
        if (state.activeTool === 'text') {
            if (opt.target) return; // Clicking an existing object selects it instead
            const matchedText = findTextItemAt(pageData.textItems, pointer.x, pointer.y);
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
            const fontFamily = propFontFamily?.value || 'Arial';
            const fontSize = parseInt(propFontSize?.value, 10) || 14;
            const fill = propTextColor?.value || '#000000';

            const textObj = new window.fabric.IText('Type text here', {
                left: Math.round(pointer.x),
                top: Math.round(pointer.y),
                originX: 'left',
                originY: 'top',
                fontFamily,
                fontSize,
                fill,
            });
            fCanvas.add(textObj);
            fCanvas.setActiveObject(textObj);
            textObj.enterEditing();
            textObj.selectAll();
            fCanvas.renderAll();

            historyManager.push({
                pageIndex: pageData.index,
                description: 'Add Text Box',
                undo: () => {
                    fCanvas.remove(textObj);
                    fCanvas.discardActiveObject();
                    fCanvas.renderAll();
                    onSelectionCleared();
                },
                redo: () => {
                    fCanvas.add(textObj);
                    fCanvas.setActiveObject(textObj);
                    fCanvas.renderAll();
                },
            });

            setActiveTool('select');
            return;
        }
    });

    fCanvas.on('mouse:move', (opt) => {
        const pointer = getCanvasPointer(opt, fCanvas);

        if (state.activeTool === 'edit-text') {
            if (dragStart) {
                const x = Math.min(dragStart.x, pointer.x);
                const y = Math.min(dragStart.y, pointer.y);
                const w = Math.abs(pointer.x - dragStart.x);
                const h = Math.abs(pointer.y - dragStart.y);

                if (w > 4 || h > 4) {
                    if (!dragMarqueeEl && pageData && pageData.container) {
                        dragMarqueeEl = document.createElement('div');
                        dragMarqueeEl.className = 'absolute border-2 border-indigo-600 bg-indigo-500/15 pointer-events-none rounded-xs z-30 transition-none shadow-xs';
                        pageData.container.appendChild(dragMarqueeEl);
                    }
                    if (dragMarqueeEl) {
                        dragMarqueeEl.style.left = `${x}px`;
                        dragMarqueeEl.style.top = `${y}px`;
                        dragMarqueeEl.style.width = `${w}px`;
                        dragMarqueeEl.style.height = `${h}px`;
                    }
                }
                return;
            }

            // Hover indicator over unactivated text
            if (!opt.target && pageData && pageData.lines) {
                const line = findTextLineAt(pageData.lines, pointer.x, pointer.y);
                if (line) {
                    fCanvas.defaultCursor = 'text';
                    return;
                }
            }
            fCanvas.defaultCursor = 'default';
        }
    });

    fCanvas.on('mouse:up', (opt) => {
        if (state.activeTool === 'edit-text' && dragStart) {
            const pointer = getCanvasPointer(opt, fCanvas);
            const x = Math.min(dragStart.x, pointer.x);
            const y = Math.min(dragStart.y, pointer.y);
            const w = Math.abs(pointer.x - dragStart.x);
            const h = Math.abs(pointer.y - dragStart.y);

            if (dragMarqueeEl) {
                dragMarqueeEl.remove();
                dragMarqueeEl = null;
            }

            if (w > 6 || h > 6) {
                // Dragged a selection box over a part of the PDF!
                if (pageData && pageData.lines) {
                    const selectedLines = pageData.lines.filter((line) => {
                        if (line.isActivated) return false;
                        return (
                            line.x + line.width >= x &&
                            line.x <= x + w &&
                            line.y + line.height >= y &&
                            line.y <= y + h
                        );
                    });

                    if (selectedLines.length > 0) {
                        selectedLines.forEach((line) => activateTextLine(pageData, line, false));
                        if (selectedLines.length === 1) {
                            fCanvas.setActiveObject(selectedLines[0].fabricObject);
                            selectedLines[0].fabricObject.enterEditing();
                        }
                        fCanvas.renderAll();
                    }
                }
            } else {
                // Single click selection on a specific text line
                if (pageData && pageData.lines) {
                    const line = findTextLineAt(pageData.lines, pointer.x, pointer.y);
                    if (line) {
                        activateTextLine(pageData, line, true);
                        fCanvas.renderAll();
                    }
                }
            }

            dragStart = null;
            fCanvas.selection = true;
        }
    });

    fCanvas.on('mouse:dblclick', ({ target, subTargets }) => {
        if (state.activeTool !== 'select') return;
        const cell = subTargets.find((object) => object.cellText)?.cellText;
        if (!cell) return;

        const previous = cell.text;
        const next = window.prompt('Edit table cell', previous);
        if (next === null || next === previous) return;

        const setText = (value) => {
            cell.set('text', value);
            target.set('dirty', true);
            fCanvas.requestRenderAll();
        };
        setText(next);
        historyManager.push({
            pageIndex: pageData.index,
            description: 'Edit Table Cell',
            undo: () => setText(previous),
            redo: () => setText(next),
        });
    });

    fCanvas.on('selection:created', (e) => onObjectSelected(e.selected[0]));
    fCanvas.on('selection:updated', (e) => onObjectSelected(e.selected[0]));
    fCanvas.on('selection:cleared', () => onSelectionCleared());

    // History Tracking: Freehand Pen & Highlighter Drawing
    fCanvas.on('path:created', (e) => {
        const pathObj = e.path;
        if (!pathObj) return;
        historyManager.push({
            pageIndex: pageData.index,
            description: 'Draw Stroke',
            undo: () => {
                fCanvas.remove(pathObj);
                fCanvas.renderAll();
            },
            redo: () => {
                fCanvas.add(pathObj);
                fCanvas.renderAll();
            },
        });
    });

    // History Tracking: Object Transform (Move, Scale, Rotate)
    fCanvas.on('before:transform', (e) => {
        const target = e.transform ? e.transform.target : null;
        if (target && !target._historyTransformStart) {
            target._historyTransformStart = {
                left: target.left,
                top: target.top,
                scaleX: target.scaleX,
                scaleY: target.scaleY,
                angle: target.angle,
            };
        }
    });

    fCanvas.on('object:modified', (e) => {
        const target = e.target;
        if (!target) return;
        const before = target._historyTransformStart;
        const after = {
            left: target.left,
            top: target.top,
            scaleX: target.scaleX,
            scaleY: target.scaleY,
            angle: target.angle,
        };
        target._historyTransformStart = null;

        if (before && (Math.abs(before.left - after.left) > 0.5 || Math.abs(before.top - after.top) > 0.5 || Math.abs(before.scaleX - after.scaleX) > 0.005 || Math.abs(before.scaleY - after.scaleY) > 0.005 || Math.abs(before.angle - after.angle) > 0.5)) {
            historyManager.push({
                pageIndex: pageData.index,
                description: 'Transform Object',
                undo: () => {
                    target.set(before);
                    target.setCoords();
                    fCanvas.setActiveObject(target);
                    fCanvas.renderAll();
                },
                redo: () => {
                    target.set(after);
                    target.setCoords();
                    fCanvas.setActiveObject(target);
                    fCanvas.renderAll();
                },
            });
        }
    });

    // History Tracking: Text Content Edits inside IText
    fCanvas.on('text:editing:entered', (e) => {
        const textObj = e.target;
        if (textObj) {
            textObj._historyTextBefore = textObj.text;
        }
    });

    fCanvas.on('text:editing:exited', (e) => {
        const textObj = e.target;
        if (textObj && typeof textObj._historyTextBefore === 'string') {
            const textBefore = textObj._historyTextBefore;
            const textAfter = textObj.text;
            textObj._historyTextBefore = null;

            if (textBefore !== textAfter) {
                historyManager.push({
                    pageIndex: pageData.index,
                    description: 'Edit Text Content',
                    undo: () => {
                        textObj.set('text', textBefore);
                        fCanvas.renderAll();
                    },
                    redo: () => {
                        textObj.set('text', textAfter);
                        fCanvas.renderAll();
                    },
                });
            }
        }
    });
}

function onObjectSelected(obj) {
    if (!obj) return;
    state.selectedObject = obj;

    if (isTextObject(obj)) {
        propFontFamily.value = obj.fontFamily || 'Arial';
        propFontSize.value = Math.round(obj.fontSize || 14);
        propTextColor.value = obj.fill || '#000000';
        propTextAlign.value = obj.textAlign || 'left';
        propBold.classList.toggle('bg-slate-200', obj.fontWeight === 'bold');
        propItalic.classList.toggle('bg-slate-200', obj.fontStyle === 'italic');
        propUnderline.classList.toggle('bg-slate-200', Boolean(obj.underline));
    } else {
        if (obj.fill && typeof obj.fill === 'string' && obj.fill.startsWith('#')) {
            propFillColor.value = obj.fill;
        }
        propNoFill.setAttribute('aria-pressed', String(hasNoFill(obj)));
        if (obj.stroke && typeof obj.stroke === 'string' && obj.stroke.startsWith('#')) {
            propStrokeColor.value = obj.stroke;
        }
        propStrokeWidth.value = obj.strokeWidth ?? 0;
        updateStrokePreview('border-stroke-preview', obj.strokeWidth, obj.stroke ?? 'transparent');
    }
    updateToolOptions();
}

function onSelectionCleared() {
    state.selectedObject = null;
    updateToolOptions();
}

function isTextObject(object) {
    return object.type === 'i-text' || object.type === 'text';
}

function hasNoFill(object) {
    return !object.fill || object.fill === 'transparent';
}

function setObjectFill(fill) {
    const object = state.selectedObject;
    if (!object) return;
    object.set('fill', fill);
    propNoFill.setAttribute('aria-pressed', String(hasNoFill(object)));
    getActiveCanvas().renderAll();
}

function setOpenOption(button) {
    if (openOption) {
        openOption.setAttribute('aria-expanded', 'false');
        document.getElementById(openOption.getAttribute('aria-controls')).hidden = true;
    }
    openOption = button;
    if (openOption) {
        openOption.setAttribute('aria-expanded', 'true');
        document.getElementById(openOption.getAttribute('aria-controls')).hidden = false;
    }
}

function updateToolOptions() {
    const { activeTool, selectedObject } = state;
    const showSelection = selectedObject && (activeTool === 'select' || activeTool === 'edit-text');
    const selectionType = showSelection && (isTextObject(selectedObject) ? 'text' : 'object');

    for (const button of optionButtons) {
        const { optionTool, optionSelection } = button.dataset;
        const matchesSelection = selectionType && (optionSelection === selectionType || optionSelection === 'any');
        button.hidden = optionTool !== activeTool && !matchesSelection;
    }
    if (openOption?.hidden) setOpenOption(null);
    toolOptions.hidden = !toolOptions.querySelector('button[aria-expanded]:not([hidden])');
}

// ---------------------------------------------------------------------------
// 5. Active Tool Switcher
// ---------------------------------------------------------------------------
function setActiveTool(tool) {
    state.activeTool = tool;

    toolButtons.forEach((button) => {
        const active = button.dataset.tool === tool;
        button.classList.toggle('btn-tool-active', active);
        if (button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', String(active));
    });

    updateToolOptions();

    // Toggle Hand / Pan tool state across all canvases
    enableHandTool(tool === 'hand');

    // Toggle freehand drawing mode across all page canvases
    updateBrushSettings();
}

function endPan() {
    if (!panGesture) return;
    const { pointerId } = panGesture;
    panGesture = null;
    workspaceContainer.classList.remove('is-panning');
    if (workspaceContainer.hasPointerCapture(pointerId)) {
        workspaceContainer.releasePointerCapture(pointerId);
    }
}

function enableHandTool(enable) {
    workspaceContainer.classList.toggle('is-hand-tool', enable);
    if (!enable) endPan();
    state.pages.forEach((p) => {
        if (!p.fabricCanvas) return;
        p.fabricCanvas.selection = !enable;
        p.fabricCanvas.defaultCursor = enable ? 'grab' : 'default';
        p.fabricCanvas.hoverCursor = enable ? 'grab' : 'move';
        if (enable) {
            p.fabricCanvas.discardActiveObject();
            p.fabricCanvas.requestRenderAll();
        }
    });
}

function updateStrokePreview(id, width, color) {
    const sample = document.getElementById(id);
    sample.style.height = `${width ?? 0}px`;
    sample.style.backgroundColor = color;
}

function updateBrushSettings() {
    const isPen = state.activeTool === 'draw';
    const isDrawing = isPen || state.activeTool === 'highlighter';
    const color = isPen ? state.penColor : state.highlighterColor;
    const width = isPen ? state.penWidth : state.highlighterWidth;
    const stroke = isPen ? color : hexToRgba(color, 0.45);

    if (isDrawing) {
        updateStrokePreview(isPen ? 'pen-stroke-preview' : 'highlighter-stroke-preview', width, stroke);
        const swatchKey = isPen ? 'penColor' : 'hlColor';
        const swatches = isPen ? '[data-pen-color]' : '[data-hl-color]';
        toolOptions.querySelectorAll(swatches).forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset[swatchKey] === color));
        });
    }

    for (const { fabricCanvas } of state.pages) {
        if (!fabricCanvas) continue;
        fabricCanvas.isDrawingMode = isDrawing;
        if (!isDrawing) continue;
        fabricCanvas.freeDrawingBrush ??= new window.fabric.PencilBrush(fabricCanvas);
        fabricCanvas.freeDrawingBrush.color = stroke;
        fabricCanvas.freeDrawingBrush.width = width;
    }
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
    const fontFamily = propFontFamily?.value || 'Arial';
    const fontSize = parseInt(propFontSize?.value, 10) || 14;
    const fill = propTextColor?.value || '#000000';

    const text = new window.fabric.IText('Type text here', {
        left: posX,
        top: posY,
        originX: 'left',
        originY: 'top',
        fontFamily,
        fontSize,
        fill,
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
    canvas.renderAll();

    const targetCanvas = canvas;
    const pageIdx = state.activePageIndex;
    historyManager.push({
        pageIndex: pageIdx,
        description: 'Add Text',
        undo: () => {
            targetCanvas.remove(text);
            targetCanvas.discardActiveObject();
            targetCanvas.renderAll();
            onSelectionCleared();
        },
        redo: () => {
            targetCanvas.add(text);
            targetCanvas.setActiveObject(text);
            targetCanvas.renderAll();
        },
    });

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

        const targetCanvas = canvas;
        const pageIdx = state.activePageIndex;
        historyManager.push({
            pageIndex: pageIdx,
            description: `Add Shape (${shapeType})`,
            undo: () => {
                targetCanvas.remove(shape);
                targetCanvas.discardActiveObject();
                targetCanvas.renderAll();
                onSelectionCleared();
            },
            redo: () => {
                targetCanvas.add(shape);
                targetCanvas.setActiveObject(shape);
                targetCanvas.renderAll();
            },
        });
    }
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
                originX: 'left',
                originY: 'top',
                width: cellWidth,
                height: cellHeight,
                fill: r === 0 ? '#f8fafc' : '#ffffff',
                stroke: '#cbd5e1',
                strokeWidth: 1,
            });

            const text = new window.fabric.IText(r === 0 ? `Col ${c + 1}` : `Data`, {
                left: x + 8,
                top: y + 8,
                originX: 'left',
                originY: 'top',
                fontSize: 11,
                fontFamily: 'Arial',
                fill: '#334155',
            });

            rect.cellText = text;
            text.set('evented', false);
            groupObjects.push(rect, text);
        }
    }

    const tableGroup = new window.fabric.Group(groupObjects, {
        left: startX,
        top: startY,
        originX: 'left',
        originY: 'top',
        subTargetCheck: true,
    });

    canvas.add(tableGroup);
    canvas.setActiveObject(tableGroup);
    canvas.renderAll();

    const targetCanvas = canvas;
    const pageIdx = state.activePageIndex;
    historyManager.push({
        pageIndex: pageIdx,
        description: 'Insert Table',
        undo: () => {
            targetCanvas.remove(tableGroup);
            targetCanvas.discardActiveObject();
            targetCanvas.renderAll();
            onSelectionCleared();
        },
        redo: () => {
            targetCanvas.add(tableGroup);
            targetCanvas.setActiveObject(tableGroup);
            targetCanvas.renderAll();
        },
    });

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

            const targetCanvas = canvas;
            const pageIdx = state.activePageIndex;
            historyManager.push({
                pageIndex: pageIdx,
                description: 'Insert Image',
                undo: () => {
                    targetCanvas.remove(fabricImg);
                    targetCanvas.discardActiveObject();
                    targetCanvas.renderAll();
                    onSelectionCleared();
                },
                redo: () => {
                    targetCanvas.add(fabricImg);
                    targetCanvas.setActiveObject(fabricImg);
                    targetCanvas.renderAll();
                },
            });

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
    state.signPlacement = null;
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

    const targetCanvas = canvas;
    const targetPageIdx = pageIndex;
    historyManager.push({
        pageIndex: targetPageIdx,
        description: 'Insert Signature',
        undo: () => {
            targetCanvas.remove(fabricImg);
            targetCanvas.discardActiveObject();
            targetCanvas.renderAll();
            onSelectionCleared();
        },
        redo: () => {
            targetCanvas.add(fabricImg);
            targetCanvas.setActiveObject(fabricImg);
            targetCanvas.renderAll();
        },
    });

    closeSignatureModal();
    clearSigDrawCanvas();
}

// ---------------------------------------------------------------------------
// 7. Zoom & Grid Guidelines
// ---------------------------------------------------------------------------
function applyZoom(newZoom) {
    state.zoom = Math.min(2.5, Math.max(0.3, Number(newZoom.toFixed(2))));
    if (zoomLabel) zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    if (zoomInput) zoomInput.value = `${Math.round(state.zoom * 100)}%`;

    state.pages.forEach((p) => {
        if (!p.container) return;
        const scaledWidth = Math.round(p.width * state.zoom);
        const scaledHeight = Math.round(p.height * state.zoom);

        p.container.style.transform = `scale(${state.zoom})`;
        p.fabricCanvas.updateRenderDensity(state.zoom);
        p.container.style.transformOrigin = '0 0';

        const wrapper = p.container.closest('.page-scale-wrapper');
        if (wrapper) {
            wrapper.style.width = `${scaledWidth}px`;
            wrapper.style.height = `${scaledHeight}px`;
        }

        const pageCont = p.container.closest('[data-page-index]');
        if (pageCont) {
            pageCont.style.width = `${scaledWidth}px`;
        }
    });

    updatePageNavUI();
}

function updatePageNavUI() {
    if (!state.pages || state.pages.length === 0) {
        if (pageNavLabel) pageNavLabel.textContent = 'Page 0 / 0';
        if (btnPrevPage) btnPrevPage.disabled = true;
        if (btnNextPage) btnNextPage.disabled = true;
        return;
    }
    const current = state.activePageIndex + 1;
    const total = state.pages.length;
    if (pageNavLabel) pageNavLabel.textContent = `Page ${current} / ${total}`;
    if (btnPrevPage) btnPrevPage.disabled = current <= 1;
    if (btnNextPage) btnNextPage.disabled = current >= total;
}

function scrollToPage(index, behavior = 'smooth') {
    if (index < 0 || index >= state.pages.length) return;
    state.activePageIndex = index;
    const target = document.querySelector(`[data-page-index="${index}"]`);
    if (target) {
        const clearance = parseFloat(getComputedStyle(workspaceContainer).scrollPaddingTop);
        workspaceContainer.scrollTo({ top: target.offsetTop - clearance, behavior });
    }
    updatePageNavUI();
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
    btnExportPdf.setAttribute('aria-busy', 'true');
    const originalIcon = btnExportPdf.innerHTML;
    btnExportPdf.innerHTML = `
        <svg aria-hidden="true" class="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
    `;

    try {
        let targetPdfDoc;
        if (state.pdfBytes) {
            targetPdfDoc = await window.PDFLib.PDFDocument.load(state.pdfBytes);
        } else {
            targetPdfDoc = await window.PDFLib.PDFDocument.create();
        }

        // Remove deleted source pages before applying overlays in the displayed order.
        const retainedPages = new Set(state.pages.map((page) => page.sourceIndex));
        for (let i = targetPdfDoc.getPageCount() - 1; i >= 0; i--) {
            if (!retainedPages.has(i)) targetPdfDoc.removePage(i);
        }

        // Handle page modifications & newly added pages
        for (let i = 0; i < state.pages.length; i++) {
            const pageData = state.pages[i];
            let pdfPage;

            if (pageData.sourceIndex === undefined) {
                pdfPage = targetPdfDoc.addPage([pageData.width, pageData.height]);
            } else {
                pdfPage = targetPdfDoc.getPage(i);
            }

            // Deselect any active object so selection handles / borders are not baked into export
            pageData.fabricCanvas.discardActiveObject();
            pageData.fabricCanvas.renderAll();

            // Export edits at a fixed density using page coordinates.
            if (pageData.fabricCanvas.getObjects().length > 0) {
                const overlay = await pageData.fabricCanvas.toBlob({
                    format: 'png',
                    multiplier: EXPORT_OVERLAY_SCALE,
                });
                if (!overlay) throw new Error('Could not render PDF edits');
                const embeddedPng = await targetPdfDoc.embedPng(await overlay.arrayBuffer());

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
        btnExportPdf.removeAttribute('aria-busy');
        btnExportPdf.innerHTML = originalIcon;
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
    btnUploadPdf.addEventListener('click', () => pdfFileInput.click());
    pdfFileInput.addEventListener('change', onFileSelected);
    emptyFileInput.addEventListener('change', onFileSelected);
    btnStartBlank.addEventListener('click', startWithBlankA4);
    btnAddPage.addEventListener('click', appendBlankPage);
    btnExportPdf.addEventListener('click', exportPdfDocument);

    window.addEventListener('resize', () => {
        for (const { fabricCanvas } of state.pages) {
            fabricCanvas.updateRenderDensity(state.zoom);
        }
    });

    // Zoom
    btnZoomIn?.addEventListener('click', () => applyZoom(state.zoom + 0.15));
    btnZoomOut?.addEventListener('click', () => applyZoom(state.zoom - 0.15));
    btnFitWidth?.addEventListener('click', () => {
        const mainW = workspaceContainer ? workspaceContainer.clientWidth - 120 : 800;
        const pageW = state.pages[0] ? state.pages[0].width : A4_WIDTH;
        if (pageW > 0) {
            applyZoom(mainW / pageW);
        }
    });
    btnToggleGrid?.addEventListener('click', toggleGrid);

    // Zoom Input (Triggers only when Enter key is pressed)
    zoomInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const raw = zoomInput.value.replace(/%/g, '').trim();
            const parsed = parseFloat(raw);
            if (!isNaN(parsed) && parsed > 0) {
                const targetZoom = parsed > 5 ? parsed / 100 : parsed;
                applyZoom(targetZoom);
            } else {
                zoomInput.value = `${Math.round(state.zoom * 100)}%`;
            }
            zoomInput.blur();
        } else if (e.key === 'Escape') {
            zoomInput.value = `${Math.round(state.zoom * 100)}%`;
            zoomInput.blur();
        }
    });

    zoomInput?.addEventListener('blur', () => {
        zoomInput.value = `${Math.round(state.zoom * 100)}%`;
    });

    // Floating Page Navigation Dock
    btnPrevPage?.addEventListener('click', () => {
        if (state.activePageIndex > 0) {
            scrollToPage(state.activePageIndex - 1);
        }
    });
    btnNextPage?.addEventListener('click', () => {
        if (state.activePageIndex < state.pages.length - 1) {
            scrollToPage(state.activePageIndex + 1);
        }
    });

    // Track active page on viewport scroll
    workspaceContainer?.addEventListener('scroll', () => {
        if (state.pages.length === 0) return;
        const viewTop = workspaceContainer.scrollTop + 120;
        let closestIndex = 0;
        let minDistance = Infinity;

        state.pages.forEach((p, idx) => {
            const el = document.querySelector(`[data-page-index="${idx}"]`);
            if (el) {
                const distance = Math.abs(el.offsetTop - viewTop);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestIndex = idx;
                }
            }
        });

        if (state.activePageIndex !== closestIndex) {
            state.activePageIndex = closestIndex;
            updatePageNavUI();
        }
    }, { passive: true });

    // Trackpad Pinch-to-zoom & Ctrl/Cmd + Mouse Wheel Zoom
    workspaceContainer?.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.08 : -0.08;
            applyZoom(state.zoom + delta);
        }
    }, { passive: false });

    // Keep the drag active even when the pointer moves off the PDF.
    workspaceContainer.addEventListener('pointerdown', (event) => {
        if (
            state.activeTool !== 'hand' ||
            !event.isPrimary ||
            event.button !== 0 ||
            event.target.closest('button')
        ) return;
        panGesture = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            scrollLeft: workspaceContainer.scrollLeft,
            scrollTop: workspaceContainer.scrollTop,
        };
        if (event.pointerType !== 'touch') workspaceContainer.setPointerCapture(event.pointerId);
        workspaceContainer.classList.add('is-panning');
        if (event.pointerType === 'mouse') event.preventDefault();
    });

    workspaceContainer.addEventListener('pointermove', (event) => {
        if (event.pointerId !== panGesture?.pointerId) return;
        workspaceContainer.scrollLeft = panGesture.scrollLeft + panGesture.x - event.clientX;
        workspaceContainer.scrollTop = panGesture.scrollTop + panGesture.y - event.clientY;
    });

    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        workspaceContainer.addEventListener(name, (event) => {
            if (event.pointerId === panGesture?.pointerId) endPan();
        });
    }

    function isInputActive() {
        const active = document.activeElement;
        if (!active) return false;
        const tag = active.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(active.isContentEditable);
    }

    // Spacebar temporary hand tool
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !isSpacePressed && !isInputActive() && !e.target.closest('button')) {
            e.preventDefault();
            isSpacePressed = true;
            previousToolBeforeSpace = state.activeTool;
            setActiveTool('hand');
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space' && isSpacePressed) {
            isSpacePressed = false;
            if (previousToolBeforeSpace && previousToolBeforeSpace !== 'hand') {
                setActiveTool(previousToolBeforeSpace);
                previousToolBeforeSpace = null;
            }
        }
    });

    // Tool switching
    toolButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const tool = button.dataset.tool;
            const toggledClosed = button.hasAttribute('aria-expanded') && state.activeTool === tool;
            setActiveTool(toggledClosed ? 'select' : tool);
        });
    });

    optionButtons.forEach((button) => {
        button.addEventListener('click', () => setOpenOption(openOption === button ? null : button));
    });

    document.addEventListener('click', (event) => {
        if (toolOptions.contains(event.target)) return;
        setOpenOption(null);
        if (state.activeTool === 'shape' && !event.target.closest('#tool-shapes-btn')) setActiveTool('select');
    });

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
    btnCancelEditTextTool?.addEventListener('click', () => setActiveTool('select'));

    // Freehand Pen Color & Width listeners
    document.querySelectorAll('[data-pen-color]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.penColor;
            state.penColor = color;
            if (propPenColor) propPenColor.value = color;
            updateBrushSettings();
            if (state.selectedObject && state.selectedObject.type === 'path') {
                state.selectedObject.set('stroke', color);
                getActiveCanvas()?.renderAll();
            }
        });
    });

    propPenColor?.addEventListener('input', (e) => {
        state.penColor = e.target.value;
        updateBrushSettings();
        if (state.selectedObject && state.selectedObject.type === 'path') {
            state.selectedObject.set('stroke', e.target.value);
            getActiveCanvas()?.renderAll();
        }
    });

    propPenWidth?.addEventListener('change', (e) => {
        state.penWidth = parseInt(e.target.value, 10) || 2;
        updateBrushSettings();
        if (state.selectedObject && state.selectedObject.type === 'path') {
            state.selectedObject.set('strokeWidth', state.penWidth);
            getActiveCanvas()?.renderAll();
        }
    });

    // Highlighter Color & Width listeners
    document.querySelectorAll('[data-hl-color]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.hlColor;
            state.highlighterColor = color;
            if (propHighlighterColor) propHighlighterColor.value = color;
            updateBrushSettings();
            if (state.selectedObject && state.selectedObject.type === 'path') {
                state.selectedObject.set('stroke', hexToRgba(color, 0.45));
                getActiveCanvas()?.renderAll();
            }
        });
    });

    propHighlighterColor?.addEventListener('input', (e) => {
        state.highlighterColor = e.target.value;
        updateBrushSettings();
        if (state.selectedObject && state.selectedObject.type === 'path') {
            state.selectedObject.set('stroke', hexToRgba(e.target.value, 0.45));
            getActiveCanvas()?.renderAll();
        }
    });

    propHighlighterWidth?.addEventListener('change', (e) => {
        state.highlighterWidth = parseInt(e.target.value, 10) || 18;
        updateBrushSettings();
        if (state.selectedObject && state.selectedObject.type === 'path') {
            state.selectedObject.set('strokeWidth', state.highlighterWidth);
            getActiveCanvas()?.renderAll();
        }
    });

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

    propTextAlign.addEventListener('change', (event) => {
        if (!state.selectedObject) return;
        state.selectedObject.set('textAlign', event.target.value);
        getActiveCanvas().requestRenderAll();
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

    propFillColor.addEventListener('input', () => setObjectFill(propFillColor.value));
    propNoFill.addEventListener('click', () => {
        if (!state.selectedObject) return;
        setObjectFill(hasNoFill(state.selectedObject) ? propFillColor.value : 'transparent');
    });

    propStrokeColor.addEventListener('input', (e) => {
        if (state.selectedObject) {
            state.selectedObject.set('stroke', e.target.value);
            updateStrokePreview('border-stroke-preview', state.selectedObject.strokeWidth, e.target.value);
            getActiveCanvas().renderAll();
        }
    });

    propStrokeWidth.addEventListener('input', (e) => {
        const width = e.target.valueAsNumber;
        if (state.selectedObject && Number.isFinite(width) && e.target.validity.valid) {
            state.selectedObject.set('strokeWidth', width);
            updateStrokePreview('border-stroke-preview', width, state.selectedObject.stroke ?? 'transparent');
            getActiveCanvas().renderAll();
        }
    });

    propBringForward.addEventListener('click', () => {
        if (state.selectedObject) {
            getActiveCanvas().bringObjectForward(state.selectedObject);
            getActiveCanvas().renderAll();
        }
    });

    propSendBackward.addEventListener('click', () => {
        if (state.selectedObject) {
            getActiveCanvas().sendObjectBackwards(state.selectedObject);
            getActiveCanvas().renderAll();
        }
    });

    propDelete.addEventListener('click', deleteSelectedObject);

    // History Undo / Redo Click listeners
    btnUndo?.addEventListener('click', () => historyManager.undo());
    btnRedo?.addEventListener('click', () => historyManager.redo());

    // Global Keyboard Shortcuts (Delete, Backspace, Undo Cmd/Ctrl+Z, Redo Cmd+Shift+Z / Ctrl+Y)
    window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isEditingInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const isMod = isMac ? e.metaKey : e.ctrlKey;

        // Undo: Cmd+Z (Mac) or Ctrl+Z (Win/Linux)
        if (isMod && (e.key === 'z' || e.key === 'Z') && !isEditingInput) {
            e.preventDefault();
            if (e.shiftKey) {
                historyManager.redo();
            } else {
                historyManager.undo();
            }
            return;
        }

        // Redo: Cmd+Shift+Z or Ctrl+Y
        if (((isMod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) || (isMod && (e.key === 'y' || e.key === 'Y'))) && !isEditingInput) {
            e.preventDefault();
            historyManager.redo();
            return;
        }

        // Zoom In: Cmd/Ctrl + '+' or '='
        if (isMod && (e.key === '=' || e.key === '+')) {
            e.preventDefault();
            applyZoom(state.zoom + 0.15);
            return;
        }

        // Zoom Out: Cmd/Ctrl + '-' or '_'
        if (isMod && (e.key === '-' || e.key === '_')) {
            e.preventDefault();
            applyZoom(state.zoom - 0.15);
            return;
        }

        // Reset Zoom: Cmd/Ctrl + '0'
        if (isMod && e.key === '0') {
            e.preventDefault();
            applyZoom(1.0);
            return;
        }

        // Hand Tool shortcut: H key
        if ((e.key === 'h' || e.key === 'H') && !isEditingInput && !isMod) {
            setActiveTool(state.activeTool === 'hand' ? 'select' : 'hand');
            return;
        }

        // Escape closes the active tool submenu.
        if (e.key === 'Escape') {
            if (openOption && toolOptions.contains(document.activeElement)) {
                const trigger = openOption;
                setOpenOption(null);
                trigger.focus();
                return;
            }
        }

        // Delete key shortcut
        if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedObject && !state.selectedObject.isEditing && !isEditingInput) {
            deleteSelectedObject();
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

    // Table options
    btnCancelTable.addEventListener('click', () => setActiveTool('select'));
    btnInsertTable.addEventListener('click', () => {
        if (!tableRowsInput.reportValidity() || !tableColsInput.reportValidity()) return;
        insertTable(tableRowsInput.valueAsNumber || 3, tableColsInput.valueAsNumber || 3);
    });
}

// Boot
window.addEventListener('DOMContentLoaded', initApp);
