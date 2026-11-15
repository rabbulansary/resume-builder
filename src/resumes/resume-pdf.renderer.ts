import { Injectable, OnModuleDestroy } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import type { Resume, ResumeSection } from './resume.schema.js';

export class PdfRendererBusy extends Error {}
export class PdfRenderTimeout extends Error {}

export interface RenderDetails {
    pdf: Buffer;
    pageCount: number;
    contentHeightMm: number;
    horizontalOverflow: boolean;
}

const mmToPt = (mm: number) => (mm * 72) / 25.4;
const ptToMm = (pt: number) => (pt * 25.4) / 72;

@Injectable()
export class ResumePdfRenderer implements OnModuleDestroy {
    async onModuleDestroy(): Promise<void> {
        // Pure Node.js in-memory renderer; no long-lived browser instances to clean up.
    }

    async render(resume: Resume): Promise<Buffer> {
        const { pdf } = await this.renderWithDetails(resume);
        return pdf;
    }

    renderWithDetails(resume: Resume): Promise<RenderDetails> {
        return new Promise((resolve, reject) => {
            const pageConfig = resume.rendering.page;
            const topMargin = mmToPt(pageConfig.marginMm.top);
            const bottomMargin = mmToPt(pageConfig.marginMm.bottom);
            const leftMargin = mmToPt(pageConfig.marginMm.left);
            const rightMargin = mmToPt(pageConfig.marginMm.right);
            const pageWidth = mmToPt(210);
            const pageHeight = mmToPt(297);
            const usableWidth = pageWidth - leftMargin - rightMargin;
            const maxContentY = pageHeight - bottomMargin;

            const primaryColor = resume.rendering.colors.primary;
            const bodyColor = resume.rendering.colors.body;
            const compactSpacing = resume.rendering.layout.compactSpacing;
            const sectionGap = compactSpacing ? 4 : 7;
            const entryGap = compactSpacing ? 2 : 4;

            const bodyFontSize = resume.rendering.layout.bodyFontSizePt ?? 9.2;
            const lineHeight = resume.rendering.layout.lineHeight ?? 1.13;
            const letterSpacing = resume.rendering.layout.letterSpacingPt ?? 0;

            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: topMargin, bottom: bottomMargin, left: leftMargin, right: rightMargin },
                tagged: resume.rendering.output.tagged,
                pdfVersion: '1.7',
                lang: resume.document?.language ?? 'en',
                info: {
                    Title: resume.profile.fullName,
                    Author: resume.profile.fullName,
                },
                autoFirstPage: true,
                bufferPages: true,
            });

            if (resume.rendering.output.tagged) {
                const rootStruct = doc.struct('Document');
                doc.addStructure(rootStruct);
            }

            const chunks: Buffer[] = [];
            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', async () => {
                const pdf = Buffer.concat(chunks);
                try {
                    const loadedPdf = await PdfLibDocument.load(pdf, { updateMetadata: false });
                    const pageCount = loadedPdf.getPageCount();
                    const totalHeightPt =
                        (pageCount - 1) * (pageHeight - topMargin - bottomMargin) + (doc.y - topMargin);
                    const contentHeightMm = Math.round(ptToMm(totalHeightPt) * 10) / 10;
                    resolve({
                        pdf,
                        pageCount,
                        contentHeightMm,
                        horizontalOverflow: false,
                    });
                } catch (error) {
                    reject(error);
                }
            });
            doc.on('error', reject);

            const getLineGap = (fontSize: number) => {
                doc.fontSize(fontSize).font('Helvetica');
                const defaultLineHeight = doc.currentLineHeight(true);
                return fontSize * lineHeight - defaultLineHeight;
            };

            const bodyLineGap = getLineGap(bodyFontSize);

            function checkPageBreak(neededHeight: number) {
                if (doc.y + neededHeight > maxContentY) {
                    doc.addPage();
                    doc.y = topMargin;
                    return true;
                }
                return false;
            }

            // --- Header ---
            const fullName = resume.profile.fullName.toUpperCase();
            doc.fontSize(resume.rendering.typography.name.fontSize).font('Helvetica-Bold').fillColor(bodyColor);
            doc.text(fullName, leftMargin, topMargin + 6.2, { width: usableWidth, align: 'center' });

            if (resume.profile.headline) {
                doc.y += 1;
                doc.fontSize(resume.rendering.typography.headline.fontSize)
                    .font('Helvetica-Bold')
                    .fillColor(primaryColor);
                doc.text(resume.profile.headline, leftMargin, doc.y, { width: usableWidth, align: 'center' });
            }

            const contact = resume.profile.contact;
            if (contact) {
                doc.y += 2;
                // Divider rule
                doc.moveTo(leftMargin, doc.y)
                    .lineTo(leftMargin + usableWidth, doc.y)
                    .lineWidth(0.65)
                    .stroke(primaryColor);
                doc.y += 2.5;

                const parts = [contact.phone, contact.email, contact.location?.display].filter((p): p is string =>
                    Boolean(p),
                );
                const visibleLinks = (contact.links ?? []).filter((l) => l.visible !== false);

                const items: { text: string; isLink: boolean; url?: string }[] = [
                    ...parts.map((p) => ({ text: p, isLink: false })),
                    ...visibleLinks.map((l) => ({ text: l.label, isLink: true, url: l.url })),
                ];

                doc.fontSize(resume.rendering.typography.contact.fontSize).font('Helvetica').fillColor(bodyColor);

                const totalText = items.map((it) => it.text).join(' | ');
                const fullWidth = doc.widthOfString(totalText);
                const startX = Math.max(leftMargin, leftMargin + (usableWidth - fullWidth) / 2);
                let currentX = startX;
                const contactY = doc.y;

                items.forEach((it, idx) => {
                    const text = it.text;
                    const width = doc.widthOfString(text);
                    if (it.isLink && it.url) {
                        doc.fillColor(primaryColor).text(text, currentX, contactY, {
                            width,
                            link: it.url,
                            underline: true,
                            lineBreak: false,
                        });
                    } else {
                        doc.fillColor(bodyColor).text(text, currentX, contactY, {
                            width,
                            lineBreak: false,
                        });
                    }
                    currentX += width;
                    if (idx < items.length - 1) {
                        const sep = ' | ';
                        const sepWidth = doc.widthOfString(sep);
                        doc.fillColor(bodyColor).text(sep, currentX, contactY, {
                            width: sepWidth,
                            lineBreak: false,
                        });
                        currentX += sepWidth;
                    }
                });

                doc.y = contactY + resume.rendering.typography.contact.fontSize * lineHeight + 1;
            }

            // --- Sections ---
            const visibleSections = resume.sections.filter((s) => s.visible !== false);
            for (const section of visibleSections) {
                checkPageBreak(30);
                doc.y += sectionGap;

                // Section Heading
                doc.fontSize(resume.rendering.typography.sectionHeading.fontSize)
                    .font('Helvetica-Bold')
                    .fillColor(primaryColor);
                const headingY = doc.y;
                doc.text(section.title.toUpperCase(), leftMargin, headingY, { width: usableWidth });
                const lineY = doc.y + 1;
                doc.moveTo(leftMargin, lineY)
                    .lineTo(leftMargin + usableWidth, lineY)
                    .lineWidth(0.55)
                    .stroke(primaryColor);
                doc.y = lineY + 2.5;

                renderSectionContent(section);
            }

            function renderSectionContent(section: ResumeSection) {
                switch (section.type) {
                    case 'summary': {
                        checkPageBreak(20);
                        doc.fontSize(bodyFontSize).font('Helvetica').fillColor(bodyColor);
                        doc.text(section.content ?? '', leftMargin, doc.y, {
                            width: usableWidth,
                            lineGap: bodyLineGap,
                            characterSpacing: letterSpacing,
                        });
                        break;
                    }
                    case 'skill_groups': {
                        if (section.style === 'bullets') {
                            const allValues = section.items.flatMap((g) => g.values);
                            const cols = section.columns ?? 3;
                            const colWidth = usableWidth / cols;
                            doc.fontSize(bodyFontSize).font('Helvetica').fillColor(bodyColor);
                            const rowHeight = bodyFontSize * lineHeight + 2;

                            for (let i = 0; i < allValues.length; i += cols) {
                                checkPageBreak(rowHeight);
                                const rowY = doc.y;
                                for (let c = 0; c < cols; c++) {
                                    const valIdx = i + c;
                                    if (valIdx < allValues.length) {
                                        const val = allValues[valIdx];
                                        const colX = leftMargin + c * colWidth;
                                        doc.text('•', colX, rowY, { width: 10, lineBreak: false });
                                        doc.text(val, colX + 10, rowY, {
                                            width: colWidth - 12,
                                            lineBreak: false,
                                        });
                                    }
                                }
                                doc.y = rowY + rowHeight;
                            }
                        } else {
                            for (const group of section.items) {
                                checkPageBreak(12);
                                doc.fontSize(bodyFontSize).fillColor(bodyColor);
                                const label = group.label ? `${group.label}: ` : '';
                                const values = group.values.join(', ');

                                doc.font('Helvetica-Bold').text(label, leftMargin, doc.y, { continued: true });
                                doc.font('Helvetica').text(values, {
                                    lineGap: bodyLineGap,
                                    characterSpacing: letterSpacing,
                                });
                            }
                        }
                        break;
                    }
                    case 'experience': {
                        for (let idx = 0; idx < section.items.length; idx++) {
                            const item = section.items[idx];
                            if (idx > 0) doc.y += entryGap;
                            checkPageBreak(25);

                            renderEntryRow(item.role, item.dateDisplay, false);

                            const meta = [item.organization, item.location].filter(Boolean).join(', ');
                            if (meta) {
                                doc.fontSize(resume.rendering.typography.companyAndEducationScore.fontSize)
                                    .font('Helvetica-Oblique')
                                    .fillColor(primaryColor);
                                doc.text(meta, leftMargin, doc.y, { width: usableWidth });
                            }

                            renderBullets(item.bullets);
                        }
                        break;
                    }
                    case 'projects': {
                        for (let idx = 0; idx < section.items.length; idx++) {
                            const item = section.items[idx];
                            if (idx > 0) doc.y += entryGap;
                            checkPageBreak(25);

                            renderProjectHeader(item.name, item.links, item.dateDisplay);

                            renderBullets(item.bullets);

                            if (item.technologies?.length) {
                                checkPageBreak(12);
                                doc.fontSize(bodyFontSize).fillColor(bodyColor);
                                const prefix = 'Tech/Tools Used: ';
                                doc.font('Helvetica-Bold').text(prefix, leftMargin, doc.y, { continued: true });
                                doc.font('Helvetica').text(item.technologies.join(', '), {
                                    lineGap: bodyLineGap,
                                    characterSpacing: letterSpacing,
                                });
                            }
                        }
                        break;
                    }
                    case 'education': {
                        for (let idx = 0; idx < section.items.length; idx++) {
                            const item = section.items[idx];
                            if (idx > 0) doc.y += entryGap;
                            checkPageBreak(20);

                            renderEntryRow(item.qualification, item.dateDisplay, true);

                            const meta = [item.institution, item.location].filter(Boolean).join(', ');
                            if (meta) {
                                doc.fontSize(resume.rendering.typography.companyAndEducationScore.fontSize)
                                    .font('Helvetica-Oblique')
                                    .fillColor(primaryColor);
                                doc.text(meta, leftMargin, doc.y, { width: usableWidth });
                            }

                            if (item.score?.visible !== false && item.score?.label && item.score?.value) {
                                doc.fontSize(resume.rendering.typography.companyAndEducationScore.fontSize)
                                    .font('Helvetica-Oblique')
                                    .fillColor(primaryColor);
                                doc.text(`${item.score.label}: ${item.score.value}`, leftMargin, doc.y, {
                                    width: usableWidth,
                                });
                            }
                        }
                        break;
                    }
                    case 'certifications': {
                        for (let idx = 0; idx < section.items.length; idx++) {
                            const item = section.items[idx];
                            if (idx > 0) doc.y += entryGap;
                            checkPageBreak(20);

                            const date = item.dateDisplay ?? (item.year ? String(item.year) : undefined);
                            renderCertHeader(item.name, item.url, date);

                            const meta = [item.issuer, item.durationDisplay].filter(Boolean).join(' | ');
                            if (meta) {
                                doc.fontSize(resume.rendering.typography.companyAndEducationScore.fontSize)
                                    .font('Helvetica-Oblique')
                                    .fillColor(primaryColor);
                                doc.text(meta, leftMargin, doc.y, { width: usableWidth });
                            }
                        }
                        break;
                    }
                    case 'bullet_list': {
                        renderBullets(section.items);
                        break;
                    }
                }
            }

            function renderEntryRow(title: string, date: string | null | undefined, isEducation: boolean) {
                const y = doc.y;
                const dateFont = isEducation ? 'Helvetica-Bold' : 'Helvetica-Bold';
                doc.fontSize(resume.rendering.typography.date.fontSize).font(dateFont);
                const dateWidth = date ? doc.widthOfString(date) : 0;
                const leftWidth = usableWidth - (date ? dateWidth + 8 : 0);

                doc.fontSize(resume.rendering.typography.entryTitle.fontSize)
                    .font('Helvetica-Bold')
                    .fillColor(bodyColor);
                doc.text(title ?? '', leftMargin, y, { width: leftWidth });
                const endY = doc.y;

                if (date) {
                    doc.fontSize(resume.rendering.typography.date.fontSize).font(dateFont).fillColor(bodyColor);
                    doc.text(date, leftMargin + usableWidth - dateWidth, y, { width: dateWidth, align: 'right' });
                }
                doc.y = Math.max(endY, y + resume.rendering.typography.entryTitle.fontSize * 1.15);
            }

            function renderProjectHeader(
                name: string,
                links: { label: string; url: string }[] | undefined,
                date: string | null | undefined,
            ) {
                const y = doc.y;
                doc.fontSize(resume.rendering.typography.date.fontSize).font('Helvetica-Bold');
                const dateWidth = date ? doc.widthOfString(date) : 0;
                const leftWidth = usableWidth - (date ? dateWidth + 8 : 0);

                doc.fontSize(resume.rendering.typography.entryTitle.fontSize)
                    .font('Helvetica-Bold')
                    .fillColor(bodyColor);

                if (!links || links.length === 0) {
                    doc.text(name ?? '', leftMargin, y, { width: leftWidth });
                } else {
                    doc.text(name ?? '', leftMargin, y, { continued: true, width: leftWidth });
                    for (const link of links) {
                        doc.font('Helvetica-Bold')
                            .fillColor(bodyColor)
                            .text(' | ', { continued: true, underline: false, link: null as unknown as string });
                        doc.fillColor(primaryColor).text(link.label, {
                            continued: true,
                            underline: true,
                            link: link.url,
                        });
                    }
                    doc.text('', { continued: false });
                }
                const endY = doc.y;

                if (date) {
                    doc.fontSize(resume.rendering.typography.date.fontSize).font('Helvetica-Bold').fillColor(bodyColor);
                    doc.text(date, leftMargin + usableWidth - dateWidth, y, { width: dateWidth, align: 'right' });
                }
                doc.y = Math.max(endY, y + resume.rendering.typography.entryTitle.fontSize * 1.15);
            }

            function renderCertHeader(name: string, url: string | null | undefined, date: string | null | undefined) {
                const y = doc.y;
                doc.fontSize(resume.rendering.typography.date.fontSize).font('Helvetica-Bold');
                const dateWidth = date ? doc.widthOfString(date) : 0;
                const leftWidth = usableWidth - (date ? dateWidth + 8 : 0);

                doc.fontSize(resume.rendering.typography.entryTitle.fontSize).font('Helvetica-Bold');
                if (url) {
                    doc.fillColor(primaryColor).text(name ?? '', leftMargin, y, {
                        width: leftWidth,
                        link: url,
                        underline: true,
                    });
                } else {
                    doc.fillColor(bodyColor).text(name ?? '', leftMargin, y, { width: leftWidth });
                }
                const endY = doc.y;

                if (date) {
                    doc.fontSize(resume.rendering.typography.date.fontSize).font('Helvetica-Bold').fillColor(bodyColor);
                    doc.text(date, leftMargin + usableWidth - dateWidth, y, { width: dateWidth, align: 'right' });
                }
                doc.y = Math.max(endY, y + resume.rendering.typography.entryTitle.fontSize * 1.15);
            }

            function renderBullets(bullets: string[] | undefined) {
                if (!bullets || bullets.length === 0) return;
                const bulletIndent = 10;
                doc.fontSize(bodyFontSize).font('Helvetica').fillColor(bodyColor);

                for (const b of bullets) {
                    const text = typeof b === 'string' ? b : '';
                    const lines = text.split('\n');
                    for (const line of lines) {
                        checkPageBreak(bodyFontSize * 2);
                        const startY = doc.y;
                        doc.text('•', leftMargin, startY, { width: bulletIndent, lineBreak: false });
                        doc.text(line, leftMargin + bulletIndent, startY, {
                            width: usableWidth - bulletIndent,
                            lineGap: bodyLineGap,
                            characterSpacing: letterSpacing,
                        });
                    }
                }
            }

            doc.end();
        });
    }
}
