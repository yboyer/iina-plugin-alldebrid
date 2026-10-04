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
module.exports = { videos };
