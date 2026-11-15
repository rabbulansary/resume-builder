import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ResumeModule } from './resumes/resume.module.js';
import { PdfEditorModule } from './pdf-editor/pdf-editor.module.js';

@Module({
    imports: [ResumeModule, PdfEditorModule],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
