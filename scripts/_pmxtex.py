import zipfile, struct, sys

A = r"C:\Users\zhujieling11\MikuMikuAR\text-model\PMX\【战舰少女】\【战舰少女R】列克星敦[洛里空](白色金饰军装外套-白短裤与黑长袜)@亚麻色长发御姐.zip"
B = r"C:\Users\zhujieling11\MikuMikuAR\text-model\PMX\【战舰少女】\【战舰少女R】驱逐舰-明斯克-38型(水手帽红星-露腰水手服)[空母大鳯]@淡橙马尾少女.zip"

class Reader:
    def __init__(self, buf):
        self.b = buf; self.o = 0
    def u8(self):
        v = self.b[self.o]; self.o += 1; return v
    def i32(self):
        v = struct.unpack_from('<i', self.b, self.o)[0]; self.o += 4; return v
    def f32(self):
        v = struct.unpack_from('<f', self.b, self.o)[0]; self.o += 4; return v
    def idx(self, size):
        if size == 1:
            v = self.b[self.o]; self.o += 1
        elif size == 2:
            v = struct.unpack_from('<H', self.b, self.o)[0]; self.o += 2
        else:
            v = struct.unpack_from('<I', self.b, self.o)[0]; self.o += 4
        return v
    def text(self, encode):
        n = self.i32()
        if encode == 0:  # UTF-16LE, n = code units
            raw = self.b[self.o:self.o + n*2]; self.o += n*2
            return raw.decode('utf-16-le', errors='replace')
        else:
            raw = self.b[self.o:self.o + n]; self.o += n
            return raw.decode('utf-8', errors='replace')

def parse_pmx(buf, label):
    print("=" * 72)
    print(label)
    r = Reader(buf)
    sig = r.b[0:4]
    if sig != b'PMX ':
        print("  !! 不是 PMX 文件, signature =", sig); return
    ver = r.f32()
    print("  version:", ver)
    encode = r.u8()
    addvec = r.u8()
    vidx = r.u8(); tidx = r.u8(); midx = r.u8(); bidx = r.u8(); moidx = r.u8(); ridx = r.u8()
    print(f"  encode={encode}(0=UTF16,1=UTF8) addvec={addvec} vIdx={vidx} tIdx={tidx} mIdx={midx} bIdx={bidx} moIdx={moidx}")
    name = r.text(encode); nameEn = r.text(encode)
    comment = r.text(encode); commentEn = r.text(encode)
    print("  model name:", repr(name[:60]))
    # vertices
    nv = r.i32()
    for _ in range(nv):
        r.o += 3*4 + 3*4 + 2*4 + addvec*4*4  # pos, normal, uv, addvec
        wt = r.u8()
        if wt == 0:
            r.o += bidx
        elif wt == 1:
            r.o += 2*bidx + 4
        elif wt == 2:
            r.o += 4*bidx + 4*4
        elif wt == 3:
            r.o += 2*bidx + 4 + 3*4*3
        elif wt == 4:
            r.o += 4*bidx + 4*4
        else:
            print("  !! 未知权重类型", wt); return
        r.o += 4  # edge scale
    print("  vertex count:", nv)
    # indices
    ni = r.i32()
    r.o += ni * vidx
    print("  index count:", ni)
    # texture table
    nt = r.i32()
    texs = [r.text(encode) for _ in range(nt)]
    print("  贴图数量:", nt)
    for t in texs:
        print("    ", repr(t))
    # 检查引用文件是否越界
    if r.o > len(buf):
        print("  !! 偏移越界, 解析可能出错")

def get_pmx_bytes(zippath, label):
    z = zipfile.ZipFile(zippath)
    for n in z.namelist():
        if n.lower().endswith('.pmx') and not z.getinfo(n).is_dir():
            print(f"  [{label}] PMX 内部路径: {n!r}")
            return z.read(n)
    return None

parse_pmx(get_pmx_bytes(A, "A"), "A=坏(列克星敦)")
parse_pmx(get_pmx_bytes(B, "B"), "B=好(明斯克)")
