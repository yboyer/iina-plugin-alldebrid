import { createReleaseConfig } from '@yboyer/semantic-release-config'

export default createReleaseConfig({
  npm: { npmPublish: false },
  prepareCmd: `node scripts/release.mjs \${nextRelease.version} && npm run pack`,
  gitAssets: ['package.json', 'package-lock.json', 'Info.json'],
  github: { assets: ['dist/alldebrid.iinaplgz'] },
})
