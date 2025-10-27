import { Card_List } from "./card_list";
import type { Context } from "./context";
import { Search, SEARCH_CARD_LIST_ID } from "./search";

export class Application {
    readonly active: 'search' | 'card_list' = 'search';
    readonly search: Search | null;
    readonly card_list: Card_List | null = null;

    constructor(ctx: Context) {
        this.search = new Search(
            new Card_List(ctx, SEARCH_CARD_LIST_ID)
        );
    }
}
