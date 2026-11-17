import { Injectable } from '@nestjs/common';
import { ClassicAtsTemplate } from './classic-ats.template.js';
import { ResumePdfRenderer } from './resume-pdf.renderer.js';
import type { Resume } from './resume.schema.js';

@Injectable()
export class ResumeService {
    constructor(
        private readonly template: ClassicAtsTemplate,
        private readonly pdfRenderer: ResumePdfRenderer,
    ) {}

    render(resume: Resume): Promise<Buffer> {
        return this.pdfRenderer.render(resume);
    }
}
