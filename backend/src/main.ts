import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { resumeBodyParser } from './resumes/resume-body-parser.js';

async function bootstrap() {
    const configuredPort = process.env.BACKEND_PORT ?? process.env.PORT;
    try {
        process.loadEnvFile();
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const app = await NestFactory.create(AppModule);
    app.use('/resumes', resumeBodyParser);
    app.enableShutdownHooks();
    await app.listen(configuredPort ?? process.env.BACKEND_PORT ?? process.env.PORT ?? 3001);
}
await bootstrap();
