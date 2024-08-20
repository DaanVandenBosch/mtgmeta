import { readdir } from "node:fs/promises";

const transpiler = new Bun.Transpiler({ loader: 'ts' });

if (!(await readdir('data').then(() => true, () => false))) {
    console.log('No data directory, preprocessing data first.');
    await import('./preprocess_data');
}

Bun.serve({
    hostname: '0.0.0.0',
    port: 8000,

    async fetch(req) {
        const path = new URL(req.url).pathname;

        if (path === '/') {
            return new Response(Bun.file('src/index.html'), {
                headers: { 'Content-Type': 'text/html' }
            });
        }

        if (path.endsWith('.js')) {
            const file_content = await Bun.file('src' + path.slice(0, -2) + 'ts').text();
            return new Response(await transpiler.transform(file_content), {
                headers: { 'Content-Type': 'text/javascript; charset=utf-8' }
            });
        }

        if (path.startsWith('/data/')) {
            return new Response(Bun.file('.' + path));
        } else {
            return new Response(Bun.file('src' + path));
        }
    },
});
