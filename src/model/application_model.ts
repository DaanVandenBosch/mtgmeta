import { Query_Result_Model } from "./query_result_model";
import type { Context } from "../context";
import { Search_Model } from "./search_model";
import { DEPENDENCY_SYMBOL, type Dependency } from "../deps";
import { Subset_Model } from "./subset_model";

type Main_Screen = 'search' | 'query_result';

export const MAIN_SCREENS: Main_Screen[] = ['search', 'query_result'];

export class Application_Model implements Dependency {
    [DEPENDENCY_SYMBOL]: true = true;
    private ctx: Context;
    private _active: Main_Screen = 'search';
    readonly search: Search_Model | null;
    private _query_result: Query_Result_Model | null = null;

    constructor(ctx: Context) {
        this.ctx = ctx;
        this.search = new Search_Model(new Query_Result_Model(ctx));
    }

    get active(): Main_Screen {
        return this._active;
    }

    get query_result(): Query_Result_Model | null {
        return this._query_result;
    }

    create_subset(): void {
        const subset = new Subset_Model(this.ctx, crypto.randomUUID());

        if (this._query_result === null) {
            this._query_result = new Query_Result_Model(this.ctx, subset);
        } else {
            this._query_result.set({ subset });
        }

        this._active = 'query_result';
        this.ctx.deps.changed(this);
    }
}
