import { Controller, Get, Header, Param, Res, StreamableFile } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import type { Response } from 'express';

@Controller('pdf-editor')
export class PdfEditorController {
    @Get()
    @Header(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: data:; frame-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    )
    @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
    editor(): Promise<StreamableFile> {
        return this.asset('index.html', 'text/html; charset=utf-8');
    }

    @Get('pdf-editor.css')
    @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
    styles(): Promise<StreamableFile> {
        return this.asset('pdf-editor.generated.css', 'text/css; charset=utf-8');
    }

    @Get('js/pdf-editor.js')
    @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
    script(): Promise<StreamableFile> {
        return this.asset('js/pdf-editor.js', 'text/javascript; charset=utf-8');
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
        return this.asset(`vendor/${safeName}`, type);
    }

    private async asset(relativePath: string, type: string): Promise<StreamableFile> {
        const content = await readFile(new URL(`./client/${relativePath}`, import.meta.url));
        return new StreamableFile(content, { type, length: content.length });
    }
}
