import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { templateConfigSchema, templateIdSchema, templateVersionSchema } from './template.schema.js';
import { TemplateService, type TemplateRevision, type TemplateSummary } from './template.service.js';

const versionQuery = z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(templateVersionSchema);
const createTemplate = z.strictObject({ id: templateIdSchema, config: templateConfigSchema });
const updateTemplate = z.strictObject({ expectedVersion: templateVersionSchema, config: templateConfigSchema });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) {
        throw new BadRequestException({
            statusCode: 400,
            message: 'Invalid template configuration or reference',
            issues: result.error.issues
                .slice(0, 20)
                .map(({ path, message }) => ({ path: path.map(String).join('.'), message })),
        });
    }
    return result.data;
}

@Controller('resumes/templates')
export class TemplateController {
    constructor(private readonly templates: TemplateService) {}

    @Get()
    list(): Promise<TemplateSummary[]> {
        return this.templates.list();
    }

    @Get(':id')
    get(@Param('id') id: string, @Query('version') version: unknown): Promise<TemplateRevision> {
        return this.templates.get({
            id: parse(templateIdSchema, id),
            version: parse(versionQuery.optional(), version),
        });
    }

    @Post()
    create(@Body() body: unknown): Promise<TemplateRevision> {
        const { id, config } = parse(createTemplate, body);
        return this.templates.create(id, config);
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() body: unknown): Promise<TemplateRevision> {
        const { expectedVersion, config } = parse(updateTemplate, body);
        return this.templates.update(parse(templateIdSchema, id), expectedVersion, config);
    }

    @Delete(':id')
    @HttpCode(204)
    remove(@Param('id') id: string, @Query('version') version: unknown): Promise<void> {
        return this.templates.remove(parse(templateIdSchema, id), parse(versionQuery, version));
    }
}
