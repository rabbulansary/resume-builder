import type { Resume } from './resume.schema.js';

type Typography = Resume['rendering']['typography'];
type TextStyle = Typography[Exclude<keyof Typography, 'unit'>];

function textStyle(style: TextStyle, fontSize: number = style.fontSize): string {
    return [
        `font-size: ${fontSize}pt;`,
        `font-weight: ${style.fontWeight};`,
        'fontStyle' in style ? `font-style: ${style.fontStyle};` : '',
        'colorToken' in style ? 'color: var(--primary);' : '',
        'textTransform' in style ? `text-transform: ${style.textTransform};` : '',
        'textAlign' in style ? `text-align: ${style.textAlign};` : '',
    ]
        .filter(Boolean)
        .join(' ');
}

export function classicAtsStyles({ page, colors, fonts, layout, typography }: Resume['rendering']): string {
    const { top, right, bottom, left } = page.marginMm;
    return `
@page { size: A4 portrait; margin: ${top}mm ${right}mm ${bottom}mm ${left}mm; }
:root {
  --primary: ${colors.primary};
  --section-gap: ${layout.compactSpacing ? 4 : 7}pt;
  --entry-gap: ${layout.compactSpacing ? 2 : 4}pt;
  --heading-font: "${fonts.heading}", "Liberation Sans", sans-serif;
  print-color-adjust: exact;
}
body {
  margin: 0;
  background: ${colors.background};
  color: ${colors.body};
  font-family: "${fonts.body}", "Liberation Sans", sans-serif;
  ${textStyle(typography.body, layout.bodyFontSizePt)}
  line-height: ${layout.lineHeight};
  letter-spacing: ${layout.letterSpacingPt}pt;
  overflow-wrap: anywhere;
}
h1, h2, h3, p, ul { margin: 0; }
p, li { orphans: 2; widows: 2; white-space: pre-wrap; }
.resume-header { text-align: center; break-after: avoid; }
h1 { font-family: var(--heading-font); ${textStyle(typography.name)} }
.headline { font-family: var(--heading-font); ${textStyle(typography.headline)} }
.contact {
  border-top: 0.65pt solid var(--primary);
  margin-top: 2pt;
  padding-top: 2pt;
  ${textStyle(typography.contact)}
}
section { margin-top: var(--section-gap); }
h2 {
  font-family: var(--heading-font);
  ${textStyle(typography.sectionHeading)}
  border-bottom: 0.55pt solid var(--primary);
  margin-bottom: 2pt;
  break-inside: avoid;
  break-after: avoid;
}
article + article { margin-top: var(--entry-gap); }
.entry-heading { break-inside: avoid; break-after: avoid; }
.entry-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(24%, max-content); column-gap: 8pt; align-items: baseline; }
.entry-row > :last-child { max-width: 55mm; }
.entry-row > :only-child { grid-column: 1 / -1; max-width: none; }
h3 { font-family: var(--heading-font); ${textStyle(typography.entryTitle)} }
.metadata { ${textStyle(typography.companyAndEducationScore)} }
.date { ${textStyle(typography.date)} }
.education .date { ${textStyle(typography.educationDate)} }
.date { white-space: pre-wrap; }
ul { padding-inline-start: 12pt; ${textStyle(typography.bullets, layout.bodyFontSizePt)} }
.skill, .skill_groups ul { ${textStyle(typography.skills, layout.bodyFontSizePt)} }
.skill_groups ul[data-columns] {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: 12pt;
}
.skill_groups ul[data-columns="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.skill_groups ul[data-columns="4"] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.skill_groups li { break-inside: avoid; }
a { color: inherit; text-decoration: underline; }
`;
}
