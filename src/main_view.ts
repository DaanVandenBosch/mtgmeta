import { unreachable } from "./core";
import type { Context } from "./data";
import { Search_View } from "./search_view";

export class Main_View {
    private ctx: Context;
    private search_view: Search_View | null = null;
    readonly el: HTMLElement;

    constructor(ctx: Context, el: HTMLElement) {
        this.ctx = ctx;
        this.el = el;
        this.update();
    }

    update() {
        switch (this.ctx.view.active) {
            case 'search':
                if (this.ctx.view.search) {
                    if (this.search_view === null) {
                        this.search_view = new Search_View(this.ctx, this.ctx.view.search, this.el);
                    }
                }

                break;
            case 'card_list':
                break;
            default:
                unreachable();
        }
    }
}
