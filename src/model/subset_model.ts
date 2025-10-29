import type { Context } from "../context";
import { DEPENDENCY_SYMBOL, type Dependency } from "../deps";
import type { Condition, Query, Subset } from "../query";
const freeze = Object.freeze;

export class Subset_Model implements Dependency {
    [DEPENDENCY_SYMBOL]: true = true;
    private ctx: Context;
    private subset: Subset;

    constructor(ctx: Context, id: string) {
        this.ctx = ctx;
        this.subset = ctx.subset_store.get_or_create(id);
    }

    get id(): string {
        return this.subset.id;
    }

    get name(): string {
        return this.subset.name;
    }

    get query(): Query {
        return this.subset.query;
    }

    async add(name: string) {
        const condition = this.subset.query.condition;
        let new_condition: Condition;

        if (condition.type === 'eq') {
            if (condition.value === name) {
                return;
            }

            new_condition = freeze({
                type: 'or',
                conditions: freeze([
                    condition,
                    freeze({ type: 'eq', prop: 'name', value: name }),
                ]),
            });
        } else if (condition.type === 'or') {
            const found = condition.conditions.find(cond => {
                if (cond.type === 'eq') {
                    return cond.value === name;
                } else {
                    this.ctx.logger.error(
                        `Unexpected condition type ${cond.type} inside of ${condition.type} condition.`,
                    );
                    return false;
                }
            });

            if (found) {
                return;
            }

            new_condition = freeze({
                type: 'or',
                conditions: freeze([
                    ...condition.conditions,
                    freeze({ type: 'eq', prop: 'name', value: name }),
                ]),
            });
        } else if (condition.type === 'false') {
            new_condition = freeze({ type: 'eq', prop: 'name', value: name });
        } else {
            this.ctx.logger.error(`Unexpected condition type ${condition.type}.`);

            if (condition.type === 'true') {
                return;
            }

            new_condition = freeze({
                type: 'or',
                conditions: freeze([
                    condition,
                    freeze({ type: 'eq', prop: 'name', value: name }),
                ]),
            });
        }

        const props = new Set(this.subset.query.props);
        props.add('name');

        this.subset = freeze({
            id: this.subset.id,
            name: this.subset.name,
            query: {
                props: freeze([...props]),
                condition: new_condition,
            },
        });
        this.ctx.subset_store.update(this.subset);

        this.ctx.deps.changed(this);
    }
}
