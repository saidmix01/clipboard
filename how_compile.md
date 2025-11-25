# Run as admin
npm run build
npm run dist 
# Release
GH_TOKEN=<tu_token_github> npx electron-builder --win --publish always
