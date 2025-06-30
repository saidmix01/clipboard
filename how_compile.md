# Run as admin
npm run build
npm run dist 
# Release
GH_TOKEN=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 npx electron-builder --win --publish always
