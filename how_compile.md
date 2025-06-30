# Run as admin
npm run build
npm run dist 
# Release
GH_TOKEN=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 npx electron-builder --win --publish always
