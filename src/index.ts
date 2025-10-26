import { run_benchmarks } from "./benchmarks";
import { Console_Logger, get_params } from "./core";
import { run_test_suite } from "./tests";
import { Context } from "./data";
import { Main_View } from "./main_view";

async function init() {
    Console_Logger.time('init');
    const ctx = new Context(Console_Logger);

    const data_load_promise =
        ctx.view.search === null ? Promise.resolve() : ctx.view.search.list.set_from_params();

    // Initialize view right after setting state from parameters, but before awaiting the initial
    // data load.
    new Main_View(ctx, document.body);

    globalThis.onpopstate = () => {
        if (ctx.view.search) {
            ctx.view.search.list.set_from_params();
        }
    };

    await data_load_promise;

    Console_Logger.time_end('init');

    // Run tests and benchmarks if requested.
    const params = get_params();
    const tests_param_str = params.get('tests');
    const tests_param =
        tests_param_str === null
            ? null
            : tests_param_str.toLocaleLowerCase('en') === 'true';
    const benchmarks_param_str = params.get('benchmarks');
    const benchmarks_param =
        benchmarks_param_str === null
            ? null
            : benchmarks_param_str.toLocaleLowerCase('en') === 'true';

    // Run tests when hostname is localhost or an IPv4 address or explicit parameter is passed.
    const is_dev_host =
        globalThis.location.hostname === 'localhost'
        || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/g.test(globalThis.location.hostname);

    if (tests_param === true || (is_dev_host && tests_param === null)) {
        await run_test_suite(ctx.cards);
    }

    if (benchmarks_param === true) {
        await run_benchmarks(ctx.cards);
    }
}

if (document.body) {
    init();
} else {
    globalThis.addEventListener('DOMContentLoaded', init);
}
