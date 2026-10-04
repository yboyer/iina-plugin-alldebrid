import assert from 'node:assert/strict'
import test from 'node:test'

import { metadata, videos } from '../src/library.ts'

test('recursive video discovery excludes archives, audio and files without links', () => {
  assert.deepEqual(
    videos([
      {
        n: 'Season',
        e: [
          { n: 'Episode.MKV', s: 42, l: 'https://alldebrid.com/f/a' },
          { n: 'a.zip', l: 'x' },
          { n: 'b.mp3', l: 'x' },
          { n: 'c.mp4' },
        ],
      },
    ]),
    [
      {
        name: 'Episode.MKV',
        path: 'Season/Episode.MKV',
        size: 42,
        link: 'https://alldebrid.com/f/a',
      },
    ]
  )
})
test('filename metadata identifies movies and episodes while preserving unknown titles', () => {
  assert.deepEqual(metadata('Amélie.2001.1080p.MULTI.x265.BluRay.mkv'), {
    year: 2001,
    resolution: '1080P',
    language: 'MULTI',
    codec: 'X265',
    source: 'BLURAY',
    title: 'Amélie',
  })
  assert.deepEqual(metadata('Série.S02E03.720p.VOSTFR.WEB-DL.mp4'), {
    season: 2,
    episode: 3,
    resolution: '720P',
    language: 'VOSTFR',
    source: 'WEB-DL',
    title: 'Série',
  })
  assert.equal(metadata('Show.2x12.mkv').episode, 12)
  assert.equal(metadata('Un titre inconnu.mkv').title, 'Un titre inconnu')
})

test('torrent parser handles season packs, release tags, and local language and codec handlers', () => {
  assert.deepEqual(metadata('Show.Season.2.1080p.NF.WEB-DL.AV1.VFQ.mkv'), {
    season: 2,
    resolution: '1080P',
    language: 'VFQ',
    codec: 'AV1',
    source: 'WEB-DL',
    title: 'Show',
  })
  assert.equal(metadata('Movie.2024.2160p.REMUX.HEVC.mkv').title, 'Movie')
  assert.equal(metadata('Movie.2024.2160p.REMUX.HEVC.mkv').codec, 'H265')
})
