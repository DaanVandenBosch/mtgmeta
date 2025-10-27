import { Console_Logger } from "./core";
import { Cards } from "./cards";
import { Deps } from "./deps";

export class Context {
    readonly logger = Console_Logger;
    readonly cards = new Cards;
    readonly deps = new Deps;
}
