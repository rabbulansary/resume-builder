import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { resumeBodyParser } from '../src/resumes/resume-body-parser.js';
import { resumeSchema } from '../src/resumes/resume.schema.js';

function fixture(name: string) {
    const data: unknown = JSON.parse(readFileSync(new URL(`../docs/${name}.json`, import.meta.url), 'utf8'));
    return resumeSchema.parse(data);
}

const mmToPt = (millimeters: number) => (millimeters * 72) / 25.4;

describe('POST /resumes/render', () => {
    let app: INestApplication<Server>;

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();
        app = module.createNestApplication();
        app.use('/resumes/render', resumeBodyParser);
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    async function render(input: unknown) {
        const response = await request(app.getHttpServer())
            .post('/resumes/render')
            .type('json')
            .send(JSON.stringify(input))
            .expect(200)
            .expect('Content-Type', 'application/pdf')
            .expect('Content-Disposition', 'attachment; filename="resume.pdf"');
        expect(Buffer.isBuffer(response.body)).toBe(true);
        expect(response.body.subarray(0, 4).toString()).toBe('%PDF');
        return getDocument({ data: new Uint8Array(response.body) });
    }

    it('prints all full-fixture sections, entries and links on one tagged A4 page', async () => {
        const resume = fixture('resume_full');
        const loading = await render(resume);
        try {
            const pdf = await loading.promise;
            expect(pdf.numPages).toBe(1);
            const page = await pdf.getPage(1);
            expect(await page.getStructTree()).toBeTruthy();
            const [left, bottom, width, height] = page.view;
            expect([left, bottom]).toEqual([0, 0]);
            expect(Math.abs(width - mmToPt(210))).toBeLessThan(1);
            expect(Math.abs(height - mmToPt(297))).toBeLessThan(1);

            const items = (await page.getTextContent()).items.filter((item) => 'str' in item);
            const text = items
                .map((item) => item.str)
                .join(' ')
                .replace(/\s+/g, ' ');
            let previousHeading = -1;
            for (const section of resume.sections) {
                const index = text.indexOf(section.title);
                expect(index).toBeGreaterThan(previousHeading);
                previousHeading = index;
                if (section.type === 'summary') {
                    expect(text).toContain(section.content);
                    continue;
                }
                for (const item of section.items) {
                    if (typeof item === 'string') expect(text).toContain(item);
                    else if ('role' in item) expect(text).toContain(item.role);
                    else if ('name' in item) expect(text).toContain(item.name);
                    else if ('qualification' in item) expect(text).toContain(item.qualification);
                    else expect(text).toContain(item.label);
                }
            }
            for (const content of [
                '50,000+ rows',
                'analysing',
                'Tech/Tools Used:',
                'CGPA: 8.4/10',
                'Coursera | 6 months',
            ]) {
                expect(text).toContain(content);
            }

            const annotations = await page.getAnnotations();
            const urls = [
                ...(resume.profile.contact?.links ?? []).map((link) => link.url),
                ...resume.sections.flatMap((section) => {
                    if (section.type === 'projects')
                        return section.items.flatMap((item) => item.links?.map((link) => link.url) ?? []);
                    if (section.type === 'certifications')
                        return section.items.flatMap((item) => (item.url ? [item.url] : []));
                    return [];
                }),
            ].map((url) => new URL(url).href);
            expect(urls).toHaveLength(9);
            expect(annotations.filter((item) => item.subtype === 'Link').map((item) => item.url)).toEqual(urls);

            function findText(value: string, size: number) {
                const item = items.find((item) => item.str === value);
                if (!item) throw new Error(`Missing PDF text: ${value}`);
                expect(item.transform[0]).toBeCloseTo(size, 1);
                return item;
            }
            const name = findText('AARAV SHARMA', 22);
            const headline = findText('Data Analyst', 11.5);
            const sectionHeading = findText('EDUCATION', 11);
            const role = findText('Data Analyst Intern', 9.8);
            const company = findText('ABC Retail Solutions Pvt. Ltd., Bengaluru', 9);
            const internship = findText('Jan 2026 – Apr 2026', 9.2);
            const project = findText('Mar 2026', 9.2);
            const education = findText('May 2026', 9.2);
            const certification = findText('Jan 2026', 9.2);
            expect(Math.abs(height - name.transform[5] - name.height - mmToPt(9))).toBeLessThan(3);
            for (const item of [name, headline]) {
                expect(Math.abs(item.transform[4] + item.width / 2 - width / 2)).toBeLessThan(1);
            }
            expect(Math.abs(sectionHeading.transform[4] - mmToPt(14))).toBeLessThan(1);
            for (const item of [internship, project, education, certification]) {
                expect(Math.abs(item.transform[4] + item.width - (width - mmToPt(14)))).toBeLessThan(1);
            }
            expect(internship.fontName).toBe(role.fontName);
            expect(project.fontName).toBe(role.fontName);
            expect(education.fontName).toBe(project.fontName);
            expect(certification.fontName).toBe(project.fontName);
            expect(company.fontName).not.toBe(education.fontName);
            expect(items.every((item) => item.transform[5] >= mmToPt(8))).toBe(true);
        } finally {
            await loading.destroy();
        }
    }, 25_000);

    it('applies the body font size and line spacing to the generated PDF', async () => {
        const loading = await render({
            schemaVersion: '1.0.0',
            profile: { fullName: 'Example' },
            sections: [{ id: 'summary', title: 'Summary', type: 'summary', content: 'First line\nSecond line' }],
            rendering: { layout: { bodyFontSizePt: 10.5, lineHeight: 1.4, letterSpacingPt: 0.25 } },
        });
        try {
            const pdf = await loading.promise;
            const { items } = await (await pdf.getPage(1)).getTextContent();
            const lines = items
                .filter((item) => 'str' in item)
                .filter((item) => ['First line', 'Second line'].includes(item.str));
            expect(lines).toHaveLength(2);
            for (const line of lines) expect(line.transform[0]).toBeCloseTo(10.5, 1);
            expect(Math.abs(lines[0].transform[5] - lines[1].transform[5] - 14.7)).toBeLessThan(1);
        } finally {
            await loading.destroy();
        }
    });

    it.each([undefined, 2, 3, 4])('fills skills left to right with columns set to %s', async (columns) => {
        const count = columns ?? 3;
        const labels = ['Alpha skill', 'Beta skill', 'Gamma skill', 'Delta skill', 'Epsilon skill'];
        const loading = await render({
            schemaVersion: '1.0.0',
            profile: { fullName: 'Example' },
            sections: [
                {
                    id: 'skills',
                    type: 'skill_groups',
                    title: 'Skills',
                    style: 'bullets',
                    columns,
                    items: [{ values: labels }],
                },
            ],
        });
        try {
            const pdf = await loading.promise;
            const { items } = await (await pdf.getPage(1)).getTextContent();
            const positions = labels.map((label) => {
                const item = items.find((entry) => 'str' in entry && entry.str === label);
                if (!item || !('transform' in item)) throw new Error(`Missing PDF text: ${label}`);
                return { x: item.transform[4], y: item.transform[5] };
            });
            const firstRow = positions.slice(0, count);
            firstRow.forEach((item, index) => {
                expect(item.y).toBeCloseTo(firstRow[0].y);
                if (index > 0) expect(item.x).toBeGreaterThan(firstRow[index - 1].x);
            });
            expect(positions[count].y).toBeLessThan(firstRow[0].y);
            expect(positions[count].x).toBeCloseTo(firstRow[0].x);
        } finally {
            await loading.destroy();
        }
    });

    it.each(['student_fresher_resume', 'experienced_professional_resume'])('renders the %s fixture', async (name) => {
        const resume = fixture(name);
        const loading = await render(resume);
        try {
            const pdf = await loading.promise;
            const page = await pdf.getPage(1);
            const content = await page.getTextContent();
            expect(
                content.items.some((item) => 'str' in item && item.str === resume.profile.fullName.toUpperCase()),
            ).toBe(true);
        } finally {
            await loading.destroy();
        }
    });

    it('splits long content across A4 pages and retains each line and the final entry', async () => {
        const longTitle = 'Senior Engineer Responsible for International Reporting and Infrastructure Delivery '
            .repeat(4)
            .trim();
        const paragraphs = Array.from(
            { length: 85 },
            (_, i) =>
                `Line ${String(i).padStart(2, '0')} – Élodie’s R&D team delivered accessible reporting and analysis.`,
        );
        const loading = await render({
            schemaVersion: '1.0.0',
            profile: { fullName: 'Élodie Rivera' },
            sections: [
                {
                    id: 'work',
                    title: 'Experience',
                    type: 'experience',
                    items: [
                        {
                            role: longTitle,
                            dateDisplay: 'Jan 2020 – Present',
                            bullets: [paragraphs.join('\n')],
                        },
                        { role: 'Final entry', bullets: ['Last bullet.'] },
                    ],
                },
            ],
        });
        try {
            const pdf = await loading.promise;
            expect(pdf.numPages).toBeGreaterThan(1);
            const lines: string[] = [];
            for (let number = 1; number <= pdf.numPages; number++) {
                const page = await pdf.getPage(number);
                const items = (await page.getTextContent()).items.filter((item) => 'str' in item);
                expect(items.every((item) => item.transform[5] >= mmToPt(8) - 1)).toBe(true);
                lines.push(items.map((item) => item.str).join(' '));
            }
            expect(lines[0]).toContain('EXPERIENCE');
            expect(lines[0]).toContain('Line 00');
            expect(lines.join(' ')).toContain('Élodie’s R&D');
            for (let i = 0; i < paragraphs.length; i++) {
                expect(lines.join(' ')).toContain(`Line ${String(i).padStart(2, '0')} –`);
            }
            expect(lines.at(-1)).toContain('Line 84');
            expect(lines.at(-1)).toContain('Last bullet.');
        } finally {
            await loading.destroy();
        }
    });

    it('omits hidden sections and scores from the PDF while keeping visible education details', async () => {
        const resume = fixture('resume_full');
        const loading = await render({
            ...resume,
            sections: resume.sections.map((section) => {
                if (section.type === 'projects') return { ...section, visible: false };
                if (section.type !== 'education') return section;
                return {
                    ...section,
                    items: [
                        ...section.items.map((item, index) =>
                            index === 0 && item.score ? { ...item, score: { ...item.score, visible: false } } : item,
                        ),
                        { qualification: 'Coursework' },
                    ],
                };
            }),
        });
        try {
            const pdf = await loading.promise;
            expect(pdf.numPages).toBe(1);
            const page = await pdf.getPage(1);
            const content = await page.getTextContent();
            const text = content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ');
            expect(text).not.toContain('PROJECTS');
            expect(text).not.toContain('Customer Churn Analysis');
            expect(text).not.toContain('CGPA');
            expect(text).not.toContain('8.4/10');
            expect(text).toContain('B.Sc. in Statistics');
            expect(text).toContain('Christ University');
            expect(text).toContain('Percentage: 89%');
            expect(text).toContain('Coursework');
            const annotations = await page.getAnnotations();
            expect(annotations.filter((item) => item.subtype === 'Link')).toHaveLength(7);
        } finally {
            await loading.destroy();
        }
    });

    it('omits a hidden contact link and keeps the remaining links in order', async () => {
        const loading = await render({
            schemaVersion: '1.0.0',
            profile: {
                fullName: 'Example',
                contact: {
                    links: [
                        { label: 'LinkedIn', url: 'https://example.com/linkedin' },
                        {
                            label: 'GitHub',
                            url: 'https://example.com/github',
                            visible: false,
                        },
                        {
                            label: 'Portfolio',
                            url: 'https://example.com/portfolio',
                            visible: true,
                        },
                    ],
                },
            },
            sections: [],
        });
        try {
            const page = await (await loading.promise).getPage(1);
            const text = (await page.getTextContent()).items
                .flatMap((item) => ('str' in item ? [item.str] : []))
                .join(' ')
                .replace(/\s+/g, ' ');
            expect(text).toContain('LinkedIn | Portfolio');
            expect(text).not.toContain('GitHub');
            expect(
                (await page.getAnnotations()).filter((item) => item.subtype === 'Link').map((item) => item.url),
            ).toEqual(['https://example.com/linkedin', 'https://example.com/portfolio']);
        } finally {
            await loading.destroy();
        }
    });

    it('returns validation paths and generic errors for malformed or oversized JSON', async () => {
        const result = await request(app.getHttpServer())
            .post('/resumes/render')
            .send({
                schemaVersion: '1.0.0',
                profile: {},
                sections: [{ id: 'x', title: 'X', type: 'unsupported' }],
            })
            .expect(400);
        expect(result.body.issues.map((issue: { path: string }) => issue.path)).toEqual([
            'profile.fullName',
            'sections.0.type',
        ]);

        const malformed = await request(app.getHttpServer())
            .post('/resumes/render')
            .type('json')
            .send('{"private content" broken}')
            .expect(400);
        expect(malformed.body.message).toBe('Invalid JSON body');
        await request(app.getHttpServer())
            .post('/resumes/render')
            .send({ text: 'x'.repeat(103_000) })
            .expect(413);
        await request(app.getHttpServer()).post('/resumes/render').type('text').send('text').expect(415);
    });
});
