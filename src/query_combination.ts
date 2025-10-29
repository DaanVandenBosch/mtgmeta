import { assert } from "./core";
import {
    type Query,
    type Prop,
    type Condition,
    type Subset,
    TRUE_CONDITION,
    FALSE_CONDITION,
} from "./query";
const freeze = Object.freeze;

export function combine_queries_with_conjunction(
    id_to_subset: ReadonlyMap<string, Subset>,
    ...queries: Query[]
): Query {
    assert(queries.length >= 1);

    if (queries.length === 1) {
        return queries[0];
    }

    const props = new Set<Prop>();
    const conditions = Array<Condition>();

    for (const query of queries) {
        for (const prop of query.props) {
            props.add(prop);
        }

        conditions.push(query.condition);
    }

    return simplify_query(
        id_to_subset,
        freeze({
            props: freeze([...props]),
            condition: freeze({
                type: 'and',
                conditions: freeze(conditions),
            })
        }),
    );
}

/** Reduces amount of condition nesting. */
export function simplify_query(id_to_subset: ReadonlyMap<string, Subset>, query: Query): Query {
    return new Query_Simplifier().simplify(id_to_subset, query);
}

class Query_Simplifier {
    private id_to_subset!: ReadonlyMap<string, Subset>;
    private props!: Set<Prop>;

    simplify(id_to_subset: ReadonlyMap<string, Subset>, query: Query): Query {
        this.id_to_subset = id_to_subset;
        this.props = new Set(query.props);

        const condition = this.simplify_condition(query.condition);

        return freeze({
            props: freeze([...this.props]),
            condition,
        })
    }

    private simplify_condition(condition: Condition): Condition {
        switch (condition.type) {
            case 'not': {
                const nested_cond = this.simplify_condition(condition.condition);

                switch (nested_cond.type) {
                    case 'not':
                        return nested_cond.condition;

                    case 'true':
                        return FALSE_CONDITION;

                    case 'false':
                        return TRUE_CONDITION;

                    case 'eq':
                        return freeze({
                            type: 'ne',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        });

                    case 'ne':
                        return freeze({
                            type: 'eq',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        });

                    case 'lt':
                        return freeze({
                            type: 'ge',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        });

                    case 'le':
                        return freeze({
                            type: 'gt',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        });

                    case 'gt':
                        return freeze({
                            type: 'le',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        });

                    case 'ge':
                        return freeze({
                            type: 'lt',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        });

                    case 'even':
                        return freeze({
                            type: 'odd',
                            prop: nested_cond.prop,
                        });

                    case 'odd':
                        return freeze({
                            type: 'even',
                            prop: nested_cond.prop,
                        });

                    default:
                        return condition;
                }
            }

            case 'or': {
                const conditions: Condition[] = [];

                for (const input_nested_cond of condition.conditions) {
                    const nested_cond = this.simplify_condition(input_nested_cond);

                    switch (nested_cond.type) {
                        case 'true':
                            // Entire disjunction is true.
                            return TRUE_CONDITION;
                        case 'false':
                            // Has no effect on disjunction.
                            continue;
                        case 'or':
                            conditions.push(...nested_cond.conditions);
                            break;
                        default:
                            conditions.push(nested_cond);
                            break;
                    }
                }

                if (conditions.length === 0) {
                    // All were false.
                    return FALSE_CONDITION;
                }

                if (conditions.length === 1) {
                    return conditions[0];
                }

                return freeze({
                    type: 'or',
                    conditions: freeze(conditions),
                });
            }

            case 'and': {
                const conditions: Condition[] = [];

                for (const input_nested_cond of condition.conditions) {
                    const nested_cond = this.simplify_condition(input_nested_cond);

                    switch (nested_cond.type) {
                        case 'true':
                            // Has no effect on conjunction.
                            continue;
                        case 'false':
                            // Entire conjunction is false.
                            return FALSE_CONDITION;
                        case 'and':
                            conditions.push(...nested_cond.conditions);
                            break;
                        default:
                            conditions.push(nested_cond);
                            break;
                    }
                }

                if (conditions.length === 0) {
                    // All were true.
                    return TRUE_CONDITION;
                }

                if (conditions.length === 1) {
                    return conditions[0];
                }

                return freeze({
                    type: 'and',
                    conditions: freeze(conditions),
                });
            }

            case 'subset':
                const subset = this.id_to_subset.get(condition.id);
                assert(subset !== undefined);

                for (const prop of subset.query.props) {
                    this.props.add(prop);
                }

                return condition;

            case 'true':
            case 'false':
                return condition;

            case 'eq':
            case 'ne':
            case 'lt':
            case 'le':
            case 'gt':
            case 'ge':
            case 'substring':
            case 'even':
            case 'odd':
            case 'range': {
                this.props.add(condition.prop);
                return condition;
            }
        }
    }
}
