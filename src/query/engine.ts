import type { Cards } from '../cards';
import { assert, unreachable, type Logger } from '../core';
import type { Query } from '../query';
import { Enode_Constructor } from './enode_construction';
import { Enode_Executor } from './enode_execution';

export class Query_Engine {
    private readonly cards: Cards;
    private readonly enode_constructor: Enode_Constructor;
    private readonly executor: Enode_Executor;

    constructor(cards: Cards) {
        this.cards = cards;
        this.enode_constructor = new Enode_Constructor(cards);
        this.executor = new Enode_Executor(cards);
    }

    execute(
        logger: Logger,
        exec_logger: (card_idx: number) => Logger,
        query: Query,
    ): ReadonlyMap<number, number> {
        logger.log('query:', query);
        logger.time('full execution');

        this.enode_constructor.rebuild_indices(logger);

        logger.group('enode construction');
        logger.time('enode construction');

        const enode_result = this.enode_constructor.construct_execution_tree(query, logger);
        logger.log('enode construction result:', enode_result);

        logger.time_end('enode construction');
        logger.group_end();

        logger.group('enode execution');
        logger.time('enode execution');

        const enode = enode_result.node;

        let result: Map<number, number>;

        if (enode === null) {
            // No further work to do, return the construction results directly.
            if (enode_result.all) {
                result = this.all_cards();
            } else {
                result = new Map<number, number>;

                for (const card_idx of enode_result.cards) {
                    // TODO: Set actual version.
                    result.set(card_idx, 0);
                }
            }
        } else {
            // Execute the query execution tree on the subset of cards returned by the construction
            // phase.
            const executor = this.executor;
            result = new Map<number, number>;

            if (enode_result.all) {
                const len = this.cards.length ?? unreachable();

                for (let card_idx = 0; card_idx < len; card_idx++) {
                    executor.execute_for_card(exec_logger, enode, card_idx, result);
                }
            } else {
                for (const card_idx of enode_result.cards) {
                    executor.execute_for_card(exec_logger, enode, card_idx, result);
                }
            }
        }

        logger.time_end('enode execution');
        logger.group_end();
        logger.time_end('full execution');
        return result;
    }

    // TODO: Cache this until data changes.
    private all_cards(): Map<number, number> {
        assert(this.cards.length !== null);

        const set = new Map<number, number>;

        for (let i = 0, len = this.cards.length; i < len; i++) {
            // TODO: Set actual version.
            set.set(i, 0);
        }

        return set;
    }
}
