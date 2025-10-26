import { create_el } from './core';
import { Cards } from './data';

export type Result_Nav = {
    start_idx: number,
    max_cards: number,
};

export class Result_Set_View {
    private readonly cards: Cards;
    private readonly result: number[];
    private readonly nav: Result_Nav;
    readonly el: HTMLElement;
    readonly cards_el: HTMLElement = create_el('div');

    constructor(cards: Cards, result: number[], nav: Result_Nav, el: HTMLElement) {
        this.cards = cards;
        this.result = result;
        this.nav = nav;

        this.el = el;
        this.el.className = 'result';
        this.el.tabIndex = -1;
        this.cards_el.className = 'cards';
        this.cards_el.tabIndex = -1;
    }

    update() {
        const card_idxs =
            this.result.slice(this.nav.start_idx, this.nav.start_idx + this.nav.max_cards);

        const frag = document.createDocumentFragment();

        for (const card_idx of card_idxs) {
            const div = create_el('div');
            div.className = 'card_wrapper';

            if (this.cards.get<boolean>(card_idx, 'landscape') === true) {
                div.classList.add('landscape');
            }

            const a: HTMLAnchorElement = create_el('a');
            a.className = 'card';
            a.href = this.cards.scryfall_url(card_idx) ?? '';
            a.target = '_blank';
            a.rel = 'noreferrer';
            div.append(a);

            const img: HTMLImageElement = create_el('img');
            img.loading = 'lazy';
            img.src = this.cards.image_url(card_idx) ?? '';
            a.append(img);

            frag.append(div);
        }

        this.cards_el.innerHTML = '';
        this.cards_el.scroll(0, 0);
        this.cards_el.append(frag);
        this.el.replaceChildren(this.cards_el);
    }
}
