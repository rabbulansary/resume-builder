import { Module } from '@nestjs/common';
import { ClassicAtsTemplate } from './classic-ats.template.js';
import { ResumePdfRenderer } from './resume-pdf.renderer.js';
import { ResumeController } from './resume.controller.js';
import { ResumeService } from './resume.service.js';

import { ResumeLayoutService } from './resume-layout.service.js';
import { ResumeWorkflowController } from './resume-workflow.controller.js';
import { TemplateController } from './templates/template.controller.js';
import { TemplateRepository } from './templates/template.repository.js';
import { TemplateService } from './templates/template.service.js';

@Module({
    controllers: [ResumeController, ResumeWorkflowController, TemplateController],
    providers: [
        ResumeService,
        ClassicAtsTemplate,
        ResumePdfRenderer,
        ResumeLayoutService,
        TemplateRepository,
        TemplateService,
    ],
})
export class ResumeModule {}
