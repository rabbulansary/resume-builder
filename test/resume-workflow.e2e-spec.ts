import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { resumeBodyParser } from '../src/resumes/resume-body-parser.js';

const baseResume = {
    schemaVersion: '1.0.0',
    profile: { fullName: 'Student Example' },
};
const requiredProject = {
    id: 'required-project',
    type: 'projects',
    title: 'Projects',
    items: [{ name: 'Portfolio project' }],
};

const longEntry = Array.from(
    { length: 48 },
    (_, index) => `Line ${index}: contributed to the project and documented the results.`,
).join('\n');

describe('resume editor workflow', () => {
    let app: INestApplication<Server>;
    let directory: string;
    const previousDirectory = process.env.RESUME_TEMPLATE_DIR;

    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), 'resume-templates-'));
        process.env.RESUME_TEMPLATE_DIR = directory;
        const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = module.createNestApplication();
        app.use('/resumes', resumeBodyParser);
        await app.init();
    });

    afterAll(async () => {
        await app.close();
        await rm(directory, { recursive: true, force: true });
        if (previousDirectory === undefined) delete process.env.RESUME_TEMPLATE_DIR;
        else process.env.RESUME_TEMPLATE_DIR = previousDirectory;
    });

    it('serves the editor and its browser assets', async () => {
        const http = request(app.getHttpServer());
        const editor = await http
            .get('/resumes/editor')
            .expect(200)
            .expect('Content-Type', /text\/html/);
        expect(editor.text).toContain('Student resume builder');
        expect(editor.text).toContain('Import JSON');
        expect(editor.text).toContain('Download JSON');
        await http
            .get('/resumes/editor.js')
            .expect(200)
            .expect('Content-Type', /text\/javascript/);
        await http
            .get('/resumes/editor.css')
            .expect(200)
            .expect('Content-Type', /text\/css/);
        await http
            .get('/resumes/vendor/pdf.min.mjs')
            .expect(200)
            .expect('Content-Type', /text\/javascript/);
        await http
            .get('/resumes/vendor/pdf.worker.min.mjs')
            .expect(200)
            .expect('Content-Type', /text\/javascript/);
    });

    it('validates presets, serializes concurrent updates, and retains pinned versions after deletion', async () => {
        const http = request(app.getHttpServer());
        const config = { name: 'Student preset', maxPages: 1, allowEducationExclusion: false, sections: {} };
        await http
            .post('/resumes/templates')
            .send({ id: 'student', config: { ...config, maxPages: 0 } })
            .expect(400);
        await http.post('/resumes/templates').send({ id: 'student', config }).expect(201);
        const updates = await Promise.all(
            [2, 3].map((maxPages) =>
                http.put('/resumes/templates/student').send({ expectedVersion: 1, config: { ...config, maxPages } }),
            ),
        );
        expect(updates.map(({ status }) => status).sort()).toEqual([200, 409]);
        const history = await http.get('/resumes/templates/student?version=1').expect(200);
        expect(history.body).toMatchObject({ version: 1, config });
        await http.delete('/resumes/templates/student?version=2').expect(204);
        await http.get('/resumes/templates/student').expect(404);
        await http.get('/resumes/templates/student?version=1').expect(200);
        const list = await http.get('/resumes/templates').expect(200);
        expect(list.body.map(({ id }: { id: string }) => id)).toEqual(['classic-ats']);
    });

    it('reduces lower priority content and applies student overrides to the order', async () => {
        const http = request(app.getHttpServer());
        const sections = [
            requiredProject,
            { id: 'work', type: 'experience', title: 'Experience', items: [{ role: 'Intern', bullets: [longEntry] }] },
            {
                id: 'projects',
                type: 'projects',
                title: 'Projects',
                items: [{ name: 'Capstone', bullets: [longEntry] }],
            },
        ];
        for (const [contentVariant, expected] of [
            ['experienced-professional', 'projects'],
            ['student-fresher', 'work'],
        ]) {
            const resume = {
                ...baseResume,
                sections,
                document: { type: 'resume', language: 'en', pageSize: 'A4', contentVariant },
            };
            const response = await http.post('/resumes/preview').send({ resume }).expect(200);
            expect(response.body.report).toMatchObject({
                initialPageCount: 2,
                pageCount: 1,
                fits: true,
                exclusions: [{ sectionId: expected, itemIndex: 0, reason: 'page-fit' }],
            });
            expect((await PDFDocument.load(Buffer.from(response.body.pdf, 'base64'))).getPageCount()).toBe(1);
        }
    });

    it('honors item limits, protects entries, and only excludes education when enabled', async () => {
        const http = request(app.getHttpServer());
        const resume = {
            ...baseResume,
            sections: [
                requiredProject,
                {
                    id: 'awards',
                    type: 'bullet_list',
                    title: 'Awards',
                    items: ['First', 'Second', 'Protected award'],
                    protectedItemIndexes: [2],
                },
                {
                    id: 'education',
                    type: 'education',
                    title: 'Education',
                    items: [{ qualification: 'Bachelor’s' }, { qualification: 'High school' }],
                },
            ],
        };
        const sections = { bullet_list: { maxItems: 1 }, education: { maxItems: 1 } };
        const kept = await http.post('/resumes/preview').send({ resume, layout: { sections } }).expect(200);
        expect(kept.body.report.exclusions).toMatchObject([
            { label: 'Second', reason: 'limit' },
            { label: 'First', reason: 'limit' },
        ]);
        expect(kept.body.report.warnings).toHaveLength(1);
        const reduced = await http
            .post('/resumes/preview')
            .send({ resume, layout: { sections, allowEducationExclusion: true } })
            .expect(200);
        expect(reduced.body.report.exclusions).toContainEqual({
            sectionId: 'education',
            sectionTitle: 'Education',
            itemIndex: 1,
            label: 'High school',
            reason: 'limit',
        });
        const exported = await http
            .post('/resumes/export/json')
            .send({ resume, layout: { sections } })
            .expect(200)
            .expect('Content-Disposition', 'attachment; filename="resume.json"');
        expect(exported.body).toMatchObject({
            template: { id: 'classic-ats', version: 1 },
            resume: { sections: resume.sections },
        });
    });

    it('rejects an overflowing PDF when content is protected and exports a validated PDF when allowed to fit', async () => {
        const http = request(app.getHttpServer());
        const resume = {
            ...baseResume,
            sections: [
                requiredProject,
                {
                    id: 'work',
                    type: 'experience',
                    title: 'Experience',
                    protectedItemIndexes: [0],
                    items: [{ role: 'Intern', bullets: [longEntry, longEntry] }],
                },
            ],
        };
        const blocked = await http.post('/resumes/export/pdf').send({ resume }).expect(422);
        expect(blocked.body.report).toMatchObject({ fits: false, pageCount: 2, exclusions: [] });
        const exported = await http
            .post('/resumes/export/pdf')
            .send({ resume, layout: { maxPages: 2 } })
            .expect(200)
            .expect('Content-Type', 'application/pdf');
        expect((await PDFDocument.load(exported.body)).getPageCount()).toBe(2);
    });

    it('requires a visible project and counts hidden and repeated sections toward the six-entry limit', async () => {
        const http = request(app.getHttpServer());
        const hiddenProjects = { ...requiredProject, id: 'hidden-projects', visible: false };
        const experience = {
            id: 'experience',
            type: 'experience',
            title: 'Experience',
            items: Array.from({ length: 4 }, (_, index) => ({ role: `Role ${index + 1}` })),
        };
        const send = (sections: unknown[], endpoint = 'export/json') =>
            http.post(`/resumes/${endpoint}`).send({ resume: { ...baseResume, sections } });
        const missing = await send([hiddenProjects], 'preview').expect(400);
        expect(missing.body.issues).toContainEqual(expect.objectContaining({ path: 'resume.sections.projects' }));
        await send([requiredProject, hiddenProjects, experience]).expect(200);
        await send(
            [requiredProject, hiddenProjects, { ...experience, items: [...experience.items, { role: 'Role 5' }] }],
            'export/json',
        ).expect(200);
        const fitted = await http
            .post('/resumes/preview')
            .send({
                resume: { ...baseResume, sections: [requiredProject] },
                layout: { sections: { projects: { maxItems: 0 } } },
            })
            .expect(200);
        expect(fitted.body.report.exclusions).toEqual([]);
        expect(fitted.body.report.warnings).toContain(
            'Projects exceeds its item limit because it contains protected content.',
        );
    });
});
