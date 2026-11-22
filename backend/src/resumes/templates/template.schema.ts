import { z } from 'zod';

export const sectionTypes = [
    'summary',
    'skill_groups',
    'experience',
    'projects',
    'education',
    'certifications',
    'bullet_list',
] as const;

const rule = z.strictObject({
    priority: z.number().int().min(0).max(100).optional(),
    maxItems: z.number().int().min(0).max(100).optional(),
    protected: z.boolean().optional(),
});

const sections = z.partialRecord(z.enum(sectionTypes), rule);
const settings = {
    maxPages: z.number().int().min(1).max(10),
    allowEducationExclusion: z.boolean(),
    sections,
};

export const layoutOverridesSchema = z.strictObject(settings).partial();

export const templateConfigSchema = z.strictObject({
    name: z.string().trim().min(1).max(100),
    ...settings,
    studentOverrides: layoutOverridesSchema.optional(),
});

export const templateIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const templateVersionSchema = z.number().int().positive();
export const templateRefSchema = z.strictObject({
    id: templateIdSchema,
    version: templateVersionSchema.optional(),
});

export type LayoutOverrides = z.infer<typeof layoutOverridesSchema>;
export type TemplateConfig = z.infer<typeof templateConfigSchema>;
export type TemplateRef = z.infer<typeof templateRefSchema>;
