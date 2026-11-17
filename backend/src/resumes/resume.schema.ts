import { z } from 'zod';

const text = z
    .string()
    .min(1)
    .max(500)
    .refine((value) => value.trim().length > 0, 'Enter nonblank text');
const prose = z.string().min(1).max(16_000);
const metadata = text.nullish();
const bullets = z.array(prose).max(100);
const values = z.array(text).max(100);
const url = z
    .string()
    .max(2048)
    .refine((value) => {
        // Chromium normalizes ASCII controls in URLs. Reject them before parsing.
        // oxlint-disable-next-line eslint/no-control-regex
        if (/[\s\u0000-\u001f\u007f]/u.test(value)) return false;
        const parsed = URL.parse(value);
        return parsed !== null && ['https:', 'http:', 'mailto:', 'tel:'].includes(parsed.protocol);
    }, 'Use a valid HTTPS, HTTP, mailto, or tel URL');
const link = z.strictObject({ label: text, url, type: text.optional() });
const links = z.array(link).max(12);
const contactLinks = z.array(link.extend({ visible: z.boolean().default(true) })).max(12);
const section = { id: text, title: text, visible: z.boolean().default(true) };
const itemSection = {
    ...section,
    protectedItemIndexes: z.array(z.number().int().min(0).max(99)).max(100).optional(),
};
const entryDate = { dateDisplay: metadata };

const sectionSchema = z.discriminatedUnion('type', [
    z.strictObject({ ...section, type: z.literal('summary'), content: prose }),
    z
        .strictObject({
            ...itemSection,
            type: z.literal('skill_groups'),
            style: z.enum(['grouped', 'bullets']).default('grouped'),
            columns: z.literal([2, 3, 4]).default(3),
            items: z.array(z.strictObject({ label: text.optional(), values })).max(100),
        })
        .superRefine(({ style, items }, context) => {
            if (style !== 'grouped') return;
            items.forEach(({ label }, index) => {
                if (label !== undefined) return;
                context.addIssue({
                    code: 'custom',
                    path: ['items', index, 'label'],
                    message: 'Enter a group label for Grouped rows',
                });
            });
        }),
    z.strictObject({
        ...itemSection,
        type: z.literal('experience'),
        items: z
            .array(
                z.strictObject({
                    role: text,
                    organization: metadata,
                    location: metadata,
                    ...entryDate,
                    startDate: metadata,
                    endDate: metadata,
                    bullets: bullets.optional(),
                }),
            )
            .max(100),
    }),
    z.strictObject({
        ...itemSection,
        type: z.literal('projects'),
        items: z
            .array(
                z.strictObject({
                    name: text,
                    ...entryDate,
                    date: metadata,
                    links: links.optional(),
                    bullets: bullets.optional(),
                    technologies: values.optional(),
                }),
            )
            .max(100),
    }),
    z.strictObject({
        ...itemSection,
        type: z.literal('education'),
        items: z
            .array(
                z.strictObject({
                    qualification: text,
                    institution: metadata,
                    location: metadata,
                    ...entryDate,
                    completionDate: metadata,
                    score: z
                        .strictObject({
                            label: text,
                            value: text,
                            visible: z.boolean().default(true),
                        })
                        .nullish(),
                }),
            )
            .max(100),
    }),
    z.strictObject({
        ...itemSection,
        type: z.literal('certifications'),
        items: z
            .array(
                z.strictObject({
                    name: text,
                    issuer: metadata,
                    durationDisplay: metadata,
                    dateDisplay: z
                        .string()
                        .regex(
                            /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [1-9]\d{3}$/,
                            'Use an abbreviated month and four-digit year, such as Jan 2026',
                        )
                        .nullish(),
                    year: z.number().int().min(1).max(9999).nullish(),
                    url: url.nullish(),
                }),
            )
            .max(100),
    }),
    z.strictObject({
        ...itemSection,
        type: z.literal('bullet_list'),
        items: bullets,
    }),
]);

const margins = { top: 9, right: 14, bottom: 8, left: 14 } as const;
const marginMm = z.strictObject({
    top: z.literal(margins.top),
    right: z.literal(margins.right),
    bottom: z.literal(margins.bottom),
    left: z.literal(margins.left),
});
const page = z.strictObject({
    size: z.literal('A4'),
    orientation: z.literal('portrait'),
    marginMm,
});
const color = z.string().regex(/^#[\da-f]{6}$/i, 'Use a six-digit hex color');
const font = z.enum([
    'Arial',
    'Helvetica',
    'Georgia',
    'Times New Roman',
    'Verdana',
    'Tahoma',
    'DejaVu Sans',
    'Liberation Sans',
]);
const fonts = z.strictObject({
    body: font.default('Arial'),
    heading: font.default('Arial'),
});
const colors = z.strictObject({
    primary: color.default('#1F3A68'),
    body: color.default('#202020'),
    background: color.default('#FFFFFF'),
});
const layout = z.strictObject({
    headerAlignment: z.literal('center').default('center'),
    sectionHeadingCase: z.literal('uppercase').default('uppercase'),
    sectionDivider: z.literal(true).default(true),
    rightAlignDates: z.literal(true).default(true),
    linksUnderlined: z.literal(true).default(true),
    compactSpacing: z.boolean().default(true),
    bodyFontSizePt: z.number().min(8).max(12).optional(),
    lineHeight: z.number().min(1.05).max(1.6).default(1.13),
    letterSpacingPt: z.number().min(-0.2).max(0.8).default(0),
    keepEntryHeadingWithContent: z.literal(true).default(true),
    allowAdditionalPages: z.literal(true).default(true),
});
const output = z.strictObject({
    format: z.literal('pdf'),
    printBackground: z.literal(true),
    preferCssPageSize: z.literal(true),
    tagged: z.literal(true),
});

function typographyToken<Size extends number, Weight extends number, Options extends z.ZodRawShape>(
    fontSize: Size,
    fontWeight: Weight,
    options: Options,
) {
    return z.strictObject({
        fontSize: z.literal(fontSize),
        fontWeight: z.literal(fontWeight),
        ...options,
    });
}

const center = z.literal('center');
const uppercase = z.literal('uppercase');
const italic = z.literal('italic');
const primary = z.literal('primary');
const right = z.literal('right');
const typography = z.strictObject({
    unit: z.literal('pt'),
    name: typographyToken(22, 700, {
        textTransform: uppercase,
        textAlign: center,
    }),
    headline: typographyToken(11.5, 700, {
        colorToken: primary,
        textAlign: center,
    }),
    contact: typographyToken(9, 400, { textAlign: center }),
    sectionHeading: typographyToken(11, 700, {
        colorToken: primary,
        textTransform: uppercase,
    }),
    entryTitle: typographyToken(9.8, 700, {}),
    companyAndEducationScore: typographyToken(9, 400, {
        fontStyle: italic,
        colorToken: primary,
    }),
    date: typographyToken(9.2, 700, { textAlign: right }),
    educationDate: typographyToken(9.2, 700, {
        fontStyle: z
            .enum(['normal', 'italic'])
            .default('normal')
            .transform((): 'normal' => 'normal'),
        textAlign: right,
    }),
    body: typographyToken(9.2, 400, {}),
    bullets: typographyToken(9.2, 400, {}),
    skills: typographyToken(9.2, 400, {}),
});

const rendering = z.strictObject({
    template: z.literal('classic-ats').default('classic-ats'),
    page: page.prefault({
        size: 'A4',
        orientation: 'portrait',
        marginMm: margins,
    }),
    colors: colors.prefault({}),
    fonts: fonts.prefault({}),
    layout: layout.prefault({}),
    output: output.prefault({
        format: 'pdf',
        printBackground: true,
        preferCssPageSize: true,
        tagged: true,
    }),
    typography: typography.prefault({
        unit: 'pt',
        name: {
            fontSize: 22,
            fontWeight: 700,
            textTransform: 'uppercase',
            textAlign: 'center',
        },
        headline: {
            fontSize: 11.5,
            fontWeight: 700,
            colorToken: 'primary',
            textAlign: 'center',
        },
        contact: { fontSize: 9, fontWeight: 400, textAlign: 'center' },
        sectionHeading: {
            fontSize: 11,
            fontWeight: 700,
            colorToken: 'primary',
            textTransform: 'uppercase',
        },
        entryTitle: { fontSize: 9.8, fontWeight: 700 },
        companyAndEducationScore: {
            fontSize: 9,
            fontWeight: 400,
            fontStyle: 'italic',
            colorToken: 'primary',
        },
        date: { fontSize: 9.2, fontWeight: 700, textAlign: 'right' },
        educationDate: {
            fontSize: 9.2,
            fontWeight: 700,
            fontStyle: 'normal',
            textAlign: 'right',
        },
        body: { fontSize: 9.2, fontWeight: 400 },
        bullets: { fontSize: 9.2, fontWeight: 400 },
        skills: { fontSize: 9.2, fontWeight: 400 },
    }),
});

export const resumeSchema = z
    .strictObject({
        schemaVersion: z.literal('1.0.0'),
        document: z
            .strictObject({
                type: z.literal('resume'),
                language: z.string().regex(/^[a-z]{2,8}(?:-[a-z\d]{1,8})*$/i),
                sourceFilename: text.optional(),
                pageSize: z.literal('A4'),
                sourcePageCount: z.number().int().positive().optional(),
                contentVariant: text.optional(),
                sampleData: z.boolean().optional(),
            })
            .optional(),
        profile: z.strictObject({
            fullName: text,
            headline: metadata,
            contact: z
                .strictObject({
                    phone: metadata,
                    email: z.email().max(254).nullish(),
                    location: z
                        .strictObject({
                            display: text,
                            city: metadata,
                            state: metadata,
                            country: metadata,
                        })
                        .nullish(),
                    links: contactLinks.optional(),
                })
                .nullish(),
        }),
        sections: z.array(sectionSchema).max(32),
        rendering: rendering.prefault({}),
    })
    .superRefine(({ sections }, context) => {
        sections.forEach((section, sectionIndex) => {
            if (section.type === 'summary') return;
            section.protectedItemIndexes?.forEach((index, optionIndex) => {
                if (index < section.items.length) return;
                context.addIssue({
                    code: 'custom',
                    path: ['sections', sectionIndex, 'protectedItemIndexes', optionIndex],
                    message: 'Protected index must refer to an existing item',
                });
            });
        });
    });

export type Resume = z.infer<typeof resumeSchema>;
export type ResumeSection = z.infer<typeof sectionSchema>;
