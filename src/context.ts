import { Console_Logger } from "./core";
import { Cards } from "./cards";
import { Deps } from "./deps";
import { Subset_Store } from "./subset";
import { Query_Executor } from "./query/executor";
import { Indices } from "./query/indices";
import { Legacy_Query_Engine } from "./query/legacy";
import { Query_Engine } from "./query/engine";

export class Context {
    readonly logger = Console_Logger;
    readonly cards = new Cards;
    readonly indices = new Indices(this.cards);
    readonly subset_store = new Subset_Store(this.logger);
    readonly query_executor: Query_Executor;
    readonly deps = new Deps(this.logger);

    constructor(legacy: boolean) {
        const engine = legacy
            ? new Legacy_Query_Engine(this.cards, this.subset_store, true, true)
            : new Query_Engine(this.cards, this.indices, this.subset_store);
        this.query_executor = new Query_Executor(this.logger, this.cards, engine);
    }
}
