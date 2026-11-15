import { Controller, Get, Header, StreamableFile } from '@nestjs/common';
import { readFile } from 'node:fs/promises';

@Controller('resumes')
export class ResumeEditorController {
    @Get('editor')
    @Header(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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

    private async asset(name: string, type: string): Promise<StreamableFile> {
        const content = await readFile(new URL(`./editor/${name}`, import.meta.url));
        return new StreamableFile(content, { type, length: content.length });
    }
}
