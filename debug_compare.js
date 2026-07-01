// 对比：程序化 VMD vs 真实 VMD（斜坐）的字节级差异
const fs = require('fs');
const path = require('path');

const procBuf = fs.readFileSync('C:/Users/zhujieling11/Downloads/proc-motion-autodance.vmd');
const realBuf = fs.readFileSync('C:/Users/zhujieling11/MikuMikuAR/text-model/motion/斜坐_by_raven10086.vmd');

function analyze(buf, label) {
    const d = new DataView(buf.buffer);
    console.log(`\n=== ${label} ===`);
    console.log(`文件大小: ${buf.length} bytes`);
    
    // Header
    const sig = new TextDecoder('shift-jis').decode(new Uint8Array(buf, 0, 30)).replace(/\0/g,'');
    console.log(`签名: "${sig.trim()}"`);
    
    const modelName = new TextDecoder('shift-jis').decode(new Uint8Array(buf, 30, 20)).replace(/\0/g,'');
    console.log(`模型名: "${modelName.trim()}"`);
    
    const boneCount = d.getUint32(50, true);
    console.log(`骨骼帧数: ${boneCount}`);
    
    // 每帧大小推算（从文件总大小反推）
    const afterHeader = 54; // 50 + 4
    const morphSectionStart = afterHeader + boneCount * 47; // 假设 47 字节/帧
    const morphTypeAtGuess = buf[morphSectionStart];
    console.log(`Morph区段(按47字节/帧推测)偏移: ${morphSectionStart}, 类型值: ${morphTypeAtGuess}`);
    
    // 也试 111 字节/帧
    const morphSectionStart111 = afterHeader + boneCount * 111;
    const morphTypeAt111 = buf[morphSectionStart111];
    console.log(`Morph区段(按111字节/帧推测)偏移: ${morphSectionStart111}, 类型值: ${morphTypeAt111}`);
    
    // 前5个骨骼名的原始hex和文本
    console.log('\n前5个骨骼帧:');
    for (let i = 0; i < Math.min(5, boneCount); i++) {
        const off = afterHeader + i * 47; // 用标准47字节
        const nameRaw = new Uint8Array(buf, off, 15);
        const nameHex = Array.from(nameRaw).map(b => b.toString(16).padStart(2, '0')).join(' ');
        const nameText = new TextDecoder('shift-jis').decode(nameRaw).replace(/\0/g,'').trim();
        const frame = d.getUint32(off + 15, true);
        const px = d.getFloat32(off + 19, true);
        const py = d.getFloat32(off + 23, true);
        const pz = d.getFloat32(off + 27, true);
        const rx = d.getFloat32(off + 31, true);
        const ry = d.getFloat32(off + 35, true);
        const rz = d.getFloat32(off + 39, true);
        const rw = d.getFloat32(off + 43, true);
        var posStr = "(" + px.toFixed(4) + "," + py.toFixed(4) + "," + pz.toFixed(4) + ")";
        var rotStr = "(" + rx.toFixed(4) + "," + ry.toFixed(4) + "," + rz.toFixed(4) + "," + rw.toFixed(4) + ")";
        console.log("  [" + i + "] name_hex=[" + nameHex + "] text=\"" + nameText + "\" @f=" + frame);
        console.log("      pos=" + posStr + " rot=" + rotStr);
    }
    
    // Morph区域
    const mOff = 54 + boneCount * 47;
    if (mOff < buf.length - 10) {
        console.log(`\nMorph区域(偏移 ${mOff}):`);
        console.log(`  原始hex: ${Array.from(new Uint8Array(buf, mOff, 20)).map(b=>b.toString(16).padStart(2,'0')).join(' ')}`);
        const mType = d.getUint32(mOff, true);
        const mCount = buf[mOff + 4];
        console.log(`  类型: ${mType}, 数量: ${mCount}`);
        
        if (mCount > 0 && mCount < 100) {
            for (let i = 0; i < Math.min(3, mCount); i++) {
                const mo = mOff + 5 + i * 19;
                const mn = new TextDecoder('shift-jis').decode(new Uint8Array(buf, mo, 15)).replace(/\0/g,'').trim();
                const mf = d.getUint32(mo + 15, true);
                const mw = d.getFloat32(mo + 15 + 4, true);
                console.log(`  morph[${i}]: "${mn}" @${mf} w=${mw.toFixed(2)}`);
            }
        }
    }
}

analyze(procBuf, '程序化 AutoDance VMD');
analyze(realBuf, '真实斜坐 VMD');

// 关键对比：头部30字节的精确差异
console.log('\n=== 头部30字节 hex 对比 ===');
console.log('程序化:', Array.from(new Uint8Array(procBuf, 0, 30)).map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log('真实  :', Array.from(new Uint8Array(realBuf, 0, 30)).map(b => b.toString(16).padStart(2, '0')).join(' '));

// 模型名20字节对比
console.log('\n=== 模型名20字节 hex 对比 ===');
console.log('程序化:', Array.from(new Uint8Array(procBuf, 30, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log('真实  :', Array.from(new Uint8Array(realBuf, 30, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
