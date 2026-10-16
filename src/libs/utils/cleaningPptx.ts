import PptxGenJS from 'pptxgenjs';
import { CleaningPair } from '../types/cleaning';

interface CleaningDeckInput {
    branchName: string;
    placeName: string;
    dateText: string;
    pairs: CleaningPair[];
    getImage: (fileId: string) => Promise<string>;   // "image/jpeg;base64,..." data for pptxgenjs
}

// 16:9 deck: title slide, then one slide per before/after pair
export async function buildCleaningPptx(input: CleaningDeckInput): Promise<Buffer> {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in

    const title = pptx.addSlide();
    title.addText(input.branchName, { x: 0.5, y: 2.0, w: 12.33, h: 1, fontSize: 40, bold: true, align: 'center' });
    title.addText(`${input.placeName} tozalash — shu hafta uchun`, { x: 0.5, y: 3.4, w: 12.33, h: 0.8, fontSize: 28, align: 'center' });
    title.addText(input.dateText, { x: 0.5, y: 4.5, w: 12.33, h: 0.6, fontSize: 18, color: '666666', align: 'center' });

    for (const pair of input.pairs) {
        const slide = pptx.addSlide();
        const [before, after] = await Promise.all([input.getImage(pair.beforeFileId), input.getImage(pair.afterFileId)]);
        const columns = [
            { x: 0.5, label: 'Tozalashdan oldin', data: before },
            { x: 6.93, label: 'Tozalashdan keyin', data: after },
        ];
        for (const c of columns) {
            slide.addText(c.label, { x: c.x, y: 0.3, w: 5.9, h: 0.6, fontSize: 22, bold: true, align: 'center' });
            slide.addImage({ data: c.data, x: c.x, y: 1.0, w: 5.9, h: 5.6, sizing: { type: 'contain', w: 5.9, h: 5.6 } });
        }
        slide.addText(`Yukladi: ${pair.memberName}`, { x: 8.33, y: 6.85, w: 4.5, h: 0.4, fontSize: 14, color: '444444', align: 'right' });
    }

    return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}
