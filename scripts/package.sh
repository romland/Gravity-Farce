#!/bin/bash
set -e

echo "[+] Building server with esbuild..."
npx esbuild src/server/index.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/index.cjs

echo "[+] Preparing release bundle..."
rm -rf release gf-prod-release.tar.gz
mkdir -p release/src/server release/src/client

# Copy server artifacts and data
cp dist/index.cjs package.json release/
cp -r src/server/data release/src/server/

# Copy client files and socket.io client library
cp -r src/client/* release/src/client/
cp node_modules/socket.io/client-dist/socket.io.min.js release/src/client/

# Safe script reference swap
node -e '
  const fs = require("fs");
  const filePath = "release/src/client/index.html";
  let html = fs.readFileSync(filePath, "utf8");
  html = html.replace("<script src=\"/socket.io/socket.io.js\"></script>", "<script src=\"socket.io.min.js\"></script>");
  fs.writeFileSync(filePath, html);
'

echo "[+] Minifying HTML via html-minifier-terser..."
npx html-minifier-terser release/src/client/index.html \
    -o release/src/client/index.html \
    --collapse-whitespace \
    --remove-comments \
    --minify-js true \
    --minify-css true

echo "[+] Creating production tarball..."
cd release
tar -czf ../gf-prod-release.tar.gz .
cd ..
rm -rf release

echo "✅ Minified release tarball ready: gf-prod-release.tar.gz"
