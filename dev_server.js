import { serve } from 'https://deno.land/std@0.140.0/http/server.ts';
import { serveDir } from 'https://deno.land/std@0.140.0/http/file_server.ts';

serve(async req => {
    if (new URL(req.url).pathname === '/') {
        return new Response(
            await Deno.readFile("src/index.html"),
            {
                headers: { 'content-type': 'text/html' }
            },
        );
    }

    return serveDir(req, { fsRoot: 'src' });
});
