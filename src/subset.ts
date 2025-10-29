import type { Logger } from "./core";
import { QUERY_NONE, type Query, type Subset } from "./query";
const freeze = Object.freeze;

export class Subset_Store {
    private readonly logger: Logger;
    private readonly _id_to_subset: Map<string, Subset> = new Map;
    private readonly _name_to_subset: Map<string, Subset> = new Map;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    get id_to_subset(): ReadonlyMap<string, Subset> {
        return this._id_to_subset;
    }

    get name_to_subset(): ReadonlyMap<string, Subset> {
        return this._name_to_subset;
    }

    get(id: string): Subset | null {
        return this._id_to_subset.get(id) ?? null;
    }

    get_or_create(id: string): Subset {
        let subset = this._id_to_subset.get(id);

        if (subset === undefined) {
            subset = this.create_internal(id, id, QUERY_NONE);
        }

        return subset;
    }

    create(id: string, name: string, query: Query = QUERY_NONE): Subset | null {
        if (this._id_to_subset.has(id)) {
            this.logger.error(`Subset with ID "${id}" already exists.`);
            return null;
        }

        if (this._name_to_subset.has(name)) {
            this.logger.error(`Subset with name "${name}" already exists.`);
            return null;
        }

        return this.create_internal(id, name, query);
    }

    private create_internal(id: string, name: string, query: Query): Subset {
        const subset = freeze({
            id,
            name,
            query,
        });
        this._id_to_subset.set(subset.id, subset);
        this._name_to_subset.set(subset.name, subset);
        return subset;
    }

    update(subset: Subset) {
        const old = this._id_to_subset.get(subset.id);

        if (old !== undefined) {
            this._name_to_subset.delete(old.name);
        }

        this._id_to_subset.set(subset.id, subset);
        this._name_to_subset.set(subset.name, subset);
    }
}
