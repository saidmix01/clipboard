# Run as admin
npm run build
npm run dist 
# Release
GH_TOKEN=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 npx electron-builder --win --publish always

setx GH_TOKEN "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"

curl -H "Authorization: Bearer %GH_TOKEN%" https://api.github.com/repos/saidmix01/clipboard/releases


$env:GH_TOKEN="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" npx electron-builder --win --publish always


