import { readdir } from "node:fs/promises";

await Bun.build({
    entrypoints: ["src/index.ts"],
    outdir: 'out',
    minify: true,
});

for (const file of await readdir('src', { recursive: true })) {
    if (file.endsWith('.ts')) {
        continue;
    }

    await Bun.write(`out/${file}`, Bun.file(`src/${file}`));
}
