import {
    BadRequestException,
    Body,
    Controller,
    GatewayTimeoutException,
    Header,
    HttpCode,
    InternalServerErrorException,
    Post,
    ServiceUnavailableException,
    StreamableFile,
    UnprocessableEntityException,
} from '@nestjs/common';
import { z } from 'zod';
import { ResumeLayoutService, type LayoutReport, type ResumeLayout } from './resume-layout.service.js';
import { PdfRendererBusy, PdfRenderTimeout } from './resume-pdf.renderer.js';
import { resumeSchema } from './resume.schema.js';
import { layoutOverridesSchema, templateRefSchema } from './templates/template.schema.js';
import { defaultTemplateId, TemplateService } from './templates/template.service.js';

const workflowSchema = z
    .strictObject({
        resume: resumeSchema,
        template: templateRefSchema.default({ id: defaultTemplateId }),
        layout: layoutOverridesSchema.optional(),
    })
    .superRefine(({ resume }, context) => {
        if (
            !resume.sections.some((section) => section.type === 'projects' && section.visible && section.items.length)
        ) {
            context.addIssue({
                code: 'custom',
                path: ['resume', 'sections', 'projects'],
                message: 'Add at least one project and make sure its section is visible.',
            });
        }
    });
type Workflow = z.infer<typeof workflowSchema>;

interface ResumePreview {
    pdf: string;
    report: LayoutReport;
}

@Controller('resumes')
export class ResumeWorkflowController {
    constructor(
        private readonly layoutService: ResumeLayoutService,
        private readonly templates: TemplateService,
    ) {}

    @Post('preview')
    @HttpCode(200)
    @Header('Cache-Control', 'no-store')
    async preview(@Body() body: unknown): Promise<ResumePreview> {
        const { pdf, report } = await this.fit(this.parse(body));
        return { pdf: pdf.toString('base64'), report };
    }

    @Post('export/pdf')
    @HttpCode(200)
    @Header('Cache-Control', 'no-store')
    async exportPdf(@Body() body: unknown): Promise<StreamableFile> {
        const { pdf, report } = await this.fit(this.parse(body));
        if (!report.fits) {
            throw new UnprocessableEntityException({
                statusCode: 422,
                message: 'Resume does not fit the configured page limit',
                report,
            });
        }
        return new StreamableFile(pdf, {
            type: 'application/pdf',
            disposition: 'attachment; filename="resume.pdf"',
            length: pdf.length,
        });
    }

    @Post('export/json')
    @HttpCode(200)
    @Header('Cache-Control', 'no-store')
    async exportJson(@Body() body: unknown): Promise<StreamableFile> {
        const input = this.parse(body);
        const { id, version } = await this.templates.get(input.template);
        const json = Buffer.from(JSON.stringify({ ...input, template: { id, version } }, null, 2) + '\n');
        return new StreamableFile(json, {
            type: 'application/json',
            disposition: 'attachment; filename="resume.json"',
            length: json.length,
        });
    }

    private parse(body: unknown): Workflow {
        const result = workflowSchema.safeParse(body);
        if (result.success) return result.data;
        throw new BadRequestException({
            statusCode: 400,
            message: 'Invalid resume or layout settings',
            issues: result.error.issues.slice(0, 20).map(({ path, code, message }) => ({
                path: path.map(String).join('.'),
                message: code === 'unrecognized_keys' ? 'Remove unsupported fields from this object' : message,
            })),
        });
    }

    private async fit(input: Workflow): Promise<ResumeLayout> {
        const template = await this.templates.get(input.template);
        try {
            return await this.layoutService.fit(input.resume, template, input.layout);
        } catch (error) {
            if (error instanceof PdfRendererBusy)
                throw new ServiceUnavailableException('PDF renderer is busy. Retry shortly.');
            if (error instanceof PdfRenderTimeout) throw new GatewayTimeoutException('PDF rendering timed out');
            throw new InternalServerErrorException('PDF rendering failed');
        }
    }
}
