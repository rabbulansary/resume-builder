import { Module } from '@nestjs/common';
import { PdfEditorController } from './pdf-editor.controller.js';

@Module({
    controllers: [PdfEditorController],
})
export class PdfEditorModule {}
