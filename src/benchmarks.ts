import { Console_Logger, Nop_Logger, time_to_string } from "./core";
import { PROPS } from "./query";
import { parse_query } from "./query_parsing";
import { Query_Evaluator } from "./query_eval";
import type { Cards } from "./cards";
import { Subset_Store } from "./subset";

export async function run_benchmarks(cards: Cards) {
    const subset_store = new Subset_Store;
    const benchmarks: { name: string, set_up: () => any, execute: (input: any) => number }[] = [];

    function benchmark<T>(name: string, set_up: () => T, execute: (input: T) => number) {
        benchmarks.push({ name, set_up, execute });
    }

    const query = parse_query(
        subset_store.name_to_subset,
        'year>=2000 date>=2003-07-29 date<2014-07-18 rarity:uncommon type:creature',
    );

    function query_evaluator_benchmark(
        name: string,
        bitset: boolean,
        small_set_optimization: boolean,
    ) {
        benchmark(
            name,
            () => new Query_Evaluator(
                cards,
                subset_store,
                query,
                bitset,
                small_set_optimization,
            ),
            evaluator => {
                const len = cards.length!;
                let result = 0;

                for (let card_idx = 0; card_idx < len; card_idx++) {
                    const version_idx = evaluator.evaluate(card_idx, Nop_Logger).first_or_null();
                    result = (result + (version_idx ?? 0)) & 0xFFFFFFFF;
                }

                return result;
            },
        );
    }

    query_evaluator_benchmark('Array_Set', false, false);
    query_evaluator_benchmark('Bitset', true, false);
    query_evaluator_benchmark('Array_Set small set optimization', false, true);
    query_evaluator_benchmark('Bitset small set optimization', true, true);

    Console_Logger.info('Running benchmarks.');

    // Load all data in advance.
    const loads = PROPS.map(p => cards.load(p));

    for (const load of loads) {
        await load;
    }

    const WARM_UP_ITERATIONS = 100;
    const ITERATIONS = 1000;

    for (const benchmark of benchmarks) {
        Console_Logger.group(`Running benchmark "${benchmark.name}".`);

        const input = benchmark.set_up();

        // We use this total result value to avoid the JIT compiler from completely optimizing code
        // away.
        let total_result = 0;

        for (let i = 0; i < WARM_UP_ITERATIONS; i++) {
            const result = benchmark.execute(input);
            total_result = (total_result + result) & 0xFFFFFFFF;
        }

        const start = performance.now();
        let min_time = Number.MAX_SAFE_INTEGER;
        let max_time = -1;

        for (let i = 0; i < ITERATIONS; i++) {
            const iter_start = performance.now();

            const result = benchmark.execute(input);

            const iter_time = performance.now() - iter_start;
            total_result = (total_result + result) & 0xFFFFFFFF;

            if (iter_time < min_time) {
                min_time = iter_time;
            }

            if (iter_time > max_time) {
                max_time = iter_time;
            }
        }

        const time = performance.now() - start;
        const time_str = time_to_string(time);
        const avg_time = time / ITERATIONS;

        Console_Logger.log(
            `${ITERATIONS} Iterations took ${time_str}, min. ${min_time}ms, max. ${max_time}ms, avg. ${avg_time}ms.`,
        );
        Console_Logger.log(`Result (ignore this): ${total_result}`);
        Console_Logger.group_end();
    }

    Console_Logger.info('Finished running benchmarks.');
}
