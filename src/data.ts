import { type Logger } from "./core";
import { Cards } from "./cards";
import { Deps } from "./deps";
import { Card_List, type Card_List_State } from "./card_list";

const SEARCH_CARD_LIST_ID = 1;

export class Context {
    readonly logger: Logger;
    readonly cards = new Cards;
    readonly view: {
        active: 'search' | 'card_list',
        search: Search_State | null,
        card_list: Card_List | null,
    } = {
            active: 'search',
            search: null,
            card_list: null,
        };
    readonly deps = new Deps;

    constructor(logger: Logger) {
        this.logger = logger;
        this.view.search = new Search_State(new Card_List(this, SEARCH_CARD_LIST_ID));
    }
};

export class Search_State {
    readonly list: Card_List;

    constructor(list: Card_List) {
        this.list = list;
    }

    async set(state: Card_List_State) {
        const promise = this.list.set(state);
        this.list.set_params();
        await promise;
    }

    async preload(query_string: string) {
        await this.list.preload(query_string);
    }
};
