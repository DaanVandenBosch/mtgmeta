import { create_el, unreachable, key_combo } from "./core";
import type { Dependent } from "./deps";
import type { Card_List } from "./card_list";
import type { Context } from "./context";

export class Card_List_View implements Dependent {
    private ctx: Context;
    private list: Card_List;
    private move_focus_up: (() => void) | null;
    private loading_el: HTMLElement;
    private cards_el: HTMLElement;
    readonly el: HTMLElement;

    constructor(ctx: Context, list: Card_List, move_focus_up?: () => void, el?: HTMLDivElement) {
        this.ctx = ctx;
        this.list = list;
        this.move_focus_up = move_focus_up ?? null;
        ctx.deps.add(this, list);

        this.el = el ?? create_el('div');
        this.el.className = 'result';
        this.el.tabIndex = -1;
        this.loading_el = el?.querySelector(':scope > .cards_loading') ?? create_el('div');
        this.loading_el.className = 'cards_loading';
        this.loading_el.innerText = 'Loading...';
        this.cards_el = el?.querySelector(':scope > .cards') ?? create_el('div');
        this.cards_el.className = 'cards';
        this.cards_el.tabIndex = -1;

        this.el.onkeydown = e => this.keydown(e);

        this.update();
        this.el.append(this.loading_el, this.cards_el);
    }

    dispose() {
        this.ctx.deps.remove_all(this);
        this.el.remove();
    }

    update() {
        const had_focus = this.el.contains(document.activeElement);
        const loading =
            this.list.loading_state === 'initial' || this.list.loading_state === 'first_load';

        this.loading_el.hidden = !loading;
        this.cards_el.hidden = loading;

        if (!loading) {
            const cards = this.ctx.cards;
            const frag = document.createDocumentFragment();

            for (const card_index of this.list.card_indexes) {
                const div = create_el('div');
                div.className = 'card_wrapper';

                if (cards.get<boolean>(card_index, 'landscape') === true) {
                    div.classList.add('landscape');
                }

                const a: HTMLAnchorElement = create_el('a');
                a.className = 'card';
                a.href = cards.scryfall_url(card_index) ?? '';
                a.target = '_blank';
                a.rel = 'noreferrer';
                div.append(a);

                const img: HTMLImageElement = create_el('img');
                img.loading = 'lazy';
                img.src = cards.image_url(card_index) ?? '';
                a.append(img);

                frag.append(div);
            }

            this.cards_el.replaceChildren(frag);
            this.el.scrollTo(0, 0);

            if (had_focus) {
                this.focus();
            }
        }
    }

    focus() {
        this.move_card_focus('down');
    }

    private keydown(e: KeyboardEvent) {
        switch (key_combo(e)) {
            case 'Home': {
                e.preventDefault();
                e.stopPropagation();
                const new_card_el = this.cards_el.children[0].children[0] as HTMLElement;
                new_card_el.scrollIntoView({ block: 'nearest' });
                new_card_el.focus();
                break;
            }
            case 'End': {
                e.preventDefault();
                e.stopPropagation();
                const new_card_el =
                    this.cards_el
                        .children[this.cards_el.children.length - 1]
                        .children[0] as HTMLElement;
                new_card_el.scrollIntoView({ block: 'nearest' });
                new_card_el.focus();
                break;
            }
            case 'ArrowDown': {
                e.preventDefault();
                e.stopPropagation();
                this.move_card_focus('down');
                break;
            }
            case 'ArrowUp': {
                e.preventDefault();
                e.stopPropagation();
                this.move_card_focus('up');
                break;
            }
            case 'ArrowLeft': {
                e.preventDefault();
                e.stopPropagation();
                this.move_card_focus('left');
                break;
            }
            case 'ArrowRight': {
                e.preventDefault();
                e.stopPropagation();
                this.move_card_focus('right');
                break;
            }
            case 'p': {
                e.preventDefault();
                e.stopPropagation();
                this.list.set({ pos: this.list.prev_page });
                break;
            }
            case 'n': {
                e.preventDefault();
                e.stopPropagation();
                this.list.set({ pos: this.list.next_page });
                break;
            }
        }
    }

    private move_card_focus(dir: 'up' | 'down' | 'left' | 'right') {
        const children = this.cards_el.children;
        const len = children.length;
        const card_el = document.activeElement as HTMLElement | null;
        const old_idx = Array.prototype.indexOf.call(children, card_el?.parentElement);
        let new_card_el: HTMLElement;

        if (card_el === null || old_idx === -1) {
            switch (dir) {
                case 'up': {
                    new_card_el = children[children.length - 1].children[0] as HTMLElement;
                    break;
                }
                case 'down': {
                    new_card_el = children[0].children[0] as HTMLElement;
                    break;
                }
                case 'left':
                case 'right': {
                    return;
                }
                default:
                    unreachable(`Unknown direction "${dir}".`);
            }
        } else {
            outer: switch (dir) {
                case 'up': {
                    for (let i = old_idx - 1; i >= 0; i--) {
                        const prev_card_el = children[i].children[0] as HTMLElement;

                        if (prev_card_el.offsetTop + prev_card_el.offsetHeight < card_el.offsetTop
                            && prev_card_el.offsetLeft < card_el.offsetLeft + card_el.offsetWidth) {
                            new_card_el = prev_card_el;
                            break outer;
                        }
                    }

                    if (this.move_focus_up) {
                        this.move_focus_up();
                    }

                    return;
                }
                case 'down': {
                    for (let i = old_idx + 1; i < len; i++) {
                        const next_card_el = children[i].children[0] as HTMLElement;

                        if (next_card_el.offsetTop > card_el.offsetTop + card_el.offsetHeight
                            && next_card_el.offsetLeft + next_card_el.offsetWidth > card_el.offsetLeft) {
                            new_card_el = next_card_el;
                            break outer;
                        }
                    }

                    // Go to the end of the last row if we're at the next to last row even if that
                    // would mean we would move to the left. This way you'll see all the cards by
                    // pressing down continuously.
                    if (old_idx + 1 < len) {
                        const next_card_el = children[len - 1].children[0] as HTMLElement;

                        if (next_card_el.offsetTop > card_el.offsetTop + card_el.offsetHeight) {
                            new_card_el = next_card_el;
                            break outer;
                        }
                    }

                    return;
                }
                case 'left': {
                    if (old_idx > 0) {
                        new_card_el = children[old_idx - 1].children[0] as HTMLElement;
                        break outer;
                    }

                    return;
                }
                case 'right': {
                    if (old_idx + 1 < len) {
                        new_card_el = children[old_idx + 1].children[0] as HTMLElement;
                        break outer;
                    }

                    return;
                }
                default:
                    unreachable(`Unknown direction "${dir}".`);
            }
        }

        new_card_el.scrollIntoView({ block: 'nearest' });
        new_card_el.focus();
    }
}
