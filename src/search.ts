import type { Card_List, Card_List_State } from "./card_list";

export const SEARCH_CARD_LIST_ID = 1;

export class Search {
    readonly list: Card_List;

    constructor(list: Card_List) {
        this.list = list;
    }

    async set(state: Card_List_State, execute_query?: boolean) {
        await this.list.set(state, execute_query);
    }

    async preload(query_string: string) {
        await this.list.preload(query_string);
    }
};
