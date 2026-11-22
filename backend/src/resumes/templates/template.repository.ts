import { Injectable } from '@nestjs/common';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { templateConfigSchema, templateIdSchema } from './template.schema.js';

const recordSchema = z.strictObject({
    isDeleted: z.boolean(),
    revisions: z.array(templateConfigSchema).min(1),
});

export type TemplateRecord = z.infer<typeof recordSchema>;

@Injectable()
export class TemplateRepository {
    private readonly directory = resolve(process.env.RESUME_TEMPLATE_DIR ?? '.resume-templates');

    async find(id: string): Promise<TemplateRecord | undefined> {
        try {
            const json: unknown = JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8'));
            return recordSchema.parse(json);
        } catch (error) {
            if (this.isMissing(error)) return undefined;
            throw error;
        }
    }

    async listIds(): Promise<string[]> {
        try {
            const filenames = await readdir(this.directory);
            return filenames
                .filter((name) => name.endsWith('.json'))
                .map((name) => name.slice(0, -5))
                .filter((id) => templateIdSchema.safeParse(id).success)
                .sort();
        } catch (error) {
            if (this.isMissing(error)) return [];
            throw error;
        }
    }

    async save(id: string, record: TemplateRecord): Promise<void> {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = join(this.directory, `.${randomUUID()}.tmp`);
        try {
            await writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
            await rename(temporary, join(this.directory, `${id}.json`));
        } finally {
            await unlink(temporary).catch((error: unknown) => {
                if (!this.isMissing(error)) throw error;
            });
        }
    }

    private isMissing(error: unknown): boolean {
        return error instanceof Error && 'code' in error && error.code === 'ENOENT';
    }
}
