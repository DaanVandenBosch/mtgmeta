import { readdir, rmdir } from "node:fs/promises";

console.log('Preprocessing data.');

if (await readdir('data').then(() => true, () => false)) {
    await rmdir('data', { recursive: true });
}

if (await readdir('out').then(() => true, () => false)) {
    await rmdir('out', { recursive: true });
}

await import('./preprocess_data');

console.log('Compiling code.');

await Bun.build({
    entrypoints: ["src/index.ts"],
    outdir: 'out',
    minify: true,
});

console.log('Copying data.');

for (const file of await readdir('src', { recursive: true })) {
    if (file.endsWith('.ts')) {
        continue;
    }

    await Bun.write(`out/${file}`, Bun.file(`src/${file}`), { createPath: true });
}

for (const file of await readdir('data', { recursive: true })) {
    await Bun.write(`out/data/${file}`, Bun.file(`data/${file}`), { createPath: true });
}
