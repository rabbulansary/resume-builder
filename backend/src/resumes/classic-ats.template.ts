import { Injectable } from '@nestjs/common';
import { classicAtsStyles } from './classic-ats.styles.js';
import type { Resume, ResumeSection } from './resume.schema.js';

const entities: Readonly<Record<string, string>> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => entities[character]);
}

function anchor({ label, url }: { label: string; url: string }): string {
    return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

function bulletList(items: string[] = [], columns?: 2 | 3 | 4): string {
    if (items.length === 0) return '';
    return `<ul${columns ? ` data-columns="${columns}"` : ''}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function entryRow(title: string, date?: string | null): string {
    return `<div class="entry-row"><h3>${title}</h3>${date ? `<span class="date">${escapeHtml(date)}</span>` : ''}</div>`;
}

function metadata(parts: (string | null | undefined)[], separator: string): string {
    const content = parts.filter(Boolean).join(separator);
    return content ? `<p class="metadata">${escapeHtml(content)}</p>` : '';
}

@Injectable()
export class ClassicAtsTemplate {
    render(resume: Resume): string {
        const { profile, sections } = resume;
        const { contact } = profile;
        const contactParts = [contact?.phone, contact?.email, contact?.location?.display].flatMap((part) =>
            part ? [escapeHtml(part)] : [],
        );
        contactParts.push(...(contact?.links ?? []).filter((link) => link.visible).map(anchor));

        return `<!doctype html>
<html lang="${escapeHtml(resume.document?.language ?? 'en')}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(profile.fullName)}</title>
<style>${classicAtsStyles(resume.rendering)}</style>
</head>
<body>
<header class="resume-header">
<h1>${escapeHtml(profile.fullName)}</h1>
${profile.headline ? `<p class="headline">${escapeHtml(profile.headline)}</p>` : ''}
<div class="contact">${contactParts.join(' | ')}</div>
</header>
<main>${sections
            .filter((section) => section.visible)
            .map(
                (section) =>
                    `<section class="${section.type}"><h2>${escapeHtml(section.title)}</h2>${this.renderSection(section)}</section>`,
            )
            .join('')}</main>
</body>
</html>`;
    }

    private renderSection(section: ResumeSection): string {
        switch (section.type) {
            case 'summary':
                return `<p>${escapeHtml(section.content)}</p>`;
            case 'skill_groups':
                if (section.style === 'bullets') {
                    return bulletList(
                        section.items.flatMap((group) => group.values),
                        section.columns,
                    );
                }
                return section.items
                    .map(
                        ({ label, values }) =>
                            `<p class="skill"><strong>${escapeHtml(label ?? '')}:</strong> ${escapeHtml(values.join(', '))}</p>`,
                    )
                    .join('');
            case 'experience':
                return section.items
                    .map(
                        (item) =>
                            `<article><div class="entry-heading">${entryRow(escapeHtml(item.role), item.dateDisplay)}
          ${metadata([item.organization, item.location], ', ')}</div>${bulletList(item.bullets)}</article>`,
                    )
                    .join('');
            case 'projects':
                return section.items
                    .map((item) => {
                        const title = [escapeHtml(item.name), ...(item.links ?? []).map(anchor)].join(' | ');
                        const tools = item.technologies?.length
                            ? `<p><strong>Tech/Tools Used:</strong> ${escapeHtml(item.technologies.join(', '))}</p>`
                            : '';
                        return `<article><div class="entry-heading">${entryRow(title, item.dateDisplay)}</div>${bulletList(item.bullets)}${tools}</article>`;
                    })
                    .join('');
            case 'education':
                return section.items
                    .map(
                        (item) =>
                            `<article><div class="entry-heading">${entryRow(escapeHtml(item.qualification), item.dateDisplay)}
          ${metadata([item.institution, item.location], ', ')}
          ${metadata(item.score?.visible ? [item.score.label, item.score.value] : [], ': ')}</div></article>`,
                    )
                    .join('');
            case 'certifications':
                return section.items
                    .map((item) => {
                        const title = item.url ? anchor({ label: item.name, url: item.url }) : escapeHtml(item.name);
                        return `<article><div class="entry-heading">${entryRow(title, item.dateDisplay ?? item.year?.toString())}
          ${metadata([item.issuer, item.durationDisplay], ' | ')}</div></article>`;
                    })
                    .join('');
            case 'bullet_list':
                return bulletList(section.items);
        }
    }
}
