import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from './../src/app.module.js';

describe('PdfEditorController (e2e)', () => {
    let app: INestApplication<Server>;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    it('GET /pdf-editor returns standalone editor HTML with strict CSP', async () => {
        const res = await request(app.getHttpServer()).get('/pdf-editor').expect(200);

        expect(res.headers['content-type']).toContain('text/html');
        expect(res.headers['content-security-policy']).toBeDefined();
        expect(res.headers['content-security-policy']).toContain("default-src 'none'");
        expect(res.text).toContain('PDF Document Studio & Sign');
        expect(res.text).toContain('id="signature-modal"');
        expect(res.text).toContain('id="tool-sign"');
    });

    it('GET /pdf-editor/pdf-editor.css returns compiled CSS', async () => {
        const res = await request(app.getHttpServer()).get('/pdf-editor/pdf-editor.css').expect(200);

        expect(res.headers['content-type']).toContain('text/css');
        expect(res.text.length).toBeGreaterThan(1000);
    });

    it('GET /pdf-editor/js/pdf-editor.js returns client module script', async () => {
        const res = await request(app.getHttpServer()).get('/pdf-editor/js/pdf-editor.js').expect(200);

        expect(res.headers['content-type']).toContain('text/javascript');
        expect(res.text).toContain('extractSignatureBackground');
        expect(res.text).toContain('confirmAndPlaceSignature');
    });

    it('GET /pdf-editor/vendor/fabric.min.js serves local Fabric library', async () => {
        const res = await request(app.getHttpServer()).get('/pdf-editor/vendor/fabric.min.js').expect(200);

        expect(res.headers['content-type']).toContain('text/javascript');
        expect(res.headers['cache-control']).toContain('public');
        expect(res.text.length).toBeGreaterThan(50000);
    });

    it('GET /pdf-editor/vendor/pdf-lib.min.js serves local pdf-lib library', async () => {
        const res = await request(app.getHttpServer()).get('/pdf-editor/vendor/pdf-lib.min.js').expect(200);

        expect(res.headers['content-type']).toContain('text/javascript');
        expect(res.text.length).toBeGreaterThan(50000);
    });

    it('GET /pdf-editor/vendor/pdf.min.mjs serves local PDF.js ES module', async () => {
        const res = await request(app.getHttpServer()).get('/pdf-editor/vendor/pdf.min.mjs').expect(200);

        expect(res.headers['content-type']).toContain('text/javascript');
        expect(res.text.length).toBeGreaterThan(50000);
    });
});
