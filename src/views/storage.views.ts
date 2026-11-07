import { InlineKeyboard } from 'grammy';
import { Lang, t } from '../libs/i18n';
import { Product } from '../libs/types/product';
import { ProductCategory } from '../libs/enums/product.enum';

export const STORAGE_PAGE_SIZE = 8;
const short = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// admin: the whole catalog, with the add button inside
export function storageListView(lang: Lang, products: Product[], page: number) {
    const pages = Math.max(1, Math.ceil(products.length / STORAGE_PAGE_SIZE));
    const current = Math.min(Math.max(0, page), pages - 1);
    const keyboard = new InlineKeyboard();
    for (const p of products.slice(current * STORAGE_PAGE_SIZE, (current + 1) * STORAGE_PAGE_SIZE)) {
        keyboard.text(`${p.imageFileId || p.imageReference ? '🖼 ' : ''}${short(p.name)}`, `st_p:${p._id.toString()}`).row();
    }
    if (pages > 1) {
        if (current > 0) keyboard.text('◀', `st_l:${current - 1}`);
        keyboard.text(`${current + 1}/${pages}`, 'st_noop');
        if (current < pages - 1) keyboard.text('▶', `st_l:${current + 1}`);
        keyboard.row();
    }
    keyboard.text(t(lang, 'st.add'), 'st_add');
    return { text: `${t(lang, 'st.title', { n: products.length })}${products.length ? '' : `\n\n${t(lang, 'st.empty')}`}`, keyboard };
}

// one product: what it is and the buttons to change each part
export function storageProductView(lang: Lang, product: Product) {
    const id = product._id.toString();
    const none = t(lang, 'st.none');
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'st.btnName'), `st_e:${id}:name`).text(t(lang, 'st.btnCategory'), `st_ec:${id}`).row()
        .text(t(lang, 'st.btnLink'), `st_e:${id}:link`).text(t(lang, 'st.btnNote'), `st_e:${id}:note`).row()
        .text(t(lang, 'st.btnPhoto'), `st_e:${id}:photo`).text(t(lang, 'st.btnArchive'), `st_x:${id}`).row()
        .text(t(lang, 'bs.backShort'), 'st_cl');
    const text = t(lang, 'st.card', {
        name: product.name, category: t(lang, `cat.${product.category}`),
        link: product.orderLink ?? none, note: product.orderNote ?? none,
    });
    return { text, keyboard };
}

export function productCategoryEditView(lang: Lang, productId: string) {
    const keyboard = new InlineKeyboard();
    for (const cat of Object.values(ProductCategory)) keyboard.text(t(lang, `cat.${cat}`), `st_c:${productId}:${cat}`).row();
    keyboard.text(t(lang, 'common.cancel'), `st_pb:${productId}`);
    return { text: t(lang, 'st.pickCategory'), keyboard };
}

export function productArchiveView(lang: Lang, product: Product) {
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'st.confirmArchive'), `st_xy:${product._id.toString()}`)
        .text(t(lang, 'common.cancel'), `st_pb:${product._id.toString()}`);
    return { text: t(lang, 'st.archiveQ', { name: product.name }), keyboard };
}

export function productEditPromptView(lang: Lang, field: 'name' | 'link' | 'note' | 'photo') {
    const keyboard = new InlineKeyboard().text(t(lang, 'common.cancel'), 'st_edcancel');
    return { text: t(lang, `st.ask.${field}`), keyboard };
}
