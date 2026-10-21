// Offer a generated file to the player. Inside the claude.ai viewer files go
// through its downloads capability (the viewer confirms each save); a
// standalone page uses an ordinary download link.

let dl = null;
const inViewer = typeof window !== 'undefined' && !!(window.claude && window.claude.use);
if (inViewer)
  window.claude
    .use('downloads')
    .then((d) => (dl = d))
    .catch(() => {});

// returns 'saved' | 'declined' | 'unavailable' | 'error'
export async function saveFile(filename, data) {
  if (dl) {
    try {
      await dl.save({ filename, data });
      return 'saved';
    } catch (e) {
      const code = e && e.code;
      return code === 'declined' ? 'declined' : code === 'rate_limited' ? 'error' : 'unavailable';
    }
  }
  if (inViewer) return 'unavailable';
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'saved';
}
