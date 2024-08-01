const transpiler = new Bun.Transpiler({ loader: 'ts' });

Bun.serve({
    hostname: '0.0.0.0',
    port: 8000,

    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/') {
            return new Response(Bun.file('src/index.html'), {
                headers: { 'Content-Type': 'text/html' }
            });
        }

        if (url.pathname.endsWith('.js')) {
            const file_content = await Bun.file('src/' + url.pathname.slice(0, -2) + 'ts').text();
            return new Response(await transpiler.transform(file_content), {
                headers: { 'Content-Type': 'text/javascript; charset=utf-8' }
            });
        }

        return new Response(Bun.file('src/' + url.pathname));
    },
});
