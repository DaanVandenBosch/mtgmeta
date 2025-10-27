import type { BunFile } from "bun";

await import('./build');

const server = Bun.serve({
    hostname: 'localhost',
    port: 8000,

    async fetch(req) {
        let path = new URL(req.url).pathname;

        let file: BunFile;
        let headers: { [K: string]: string } = {
            'Content-Encoding': 'gzip',
        };

        if (path === '/') {
            file = Bun.file('out/index.html')
            headers['Content-Type'] = 'text/html';
        } else if (path.startsWith('/data/')) {
            file = Bun.file('out' + path);
        } else {
            if (path.endsWith('.css')) {
                headers['Content-Type'] = 'text/css';
            } else if (path.endsWith('.xml')) {
                headers['Content-Type'] = 'application/xml';
            } else if (path.endsWith('.html')) {
                headers['Content-Type'] = 'text/html';
            } else if (path.endsWith('.js')) {
                headers['Content-Type'] = 'text/javascript; charset=utf-8';
            }

            file = Bun.file('out' + path);
        }

        const compressed_data = Bun.gzipSync(await file.arrayBuffer());

        headers['Content-Length'] = String(compressed_data.byteLength);

        return new Response(compressed_data, { headers });
    },
});

console.log(`Production version running at: http://${server.hostname}:${server.port}/`);
