Bun.serve({
    hostname: '0.0.0.0',
    port: 8000,

    fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/') {
            return new Response(
                Bun.file('src/index.html'),
                {
                    headers: { 'content-type': 'text/html' }
                },
            );
        }

        return new Response(Bun.file('src/' + url.pathname));
    },
});
