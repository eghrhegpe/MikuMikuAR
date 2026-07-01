const fs = require('fs');
const b = fs.readFileSync('C:/Users/zhujieling11/Downloads/proc-motion-autodance.vmd');
console.log('SIZE:', b.length);
// Dump bytes 0-100
for (let off = 0; off < Math.min(120, b.length); off += 16) {
    const hex = Array.from(b.slice(off, off + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(b.slice(off, off + 16)).map(x => x >= 0x20 && x < 0x80 ? String.fromCharCode(x) : '.').join('');
    console.log(off.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|');
}
console.log('\nBone count at 50:', b.readUInt32LE(50));
console.log('Morph count area:', b.readUInt32LE(50 + 4 + 168*111));
