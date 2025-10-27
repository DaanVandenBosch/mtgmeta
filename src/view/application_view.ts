import type { Context } from "../context";
import { unreachable } from "../core";
import type { Application } from "../application";
import { Search_View } from "./search_view";

export class Application_View {
    private ctx: Context;
    private app: Application;
    private search_view: Search_View | null = null;
    readonly el: HTMLElement;

    constructor(ctx: Context, app: Application, el: HTMLElement) {
        this.ctx = ctx;
        this.app = app;
        this.el = el;
        this.update();
    }

    update() {
        switch (this.app.active) {
            case 'search':
                if (this.app.search) {
                    if (this.search_view === null) {
                        this.search_view = new Search_View(
                            this.ctx,
                            this.app.search,
                            this.el,
                        );
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
