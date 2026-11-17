import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import defaults from './default-template.json' with { type: 'json' };
import { TemplateRepository, type TemplateRecord } from './template.repository.js';
import { templateConfigSchema, type TemplateConfig, type TemplateRef } from './template.schema.js';

export const defaultTemplateId = 'classic-ats';

export interface TemplateRevision {
    id: string;
    version: number;
    config: TemplateConfig;
}

export interface TemplateSummary {
    id: string;
    name: string;
    version: number;
}

@Injectable()
export class TemplateService {
    private readonly defaultConfig = templateConfigSchema.parse(defaults);
    private pendingWrite: Promise<unknown> = Promise.resolve();

    constructor(private readonly repository: TemplateRepository) {}

    async list(): Promise<TemplateSummary[]> {
        const templates = await Promise.all(
            (await this.repository.listIds()).map(async (id) => {
                const record = await this.repository.find(id);
                const config = record?.revisions.at(-1);
                return record && !record.isDeleted && config
                    ? [{ id, name: config.name, version: record.revisions.length }]
                    : [];
            }),
        );
        return [{ id: defaultTemplateId, name: this.defaultConfig.name, version: 1 }, ...templates.flat()];
    }

    async get({ id, version }: TemplateRef): Promise<TemplateRevision> {
        if (id === defaultTemplateId && (version === undefined || version === 1)) {
            return { id, version: 1, config: this.defaultConfig };
        }
        const record = await this.repository.find(id);
        const selected = version ?? record?.revisions.length ?? 0;
        const config = record?.revisions[selected - 1];
        if (!config || (version === undefined && record?.isDeleted))
            throw new NotFoundException('Template version not found');
        return { id, version: selected, config };
    }

    create(id: string, config: TemplateConfig): Promise<TemplateRevision> {
        return this.write(async () => {
            this.assertEditable(id);
            if (await this.repository.find(id)) throw new ConflictException('Template ID is already reserved');
            await this.repository.save(id, { isDeleted: false, revisions: [config] });
            return { id, version: 1, config };
        });
    }

    update(id: string, expectedVersion: number, config: TemplateConfig): Promise<TemplateRevision> {
        return this.write(async () => {
            const record = await this.currentForWrite(id, expectedVersion);
            record.revisions.push(config);
            await this.repository.save(id, record);
            return { id, version: record.revisions.length, config };
        });
    }

    remove(id: string, expectedVersion: number): Promise<void> {
        return this.write(async () => {
            const record = await this.currentForWrite(id, expectedVersion);
            await this.repository.save(id, { ...record, isDeleted: true });
        });
    }

    private write<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.pendingWrite.then(operation);
        this.pendingWrite = result.catch(() => undefined);
        return result;
    }

    private async currentForWrite(id: string, expectedVersion: number): Promise<TemplateRecord> {
        this.assertEditable(id);
        const record = await this.repository.find(id);
        if (!record || record.isDeleted) throw new NotFoundException('Template not found');
        if (record.revisions.length !== expectedVersion)
            throw new ConflictException('Template has changed. Reload it before saving.');
        return record;
    }

    private assertEditable(id: string): void {
        if (id === defaultTemplateId) throw new ConflictException('The built-in template is read-only');
    }
}
