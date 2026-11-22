import { readFileSync } from 'node:fs';
import { ClassicAtsTemplate } from './classic-ats.template.js';
import { resumeSchema } from './resume.schema.js';

const fixture: unknown = JSON.parse(readFileSync(new URL('../../docs/resume_full.json', import.meta.url), 'utf8'));

describe('resume validation and classic ATS template', () => {
    it('renders all supported sections in document order', () => {
        const resume = resumeSchema.parse(fixture);
        const html = new ClassicAtsTemplate().render(resume);
        expect([...html.matchAll(/<section class="([^"]+)">/g)].map((match) => match[1])).toEqual(
            resume.sections.map((section) => section.type),
        );
        expect(html).toContain('Tech/Tools Used:');
        expect(html).toContain('<strong>Programming &amp; Querying:</strong>');
        expect(html).toContain('CGPA: 8.4/10');
        expect(html).toContain('Coursera | 6 months');
    });

    it('renders skills as escaped bullets in group and value order', () => {
        const resume = resumeSchema.parse({
            schemaVersion: '1.0.0',
            profile: { fullName: 'Example' },
            sections: [
                {
                    id: 'skills',
                    title: 'Skills',
                    type: 'skill_groups',
                    style: 'bullets',
                    items: [
                        { label: 'Languages', values: ['TypeScript', 'SQL'] },
                        { label: 'Practices', values: ['Research & development'] },
                    ],
                },
            ],
        });
        const html = new ClassicAtsTemplate().render(resume);
        expect(html).toContain(
            '<ul data-columns="3"><li>TypeScript</li><li>SQL</li><li>Research &amp; development</li></ul>',
        );
        expect(html).not.toContain('Languages');
        expect(html).not.toContain('Practices');
    });

    it('escapes markup and attributes while retaining Unicode and optional empty lists', () => {
        const resume = resumeSchema.parse({
            schemaVersion: '1.0.0',
            profile: {
                fullName: 'Élodie & <script>"test"</script>',
                contact: {
                    links: [{ label: 'Élodie’s work', url: 'https://example.org/?q="&a=2' }],
                },
            },
            sections: [
                {
                    id: 'awards',
                    title: 'Awards – <More>',
                    type: 'bullet_list',
                    items: [],
                },
            ],
        });
        const html = new ClassicAtsTemplate().render(resume);
        expect(html).toContain('Élodie &amp; &lt;script&gt;&quot;test&quot;&lt;/script&gt;');
        expect(html).toContain('href="https://example.org/?q=&quot;&amp;a=2">Élodie’s work</a>');
        expect(html).toContain('Awards – &lt;More&gt;');
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<ul>');
    });

    it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'https://', 'https://exam\nple.org'])(
        'rejects an unsafe or invalid URL (%s)',
        (url) => {
            expect(
                resumeSchema.safeParse({
                    schemaVersion: '1.0.0',
                    profile: {
                        fullName: 'Example',
                        contact: { links: [{ label: 'Work', url }] },
                    },
                    sections: [],
                }).success,
            ).toBe(false);
        },
    );

    it('rejects unknown fields, section types, and injected or incompatible style values', () => {
        const input = {
            schemaVersion: '1.0.0',
            profile: { fullName: 'Example' },
            sections: [],
        };
        for (const invalid of [
            { ...input, profile: { fullName: '   ' } },
            { ...input, unknown: true },
            { ...input, sections: [{ id: 'x', title: 'X', type: 'unknown' }] },
            {
                ...input,
                sections: [
                    {
                        id: 'x',
                        title: 'X',
                        type: 'bullet_list',
                        items: [],
                        visible: 'false',
                    },
                ],
            },
            {
                ...input,
                sections: [
                    {
                        id: 'x',
                        title: 'X',
                        type: 'skill_groups',
                        items: [],
                        style: 'inline',
                    },
                ],
            },
            { ...input, rendering: { fonts: { body: 'Arial"; } </style>' } } },
            {
                ...input,
                sections: [{ id: 'skills', title: 'Skills', type: 'skill_groups', items: [{ values: ['SQL'] }] }],
            },
            { ...input, rendering: { colors: { body: '#000; background:url(x)' } } },
            {
                ...input,
                rendering: {
                    typography: {
                        ...resumeSchema.parse(input).rendering.typography,
                        unit: 'px',
                    },
                },
            },
        ]) {
            expect(resumeSchema.safeParse(invalid).success).toBe(false);
        }
    });

    it('uses the specified print geometry and absolute typography tokens', () => {
        const html = new ClassicAtsTemplate().render(resumeSchema.parse(fixture));
        expect(html).toContain('@page { size: A4 portrait; margin: 9mm 14mm 8mm 14mm; }');
        expect(html).toContain('font-size: 22pt; font-weight: 700; text-transform: uppercase; text-align: center;');
        expect(html).toContain('font-size: 11.5pt; font-weight: 700; color: var(--primary); text-align: center;');
        expect(html).toContain('font-size: 9.8pt; font-weight: 700;');
        expect(html).toContain(
            '.metadata { font-size: 9pt; font-weight: 400; font-style: italic; color: var(--primary); }',
        );
        expect(html).toContain('.date { font-size: 9.2pt; font-weight: 700; text-align: right; }');
        expect(html).toContain(
            '.education .date { font-size: 9.2pt; font-weight: 700; font-style: normal; text-align: right; }',
        );
    });

    it('renders sections reordered when section_order is provided', () => {
        const base = resumeSchema.parse(fixture);
        const customOrder = ['certifications', 'education', 'projects', 'experience', 'skills', 'summary', 'achievements'];
        const resume = resumeSchema.parse({
            ...base,
            section_order: customOrder,
        });
        const html = new ClassicAtsTemplate().render(resume);
        const sectionClasses = [...html.matchAll(/<section class="([^"]+)">/g)].map((match) => match[1]);
        expect(sectionClasses).toEqual([
            'certifications',
            'education',
            'projects',
            'experience',
            'skill_groups',
            'summary',
            'bullet_list',
        ]);
    });

    it('renders sections reordered when section order property is provided', () => {
        const base = resumeSchema.parse(fixture);
        const sectionsWithOrder = base.sections.map((section) => {
            if (section.type === 'certifications') return { ...section, order: 1 };
            if (section.type === 'education') return { ...section, order: 2 };
            if (section.type === 'projects') return { ...section, order: 3 };
            if (section.type === 'experience') return { ...section, order: 4 };
            if (section.type === 'skill_groups') return { ...section, order: 5 };
            if (section.type === 'summary') return { ...section, order: 6 };
            if (section.type === 'bullet_list') return { ...section, order: 7 };
            return section;
        });
        const resume = resumeSchema.parse({
            ...base,
            sections: sectionsWithOrder,
        });
        const html = new ClassicAtsTemplate().render(resume);
        const sectionClasses = [...html.matchAll(/<section class="([^"]+)">/g)].map((match) => match[1]);
        expect(sectionClasses).toEqual([
            'certifications',
            'education',
            'projects',
            'experience',
            'skill_groups',
            'summary',
            'bullet_list',
        ]);
    });
});
