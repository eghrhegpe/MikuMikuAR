const fs = require('fs');
const b = fs.readFileSync('C:/Users/zhujieling11/Downloads/proc-motion-autodance.vmd');
const d = new DataView(b.buffer);
const n = d.getUint32(50, true);
console.log('SIZE:', b.length, 'BONES:', n);
for (let i = 0; i < Math.min(8, n); i++) {
    const off = 54 + i * 111;
    const nb = new Uint8Array(b, off, 15);
    const nm = new TextDecoder('shift-jis').decode(nb).replace(/\0/g, '');
    const frame = d.getUint32(off + 15, true);
    const px = d.getFloat32(off + 19, true);
    const py = d.getFloat32(off + 23, true);
    const pz = d.getFloat32(off + 27, true);
    const rx = d.getFloat32(off + 31, true);
    const ry = d.getFloat32(off + 35, true);
    const rz = d.getFloat32(off + 39, true);
    const rw = d.getFloat32(off + 43, true);
    console.log('#' + i + ' bone="' + nm + '" f=' + frame +
        ' pos=' + px.toFixed(3) + ',' + py.toFixed(3) + ',' + pz.toFixed(3) +
        ' rot=' + rx.toFixed(4) + ',' + ry.toFixed(4) + ',' + rz.toFixed(4) + ',' + rw.toFixed(4));
}
// Check the bone count area
console.log('Bone count at 50:', b.readUInt32LE(50));
console.log('Bone count at 54:', b.readUInt32LE(54));
