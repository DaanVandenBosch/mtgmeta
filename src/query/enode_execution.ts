import type { Cards } from "../cards";
import { unreachable, type Logger } from "../core";
import { MANA_GENERIC, type Mana_Cost } from "../query";
import { Bitset, Bitset_32, type Uint_Set } from "../uint_set";
import { Comparison_Operator, Enode_Type, type Enode, type Enode_Comparison, type Enode_Conjunction, type Enode_Disjunction, type Enode_Mana_Cost, type Enode_Mana_Cost_Number, type Enode_Substring, type Enode_Substring_Per_face } from "./enode";

export class Enode_Executor {
    private readonly cards: Cards;

    constructor(cards: Cards) {
        this.cards = cards;
    }

    execute_for_card(
        get_logger: (card_idx: number) => Logger,
        node: Enode,
        card_idx: number,
        execution_result: Map<number, number>,
    ) {
        const logger = get_logger(card_idx);

        // TODO: Optimize version count.
        const version_count = this.cards.version_count(card_idx) ?? 1;

        if (logger.should_log) {
            const name = this.cards.name(card_idx);
            logger.group('executing node tree for:', name, card_idx, 'versions:', version_count);
        }

        // TODO: Check if instantiating set once outside of the loop is faster.
        const versions =
            version_count <= 32
                ? Bitset_32.with_cap(version_count)
                : Bitset.with_cap(version_count);
        versions.fill();

        this.execute_node(logger, node, card_idx, versions);

        const version_idx = versions.first_or_null();

        if (version_idx !== null) {
            execution_result.set(card_idx, version_idx);
        }

        logger.group_end();
    }

    private execute_node(logger: Logger, node: Enode, card_idx: number, versions: Uint_Set): void {
        if (logger.should_log) {
            logger.group(Enode_Type[node.type], node);
        }

        switch (node.type) {
            case Enode_Type.Disjunction:
                this.execute_node_disjunction(logger, node, card_idx, versions);
                break;
            case Enode_Type.Conjunction:
                this.execute_node_conjunction(logger, node, card_idx, versions);
                break;
            case Enode_Type.Comparison:
                this.execute_node_comparison(node, card_idx, versions);
                break;
            case Enode_Type.Mana_Cost:
                this.execute_node_mana_cost(logger, node, card_idx, versions);
                break;
            case Enode_Type.Mana_Cost_Number:
                this.execute_node_mana_cost_number(node, card_idx, versions);
                break;
            case Enode_Type.Substring:
                this.execute_node_substring(node, card_idx, versions);
                break;
            case Enode_Type.Substring_Per_face:
                this.execute_node_substring_per_face(node, card_idx, versions);
                break;
            default:
                unreachable();
        }

        if (logger.should_log) {
            logger.log('result:', versions.to_array());
            logger.group_end();
        }
    }

    private execute_node_disjunction(
        logger: Logger,
        node: Enode_Disjunction,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const orig_versions = versions.copy();
        // TODO: Don't make a copy, create a new Uint_Set for child_versions.
        const child_versions = orig_versions.copy();
        versions.clear();

        for (const child of node.children) {
            orig_versions.copy_into(child_versions);
            this.execute_node(logger, child, card_idx, child_versions);
            versions.union(child_versions);

            if (versions.size === orig_versions.size) {
                return;
            }
        }
    }

    private execute_node_conjunction(
        logger: Logger,
        node: Enode_Conjunction,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        for (const child of node.children) {
            this.execute_node(logger, child, card_idx, versions);

            if (versions.size === 0) {
                return;
            }
        }
    }

    private execute_node_comparison(
        node: Enode_Comparison,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const value_or_values = node.card_values[card_idx] as any;
        const condition_value = node.condition.value;

        if (node.values_are_arrays) {
            const values = value_or_values as ReadonlyArray<any>;
            // We return true as soon as a value is found for which the comparison function returns
            // true, except when the condition is of type "ne".
            const sentinel = node.operator !== Comparison_Operator.NE;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                let result: boolean;

                switch (node.operator) {
                    case Comparison_Operator.EQ:
                        result = value === condition_value;
                        break;
                    case Comparison_Operator.NE:
                        result = value !== condition_value;
                        break;
                    case Comparison_Operator.LT:
                        result = value < condition_value;
                        break;
                    case Comparison_Operator.GT:
                        result = value > condition_value;
                        break;
                    case Comparison_Operator.LE:
                        result = value <= condition_value;
                        break;
                    case Comparison_Operator.GE:
                        result = value >= condition_value;
                        break;
                    default:
                        unreachable();
                }

                if (result === sentinel) {
                    if (!sentinel) {
                        versions.clear();
                    }

                    return;
                }
            }

            if (sentinel) {
                versions.clear();
            }
        } else {
            const value = value_or_values;
            let result: boolean;

            switch (node.operator) {
                case Comparison_Operator.EQ:
                    result = value === condition_value;
                    break;
                case Comparison_Operator.NE:
                    result = value !== condition_value;
                    break;
                case Comparison_Operator.LT:
                    result = value < condition_value;
                    break;
                case Comparison_Operator.GT:
                    result = value > condition_value;
                    break;
                case Comparison_Operator.LE:
                    result = value <= condition_value;
                    break;
                case Comparison_Operator.GE:
                    result = value >= condition_value;
                    break;
                default:
                    unreachable();
            }

            if (!result) {
                versions.clear();
            }
        }
    }

    private execute_node_mana_cost(
        logger: Logger,
        node: Enode_Mana_Cost,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const condition_value = node.condition.value;
        const value_or_values = node.card_values[card_idx];

        if (node.per_face) {
            const values = value_or_values as ReadonlyArray<Mana_Cost | null>;
            // We return true as soon as a value is found for which the comparison function returns
            // true, except when the condition is of type "ne".
            const sentinel = node.operator !== Comparison_Operator.NE;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                let result: boolean;

                switch (node.operator) {
                    case Comparison_Operator.EQ:
                        result = mana_cost_eq(value, condition_value, logger);
                        break;
                    case Comparison_Operator.NE:
                        result = !mana_cost_eq(value, condition_value, logger);
                        break;
                    case Comparison_Operator.LT:
                        result = mana_cost_is_super_set(condition_value, value, true, logger);
                        break;
                    case Comparison_Operator.GT:
                        result = mana_cost_is_super_set(value, condition_value, true, logger);
                        break;
                    case Comparison_Operator.LE:
                        result = mana_cost_is_super_set(condition_value, value, false, logger);
                        break;
                    case Comparison_Operator.GE:
                        result = mana_cost_is_super_set(value, condition_value, false, logger);
                        break;
                    default:
                        unreachable();
                }

                if (result === sentinel) {
                    if (!sentinel) {
                        versions.clear();
                    }

                    return;
                }
            }

            if (sentinel) {
                versions.clear();
            }
        } else {
            const value = value_or_values as Mana_Cost;
            let result: boolean;

            switch (node.operator) {
                case Comparison_Operator.EQ:
                    result = mana_cost_eq(value, condition_value, logger);
                    break;
                case Comparison_Operator.NE:
                    result = !mana_cost_eq(value, condition_value, logger);
                    break;
                case Comparison_Operator.LT:
                    result = mana_cost_is_super_set(condition_value, value, true, logger);
                    break;
                case Comparison_Operator.GT:
                    result = mana_cost_is_super_set(value, condition_value, true, logger);
                    break;
                case Comparison_Operator.LE:
                    result = mana_cost_is_super_set(condition_value, value, false, logger);
                    break;
                case Comparison_Operator.GE:
                    result = mana_cost_is_super_set(value, condition_value, false, logger);
                    break;
                default:
                    unreachable();
            }

            if (!result) {
                versions.clear();
            }
        }
    }

    private execute_node_mana_cost_number(
        node: Enode_Mana_Cost_Number,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const condition_value: number = node.condition.value;
        const value_or_values = node.card_values[card_idx];

        if (node.per_face) {
            const values = value_or_values as ReadonlyArray<Mana_Cost | null>;
            // We return true as soon as a value is found for which the comparison function returns
            // true, except when the condition is of type "ne".
            const sentinel = node.operator !== Comparison_Operator.NE;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                const len: number = Object.keys(value).length;
                let result: boolean;

                switch (node.operator) {
                    case Comparison_Operator.EQ:
                        result = len === condition_value;
                        break;
                    case Comparison_Operator.NE:
                        result = len !== condition_value;
                        break;
                    case Comparison_Operator.LT:
                        result = len < condition_value;
                        break;
                    case Comparison_Operator.GT:
                        result = len > condition_value;
                        break;
                    case Comparison_Operator.LE:
                        result = len <= condition_value;
                        break;
                    case Comparison_Operator.GE:
                        result = len >= condition_value;
                        break;
                    default:
                        unreachable();
                }

                if (result === sentinel) {
                    if (!sentinel) {
                        versions.clear();
                    }

                    return;
                }
            }

            if (sentinel) {
                versions.clear();
            }
        } else {
            const len: number = Object.keys(value_or_values).length;
            let result: boolean;

            switch (node.operator) {
                case Comparison_Operator.EQ:
                    result = len === condition_value;
                    break;
                case Comparison_Operator.NE:
                    result = len !== condition_value;
                    break;
                case Comparison_Operator.LT:
                    result = len < condition_value;
                    break;
                case Comparison_Operator.GT:
                    result = len > condition_value;
                    break;
                case Comparison_Operator.LE:
                    result = len <= condition_value;
                    break;
                case Comparison_Operator.GE:
                    result = len >= condition_value;
                    break;
                default:
                    unreachable();
            }

            if (!result) {
                versions.clear();
            }
        }
    }

    private execute_node_substring(
        node: Enode_Substring,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        if (!node.card_values[card_idx].includes(node.condition.value)) {
            versions.clear();
        }
    }

    private execute_node_substring_per_face(
        node: Enode_Substring_Per_face,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const condition_value = node.condition.value;

        for (const value of node.card_values[card_idx]) {
            if (value.includes(condition_value)) {
                return;
            }
        }

        versions.clear();
    }
}

function mana_cost_eq(a: Mana_Cost, b: Mana_Cost, logger: Logger): boolean {
    if (Object.keys(a).length !== Object.keys(b).length) {
        return false;
    }

    for (const [symbol, b_count] of Object.entries(b)) {
        const a_count = a[symbol];

        if (a_count !== b_count) {
            if (a_count === undefined) {
                logger.log('No symbol', symbol, 'in a:', a, 'b:', b);
            } else {
                logger.log('Symbol', symbol, 'value', a_count, '!==', b_count, 'a:', a, 'b:', b);
            }

            return false;
        }
    }

    return true;
}

/** Returns true if a is a super set of b. */
function mana_cost_is_super_set(
    a: Mana_Cost,
    b: Mana_Cost,
    strict: boolean,
    logger: Logger,
): boolean {
    let a_symbols = Object.keys(a).length;
    const b_symbols = Object.keys(b).length;

    if (a_symbols < b_symbols) {
        logger.log('a has fewer symbols than b.', a, b);
        return false;
    }

    let a_total = 0;
    let b_total = 0;

    for (const [symbol, b_count] of Object.entries(b)) {
        const a_count = a[symbol] ?? 0;

        if (a_count < b_count) {
            logger.log('Symbol', symbol, 'value', a_count, '<', b_count, 'a:', a, 'b:', b);
            return false;
        }

        a_total += a_count;
        b_total += b_count;
    }

    if (!strict) {
        return true;
    }

    if (a_total > b_total) {
        return true;
    }

    // If b is exactly zero cost, pretend a has a generic zero cost too. This makes queries like
    // mana<{R} return 0 cost cards.
    if (b[MANA_GENERIC] === 0 && b_symbols === 1 && !(MANA_GENERIC in a)) {
        a_symbols += 1;
    }

    if (a_symbols > b_symbols) {
        return true;
    } else {
        logger.log("a doesn't have more symbols than b.", a, b);
        return false;
    }
}
