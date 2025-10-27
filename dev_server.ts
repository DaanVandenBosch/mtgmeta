import type { BunFile } from "bun";
import { readdir } from "node:fs/promises";

const transpiler = new Bun.Transpiler({ loader: 'ts' });

try {
    await readdir('data');
} catch {
    console.log('No data directory, preprocessing data first.');
    await import('./preprocess_data');
}

const server = Bun.serve({
    hostname: 'localhost',
    port: 8000,

    async fetch(req) {
        let path = new URL(req.url).pathname;

        let data: string | BunFile;
        let headers: { [K: string]: string } = {
            'Content-Encoding': 'gzip',
        };

        if (path === '/') {
            data = Bun.file('static/index.html')
            headers['Content-Type'] = 'text/html';
        } else if (path.startsWith('/data/')) {
            data = Bun.file('.' + path);
        } else {
            let ts = false;

            if (path.endsWith('.css')) {
                headers['Content-Type'] = 'text/css';
            } else if (path.endsWith('.xml')) {
                headers['Content-Type'] = 'application/xml';
            } else if (path.endsWith('.html')) {
                headers['Content-Type'] = 'text/html';
            } else {
                ts = true;
                headers['Content-Type'] = 'text/javascript; charset=utf-8';

                const dot = path.indexOf('.');

                if (dot !== -1) {
                    path = path.slice(0, dot);
                }
            }

            if (ts) {
                const file_content = await Bun.file('src' + path + '.ts').arrayBuffer();
                data = await transpiler.transform(file_content, 'ts');
            } else {
                data = Bun.file('static' + path);
            }
        }

        const data_buffer: Uint8Array<ArrayBuffer> =
            typeof data === 'string' ? Buffer.from(data) : new Uint8Array(await data.arrayBuffer());
        const compressed_data = Bun.gzipSync(data_buffer);

        headers['Content-Length'] = String(compressed_data.byteLength);

        return new Response(compressed_data, { headers });
    },
});

console.log(`Running at: http://${server.hostname}:${server.port}/`);
