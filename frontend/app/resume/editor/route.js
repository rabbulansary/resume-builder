import { editorDocument } from '../../../editors/document.js';

export const dynamic = 'force-static';

export function GET() {
    return editorDocument('resume');
}
