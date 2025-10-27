import { get_params } from "./core";
import { Application } from "./application";
import { Application_View } from "./application_view";
import { run_test_suite } from "./tests";
import { run_benchmarks } from "./benchmarks";
import { Context } from "./context";

async function init() {
    const ctx = new Context;
    ctx.logger.time('init');

    const app = new Application(ctx);
    new Application_View(ctx, app, document.body);
    await ctx.cards.load_promise;

    ctx.logger.time_end('init');

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
