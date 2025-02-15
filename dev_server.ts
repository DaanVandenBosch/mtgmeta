import type { BunFile } from "bun";
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

        let data: string | BunFile;
        let headers: { [K: string]: string } = {
            'Content-Encoding': 'gzip',
        };

        if (path === '/') {
            data = Bun.file('src/index.html')
            headers['Content-Type'] = 'text/html';
        } else if (path.endsWith('.js')) {
            const file_content = await Bun.file('src' + path.slice(0, -2) + 'ts').text();
            data = await transpiler.transform(file_content);
            headers['Content-Type'] = 'text/javascript; charset=utf-8';
        } else if (path.startsWith('/data/')) {
            data = Bun.file('.' + path);
        } else {
            if (path.endsWith('.css')) {
                headers['Content-Type'] = 'text/css';
            } else if (path.endsWith('.xml')) {
                headers['Content-Type'] = 'application/xml';
            } else if (path.endsWith('.html')) {
                headers['Content-Type'] = 'text/html';
            }

            data = Bun.file('src' + path);
        }

        const data_buffer: Uint8Array =
            typeof data === 'string' ? Buffer.from(data) : new Uint8Array(await data.arrayBuffer());
        const compressed_data = Bun.gzipSync(data_buffer);

        headers['Content-Length'] = String(compressed_data.byteLength);

        return new Response(compressed_data, { headers });
    },
});
