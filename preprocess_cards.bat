@echo off

deno run^
    --allow-net^
    --allow-read^
    --allow-write^
    --v8-flags=--max-old-space-size=8000^
    .\preprocess_cards.js
