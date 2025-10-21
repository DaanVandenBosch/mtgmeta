import { create_el } from './core.ts';
import { Data } from './data.ts';

export type Result_Nav = {
    start_idx: number,
    max_cards: number,
};

export class Result_Set_View {
    private readonly data: Data;
    private readonly result: number[];
    private readonly nav: Result_Nav;
    readonly el: HTMLElement = create_el('div');
    readonly cards_el: HTMLElement = create_el('div');

    constructor(data: Data, result: number[], nav: Result_Nav) {
        this.data = data;
        this.result = result;
        this.nav = nav;

        this.el.className = 'result';
        this.el.tabIndex = -1;
        this.cards_el.className = 'cards';
        this.cards_el.tabIndex = -1;
        this.el.append(this.cards_el);
    }

    update() {
        const card_idxs =
            this.result.slice(this.nav.start_idx, this.nav.start_idx + this.nav.max_cards);

        const frag = document.createDocumentFragment();

        for (const card_idx of card_idxs) {
            const div = create_el('div');
            div.className = 'card_wrapper';

            if (this.data.get<boolean>(card_idx, 'landscape') === true) {
                div.classList.add('landscape');
            }

            const a: HTMLAnchorElement = create_el('a');
            a.className = 'card';
            a.href = this.data.scryfall_url(card_idx) ?? '';
            a.target = '_blank';
            a.rel = 'noreferrer';
            div.append(a);

            const img: HTMLImageElement = create_el('img');
            img.loading = 'lazy';
            img.src = this.data.image_url(card_idx) ?? '';
            a.append(img);

            frag.append(div);
        }

        this.cards_el.innerHTML = '';
        this.cards_el.scroll(0, 0);
        this.cards_el.append(frag);
    }
}
