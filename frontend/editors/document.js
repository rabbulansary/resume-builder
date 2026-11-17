import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const editorPolicy = [
    "default-src 'none'",
    "script-src 'self' 'unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' blob: data:",
    "img-src 'self' blob: data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
];

const editorPages = {
    resume: {
        filename: 'resume.html',
        title: 'Student resume builder',
        subtitle: 'Career toolkit',
        footerLabel: 'Resume navigation',
        frameSources: "'self' blob:",
    },
    pdf: {
        filename: 'pdf-editor.html',
        title: 'PDF Editor &amp; Sign',
        subtitle: 'No document loaded',
        footerLabel: 'Page navigation and zoom',
        frameSources: 'blob:',
    },
};

function readEditorFile(filename) {
    return readFile(join(process.cwd(), 'editors', filename), 'utf8');
}

export async function editorDocument(editor) {
    const config = editorPages[editor];
    const [document, layout, footerActions] = await Promise.all([
        readEditorFile(config.filename),
        readEditorFile('shell/layout.html'),
        readEditorFile(`shell/${editor}-footer.html`),
    ]);
    const slots = {
        ...config,
        footerActions,
        footerHidden: editor === 'pdf' ? 'hidden' : '',
        pdfCurrent: editor === 'pdf' ? 'page' : 'false',
        resumeCurrent: editor === 'resume' ? 'page' : 'false',
    };
    const [before, after] = layout
        .replace(/\{\{(\w+)\}\}/g, (_, name) => slots[name])
        .split('<!-- editor-content -->');
    const html = document
        .replace('<!-- editor-shell:before -->', () => before)
        .replace('<!-- editor-shell:after -->', () => after);
    return new Response(html, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': [...editorPolicy, `frame-src ${config.frameSources}`].join('; '),
            'Cache-Control': 'no-store',
        },
    });
}
