import { Controller, Get, Header, Param, Res, StreamableFile } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import type { Response } from 'express';

@Controller('resumes')
export class ResumeEditorController {
    @Get('editor')
    @Header(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self' 'unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:; img-src 'self' blob: data:; frame-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    )
    @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
    editor(): Promise<StreamableFile> {
        return this.asset('index.html', 'text/html; charset=utf-8');
    }

    @Get('editor.js')
    @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
    script(): Promise<StreamableFile> {
        return this.asset('editor.js', 'text/javascript; charset=utf-8');
    }

    @Get('editor.css')
    @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
    styles(): Promise<StreamableFile> {
        return this.asset('editor.generated.css', 'text/css; charset=utf-8');
    }

    @Get('vendor/:name')
    vendor(@Param('name') name: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
        const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '');
        let type = 'application/octet-stream';
        if (safeName.endsWith('.js') || safeName.endsWith('.mjs')) {
            type = 'text/javascript; charset=utf-8';
        } else if (safeName.endsWith('.css')) {
            type = 'text/css; charset=utf-8';
        } else if (safeName.endsWith('.wasm')) {
            type = 'application/wasm';
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return this.vendorAsset(safeName, type);
    }

    private async asset(name: string, type: string): Promise<StreamableFile> {
        const content = await readFile(new URL(`./editor/${name}`, import.meta.url));
        return new StreamableFile(content, { type, length: content.length });
    }

    private async vendorAsset(name: string, type: string): Promise<StreamableFile> {
        const content = await readFile(new URL(`../pdf-editor/client/vendor/${name}`, import.meta.url));
        return new StreamableFile(content, { type, length: content.length });
    }
}
