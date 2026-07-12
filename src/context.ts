import { Console_Logger } from "./core";
import { Cards } from "./cards";
import { Deps } from "./deps";
import { Subset_Store } from "./subset";
import { Query_Executor } from "./query_executor";
import { Indices } from "./query/indices";

export class Context {
    readonly logger = Console_Logger;
    readonly cards = new Cards;
    readonly indices = new Indices(this.cards);
    readonly subset_store = new Subset_Store(this.logger);
    readonly query_executor = new Query_Executor(this.logger, this.cards, this.subset_store);
    readonly deps = new Deps(this.logger);
}
