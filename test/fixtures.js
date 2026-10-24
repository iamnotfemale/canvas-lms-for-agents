// Synthetic, public-domain fixture. No school content or credentials.
export function pdfFixture(label = 'Chapter 1: Memory') {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    stream(`BT /F1 16 Tf 20 160 Td (${label}) Tj 0 -30 Td (Encoding and retrieval.) Tj ET`),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    stream('BT /F1 16 Tf 20 160 Td (Chapter 2: Attention) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n', offsets = [0];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
function stream(text) { return `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`; }
export const jsonResponse = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
export function fakeFiles(pdf = pdfFixture()) {
  let downloads = 0, resolves = 0, version = 'v1', allowed = true, body = pdf;
  return {
    get downloads() { return downloads; }, get resolves() { return resolves; },
    set version(v) { version = v; }, set allowed(v) { allowed = v; }, set body(v) { body = v; },
    async resolve(resourceId) { resolves++; if (!allowed) throw Error('revoked'); return { resourceId, version, title: 'Lecture 03.pdf', sourceUrl: 'https://canvas.korea.ac.kr/courses/1/files/3' }; },
    async openDownload() { downloads++; return new Response(body, { headers: { 'content-type': 'application/pdf', 'content-length': String(body.length), etag: 'fixture' } }); },
  };
}
