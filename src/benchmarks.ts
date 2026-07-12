import { assert_eq, Console_Logger, Nop_Logger, time_to_string } from "./core";
import { PROPS, type Query } from "./query";
import * as query_parsing from "./query_parsing";
import { Query_Evaluator } from "./query_eval";
import type { Cards } from "./cards";
import { Subset_Store } from "./subset";
import { query_hash } from "./query_hash";
import { query_test_definitions } from "./tests";
import { Query_Engine } from "./query/engine";
import type { Indices } from "./query/indices";

const WARM_UP_ITERATIONS = 100;
const ITERATIONS = 1000;
const RUN_LEGACY_BENCHMARKS = false;

type Benchmark<T, R> = {
    name: string,
    set_up: () => T,
    execute: (input: T) => R,
}

type Benchmark_Results = { [name: string]: Benchmark_Result };
type Benchmark_Result = { min_time: number, max_time: number, avg_time: number };

export async function run_benchmarks(cards: Cards, indices: Indices) {
    const subset_store = new Subset_Store(Console_Logger);
    const benchmarks: Benchmark<any, number>[] = [];
    const async_benchmarks: Benchmark<any, Promise<number>>[] = [];

    function benchmark<T>(name: string, set_up: () => T, execute: (input: T) => number) {
        benchmarks.push({ name, set_up, execute, });
    }

    function benchmark_async<T>(
        name: string,
        set_up: () => T,
        execute: (input: T) => Promise<number>,
    ) {
        async_benchmarks.push({ name, set_up, execute });
    }

    function parse_query(q: string): Query {
        return query_parsing.parse_query(subset_store.name_to_subset, q);
    }

    const set_query =
        parse_query('year>=2000 date>=2003-07-29 date<2014-07-18 rarity:uncommon type:creature');

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
                set_query,
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

    benchmark_async(
        '1000x query_hash',
        () => [
            '(t:bird cmc>5 or m:{x}{u}{g} o:draw) r>=u',
            '(t:artifact or t:dinosaur) fo:"enters with" id<=wurg f:vintage -f:pauper',
        ].map(parse_query),
        async (qs) => {
            const len = qs.length;
            let result = 0n;

            for (let i = 0; i < 1000; i++) {
                result += await query_hash(qs[i % len]);
            }

            return Number(result);
        },
    );

    if (RUN_LEGACY_BENCHMARKS) {
        query_evaluator_benchmark('Array_Set', false, false);
        query_evaluator_benchmark('Bitset', true, false);
        query_evaluator_benchmark('Array_Set small set optimization', false, true);
        query_evaluator_benchmark('Bitset small set optimization', true, true);
    }

    for (const def of query_test_definitions) {
        if (def.bench === false) {
            continue;
        }

        if (RUN_LEGACY_BENCHMARKS) {
            benchmark(
                `${def.desc} [${def.query}]`,
                () => new Query_Evaluator(
                    cards,
                    subset_store,
                    parse_query(def.query),
                    true,
                    true,
                ),
                evaluator => {
                    const len = cards.length!;
                    let result = 0;

                    for (let card_idx = 0; card_idx < len; card_idx++) {
                        const version_idx = evaluator.evaluate(card_idx, Nop_Logger).first_or_null();
                        result = (result + (version_idx ?? 0)) | 0;
                    }

                    return result;
                },
            );
        } else {
            benchmark(
                `${def.desc} [${def.query}]`,
                () => ({
                    query: parse_query(def.query),
                    engine: new Query_Engine(cards, indices, subset_store),
                }),
                ({ query, engine }) => engine.execute(Nop_Logger, () => Nop_Logger, query).size,
            );
        }
    }

    Console_Logger.info('Running benchmarks.');

    // Load all data in advance.
    await Promise.all(PROPS.map(p => cards.load(p)));

    const prev_results_str = localStorage.getItem('benchmarks');
    const prev_results: Benchmark_Results =
        prev_results_str === null ? {} : JSON.parse(prev_results_str);
    const results: Benchmark_Results = {};

    execute_benchmarks(benchmarks, prev_results, results);
    await execute_async_benchmarks(async_benchmarks, prev_results, results);

    if (confirm('Store results?')) {
        localStorage.setItem('benchmarks', JSON.stringify(results));
    }

    Console_Logger.info('Finished running benchmarks.');
}

function execute_benchmarks(
    benchmarks: Benchmark<any, number>[],
    prev_results: Benchmark_Results,
    results: Benchmark_Results,
) {
    // We use this total result value to avoid the JIT compiler from completely optimizing code
    // away.
    let total_result = 0;

    for (const benchmark of benchmarks) {
        Console_Logger.group(`Running benchmark "${benchmark.name}".`);

        const input = benchmark.set_up();

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

        const total_time = performance.now() - start;
        log_and_store_results(
            benchmark.name,
            total_time,
            min_time,
            max_time,
            prev_results,
            results,
        );
        Console_Logger.group_end();
    }

    (globalThis as any).result_ignore = total_result;
}

async function execute_async_benchmarks(
    benchmarks: Benchmark<any, Promise<number>>[],
    prev_results: Benchmark_Results,
    results: Benchmark_Results,
) {
    // We use this total result value to avoid the JIT compiler from completely optimizing code
    // away.
    let total_result = 0;

    for (const benchmark of benchmarks) {
        Console_Logger.group(`Running benchmark "${benchmark.name}".`);

        const input = benchmark.set_up();

        for (let i = 0; i < WARM_UP_ITERATIONS; i++) {
            const result = await benchmark.execute(input);
            total_result = (total_result + result) & 0xFFFFFFFF;
        }

        const start = performance.now();
        let min_time = Number.MAX_SAFE_INTEGER;
        let max_time = -1;

        for (let i = 0; i < ITERATIONS; i++) {
            const iter_start = performance.now();

            const result = await benchmark.execute(input);

            const iter_time = performance.now() - iter_start;
            total_result = (total_result + result) & 0xFFFFFFFF;

            if (iter_time < min_time) {
                min_time = iter_time;
            }

            if (iter_time > max_time) {
                max_time = iter_time;
            }
        }

        const total_time = performance.now() - start;
        log_and_store_results(
            benchmark.name,
            total_time,
            min_time,
            max_time,
            prev_results,
            results,
        );
        Console_Logger.group_end();
    }

    (globalThis as any).result_ignore = total_result;
}

function log_and_store_results(
    name: string,
    total_time: number,
    min_time: number,
    max_time: number,
    prev_results: Benchmark_Results,
    results: Benchmark_Results,
) {
    assert_eq(results[name], undefined);

    const time_str = time_to_string(total_time);
    const avg_time = total_time / ITERATIONS;

    Console_Logger.log(
        `${ITERATIONS} iterations took ${time_str}, min. ${min_time}ms, max. ${max_time}ms, avg. ${avg_time}ms.`,
    );

    const prev = prev_results[name];

    if (prev) {
        Console_Logger.log(
            `    Previous benchmark run took min. ${prev.min_time}ms, max. ${prev.max_time}ms, avg. ${prev.avg_time}ms.`,
        );

        if (avg_time > 1.2 * prev.avg_time) {
            Console_Logger.error(`Average worse: ${prev.avg_time}ms -> ${avg_time}ms`);
        }

        if (min_time > 1.2 * prev.min_time) {
            Console_Logger.error(`Minimum worse: ${prev.min_time}ms -> ${min_time}ms`);
        }

        if (max_time > 2 * prev.max_time) {
            Console_Logger.error(`Maximum worse: ${prev.max_time}ms -> ${max_time}ms`);
        }
    }

    results[name] = { min_time, max_time, avg_time };
}
