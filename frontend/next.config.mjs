const backendOrigin = (process.env.BACKEND_ORIGIN ?? `http://127.0.0.1:${process.env.BACKEND_PORT ?? 3001}`).replace(
    /\/$/,
    '',
);

const editorAssets = [
    '/editor-shell/workspace.js',
    '/resumes/editor.js',
    '/resumes/editor.css',
    '/pdf-editor/js/pdf-editor.js',
    '/pdf-editor/pdf-editor.css',
];

export default {
    poweredByHeader: false,
    agentRules: false,
    async redirects() {
        return [
            { source: '/resumes/editor', destination: '/resume/editor', permanent: true },
            { source: '/pdf-editor', destination: '/pdf/editor', permanent: true },
        ];
    },
    async rewrites() {
        return [
            { source: '/resumes/vendor/:file', destination: '/pdf-editor/vendor/:file' },
            { source: '/resumes/:action(render|preview)', destination: `${backendOrigin}/resumes/:action` },
            { source: '/resumes/export/:format(pdf|json)', destination: `${backendOrigin}/resumes/export/:format` },
            { source: '/resumes/templates', destination: `${backendOrigin}/resumes/templates` },
            { source: '/resumes/templates/:id', destination: `${backendOrigin}/resumes/templates/:id` },
        ];
    },
    async headers() {
        return [
            ...editorAssets.map((source) => ({
                source,
                headers: [{ key: 'Cache-Control', value: 'no-store' }],
            })),
            ...['/pdf-editor/vendor/:file', '/resumes/vendor/:file'].map((source) => ({
                source,
                headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }],
            })),
        ];
    },
};
