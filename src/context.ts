import { Console_Logger } from "./core";
import { Cards } from "./cards";
import { Deps } from "./deps";
import { Subset_Store } from "./subset";

export class Context {
    readonly logger = Console_Logger;
    readonly cards = new Cards;
    readonly subset_store = new Subset_Store(this.logger);
    readonly deps = new Deps(this.logger);
}
