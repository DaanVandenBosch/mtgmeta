import type { Context } from "../context";
import { create_el, get_el, key_combo, unreachable } from "../core";
import { MAIN_SCREENS, type Application_Model } from "../model/application_model";
import { Search_View } from "./search_view";
import { Query_Result_View } from "./query_result_view";
import { LEAF_DEPENDENT_SYMBOL, type Dependency, type Leaf_Dependent } from "../deps";
import type { View } from "./view";

export class Application_View implements View, Leaf_Dependent {
    [LEAF_DEPENDENT_SYMBOL]: true = true;
    private readonly ctx: Context;
    private readonly app: Application_Model;
    private readonly show_extra_left_el: HTMLElement;
    private readonly menu_el: HTMLElement;
    private readonly search_inputs_el: HTMLElement;
    private readonly search_navigation_el: HTMLElement;
    private readonly search_result_el: HTMLDivElement;
    private search_view: Search_View | null = null;
    private query_result_view: Query_Result_View | null = null;
    private readonly el: HTMLElement;

    constructor(ctx: Context, app: Application_Model, el: HTMLElement) {
        this.ctx = ctx;
        this.app = app;
        this.el = el;
        ctx.deps.add(this, app);

        const header_top_el = get_el(el, ':scope > header > .header_top');
        const header_bottom_el = get_el(el, ':scope > header > .header_bottom');

        this.show_extra_left_el = get_el(header_top_el, ':scope > .filter_show_extra_left');
        this.show_extra_left_el.onmousedown = () => this.show_extra_left_mousedown();

        this.menu_el = create_el('div');
        this.menu_el.className = 'menu';
        this.menu_el.hidden = true;
        const menu_section_el = create_el('div');
        const menu_section_header_el = create_el('h2');
        const add_subset_el = create_el('button');
        add_subset_el.innerText = 'Add';
        add_subset_el.onclick = () => this.add_subset_click();
        menu_section_header_el.append('Subsets ', add_subset_el);
        menu_section_el.append('Experimental stuff', menu_section_header_el);
        this.menu_el.append(menu_section_el);
        header_top_el.append(this.menu_el);

        this.search_inputs_el = get_el(header_top_el, ':scope > .filter_container');
        this.search_navigation_el = get_el(header_bottom_el, ':scope > .result_nav');
        this.search_result_el = get_el(el, ':scope > .result');

        el.ondragover = e => this.dragover(e);
        el.onclick = e => this.click(e);
        el.onkeydown = e => this.keydown(e);

        if (this.app.active !== 'search') {
            this.search_inputs_el.hidden = true;
            this.search_navigation_el.hidden = true;
            this.search_result_el.hidden = true;
        }

        this.update();
    }

    get hidden(): boolean {
        return this.el.hidden;
    }

    set hidden(hidden: boolean) {
        this.el.hidden = hidden;
    }

    invalidated(_dependency: Dependency): void { }

    update(): void {
        switch (this.app.active) {
            case 'search': {
                if (this.app.search) {
                    if (this.search_view === null) {
                        this.search_view = new Search_View(
                            this.ctx,
                            this.app.search,
                            this.search_inputs_el,
                            this.search_navigation_el,
                            this.search_result_el,
                        );
                    }
                }

                break;
            }

            case 'query_result': {
                if (this.app.query_result) {
                    if (this.query_result_view == null) {
                        this.query_result_view = new Query_Result_View(
                            this.ctx,
                            this.app.query_result,
                        );
                        this.el.append(this.query_result_view.el);
                    }
                }

                break;
            }

            default: {
                unreachable();
            }
        }

        for (const screen of MAIN_SCREENS) {
            let view: View | null;

            switch (screen) {
                case 'search':
                    view = this.search_view;
                    break;
                case 'query_result':
                    view = this.query_result_view;
                    break;
                default:
                    unreachable();
            }

            if (view) {
                view.hidden = screen !== this.app.active;
            }
        }
    }

    private dragover(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();

        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'none';
        }
    }

    private click(e: PointerEvent): void {
        if (e.target !== this.show_extra_left_el
            && (e.target as Element).parentElement !== this.show_extra_left_el
        ) {
            this.menu_el.hidden = true;
        }
    }

    private keydown(e: KeyboardEvent): void {
        switch (key_combo(e)) {
            case 'Escape':
                this.menu_el.hidden = !this.menu_el.hidden;
                break;
        }
    }

    private show_extra_left_mousedown(): void {
        this.menu_el.hidden = !this.menu_el.hidden;
    }

    private add_subset_click(): void {
        this.app.create_subset();
    }
}
