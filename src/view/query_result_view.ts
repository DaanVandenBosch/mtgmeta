import { create_el, unreachable, key_combo, string_to_int, assert, index_of } from "../core";
import { LEAF_DEPENDENT_SYMBOL, type Dependency, type Leaf_Dependent } from "../deps";
import type { Query_Result_Model } from "../model/query_result_model";
import type { Context } from "../context";
import type { View } from "./view";

const WRAPPER_CLASS = 'card_wrapper';

export class Query_Result_View implements View, Leaf_Dependent {
    [LEAF_DEPENDENT_SYMBOL]: true = true;
    private ctx: Context;
    private result: Query_Result_Model;
    private move_focus_up: (() => void) | null;
    private loading_el: HTMLElement;
    private cards_el: HTMLElement;
    readonly el: HTMLElement;

    constructor(
        ctx: Context,
        result: Query_Result_Model,
        move_focus_up?: () => void,
        el?: HTMLDivElement,
    ) {
        this.ctx = ctx;
        this.result = result;
        this.move_focus_up = move_focus_up ?? null;
        ctx.deps.add(this, result);

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
        this.el.ondragstart = e => this.dragstart(e);
        this.el.ondragover = e => this.dragover(e);
        this.el.ondrop = e => this.drop(e);

        this.update();
        this.el.append(this.loading_el, this.cards_el);
    }

    get hidden(): boolean {
        return this.el.hidden;
    }

    set hidden(hidden: boolean) {
        this.el.hidden = hidden;
    }

    invalidated(_dependency: Dependency): void { }

    dispose() {
        this.ctx.deps.remove_all(this);
        this.el.remove();
    }

    update() {
        const had_focus = this.el.contains(document.activeElement);
        const loading =
            this.result.loading_state === 'initial' || this.result.loading_state === 'first_load';

        this.loading_el.hidden = !loading;
        this.cards_el.hidden = loading;

        if (!loading) {
            const cards = this.ctx.cards;
            const frag = document.createDocumentFragment();

            for (const card_index of this.result.card_indexes) {
                const wrapper = create_el('div');
                wrapper.className = WRAPPER_CLASS;
                wrapper.draggable = true;
                wrapper.dataset['index'] = String(card_index);

                if (cards.get<boolean>(card_index, 'landscape') === true) {
                    wrapper.classList.add('landscape');
                }

                const a: HTMLAnchorElement = create_el('a');
                a.className = 'card';
                a.href = cards.scryfall_url(card_index) ?? '';
                a.target = '_blank';
                a.rel = 'noreferrer';
                wrapper.append(a);

                const img: HTMLImageElement = create_el('img');
                img.loading = 'lazy';
                img.src = cards.image_url(card_index) ?? '';
                a.append(img);

                frag.append(wrapper);
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
                this.result.set({ pos: this.result.prev_page });
                break;
            }
            case 'n': {
                e.preventDefault();
                e.stopPropagation();
                this.result.set({ pos: this.result.next_page });
                break;
            }
        }
    }

    private move_card_focus(dir: 'up' | 'down' | 'left' | 'right') {
        const children = this.cards_el.children;
        const len = children.length;
        const card_el = document.activeElement as HTMLElement | null;
        const old_idx = index_of(children, card_el?.parentElement);
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

    private dragstart(e: DragEvent) {
        let wrapper = e.target as HTMLElement | null;

        while (!wrapper?.classList.contains(WRAPPER_CLASS)) {
            if (wrapper === null || wrapper === this.el) {
                return;
            }

            wrapper = wrapper.parentElement;
        }

        if (wrapper) {
            const index_str = wrapper.dataset['index'];
            assert(index_str !== undefined);
            const index = string_to_int(index_str);
            assert(index !== null);
            const name = this.ctx.cards.name(index);

            if (name !== null) {
                e.dataTransfer?.setData('text/plain', name);
            }
        }
    }

    private dragover(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();

        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = this.result.subset ? 'copy' : 'none';
        }
    }

    private drop(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();

        if (e.dataTransfer) {
            const name = e.dataTransfer.getData('text/plain');

            if (name.length && this.result.subset) {
                this.result.subset.add(name);
            }
        }
    }
}
