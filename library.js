const VIDEO = /\.(mkv|mp4|m4v|avi|mov|webm|flv|wmv|mpg|mpeg|m2ts|mts|ts|vob|ogv|3gp)$/i;
function videos(files, parent) {
  const result = [];
  for (const file of files || []) {
    const path = parent ? parent + '/' + file.n : file.n;
    if (Array.isArray(file.e)) result.push(...videos(file.e, path));
    else if (VIDEO.test(file.n || '') && typeof file.l === 'string') {
      result.push({ name: file.n, path, size: Number(file.s) || 0, link: file.l });
    }
  }
  return result;
}
// Conservative filename parsing: retain the original name and omit unknown fields.
function metadata(name) {
  const stem = String(name || '').replace(VIDEO, '');
  const value = stem.replace(/[._]+/g, ' ');
  const result = {};
  const patterns = {
    episode: /\bS(\d{1,2})\s*E(\d{1,3})\b|\b(\d{1,2})x(\d{1,3})\b/i,
    year: /\b(?:19|20)\d{2}\b/,
    resolution: /\b(?:2160p|1080p|1080i|720p|480p|4K)\b/i,
    language: /\b(?:MULTI|VOSTFR|TRUEFRENCH|FRENCH|VFQ|VFF|VF|VO|ENGLISH)\b/i,
    codec: /\b(?:x264|x265|h[ .]?264|h[ .]?265|HEVC|AV1|XVID)\b/i,
    source: /\b(?:WEB[ -]?DL|WEBRIP|BLU[ -]?RAY|BDRIP|BRRIP|HDTV|DVDRIP|REMUX)\b/i
  };
  let end = value.length;
  for (const key of Object.keys(patterns)) {
    const match = patterns[key].exec(value);
    if (!match) continue;
    end = Math.min(end, match.index);
    if (key === 'episode') {
      result.season = Number(match[1] || match[3]);
      result.episode = Number(match[2] || match[4]);
    } else result[key] = key === 'year' ? Number(match[0]) : match[0].toUpperCase();
  }
  result.title = value.slice(0, end).replace(/[\s([\-]+$/g, '').trim() || stem;
  return result;
}
module.exports = { videos, metadata };
