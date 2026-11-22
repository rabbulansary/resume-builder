import {
    BadRequestException,
    Body,
    Controller,
    GatewayTimeoutException,
    HttpCode,
    Injectable,
    InternalServerErrorException,
    PipeTransform,
    Post,
    ServiceUnavailableException,
    StreamableFile,
} from '@nestjs/common';
import { PdfRendererBusy, PdfRenderTimeout } from './resume-pdf.renderer.js';
import { resumeSchema, type Resume } from './resume.schema.js';
import { ResumeService } from './resume.service.js';

@Injectable()
class ResumeValidationPipe implements PipeTransform<unknown, Resume> {
    transform(body: unknown): Resume {
        const result = resumeSchema.safeParse(body);
        if (result.success) return result.data;

        throw new BadRequestException({
            statusCode: 400,
            message: 'Invalid resume document',
            issues: result.error.issues.slice(0, 20).map((issue) => ({
                path: issue.path.map(String).join('.') || '(root)',
                message:
                    issue.code === 'unrecognized_keys'
                        ? 'Remove unsupported fields from this object'
                        : issue.code === 'invalid_union'
                          ? 'Use a supported section type: summary, skill_groups, experience, projects, education, certifications, or bullet_list'
                          : issue.message,
            })),
        });
    }
}

@Controller('resumes')
export class ResumeController {
    constructor(private readonly resumeService: ResumeService) {}

    @Post('render')
    @HttpCode(200)
    async render(@Body(ResumeValidationPipe) resume: Resume): Promise<StreamableFile> {
        try {
            const pdf = await this.resumeService.render(resume);
            return new StreamableFile(pdf, {
                type: 'application/pdf',
                disposition: 'attachment; filename="resume.pdf"',
                length: pdf.length,
            });
        } catch (error) {
            if (error instanceof PdfRendererBusy) {
                throw new ServiceUnavailableException('PDF renderer is busy. Retry shortly.');
            }
            if (error instanceof PdfRenderTimeout) {
                throw new GatewayTimeoutException('PDF rendering timed out');
            }
            throw new InternalServerErrorException('PDF rendering failed');
        }
    }
}
