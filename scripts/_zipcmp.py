import zipfile, os

A = r"C:\Users\zhujieling11\MikuMikuAR\text-model\PMX\【战舰少女】\【战舰少女R】列克星敦[洛里空](白色金饰军装外套-白短裤与黑长袜)@亚麻色长发御姐.zip"
B = r"C:\Users\zhujieling11\MikuMikuAR\text-model\PMX\【战舰少女】\【战舰少女R】驱逐舰-明斯克-38型(水手帽红星-露腰水手服)[空母大鳯]@淡橙马尾少女.zip"

def analyze(path, label):
    print("=" * 72)
    print(label, "->", os.path.basename(path))
    print("  文件大小:", os.path.getsize(path) if os.path.exists(path) else "不存在!")
    try:
        z = zipfile.ZipFile(path)
    except Exception as e:
        print("  !! 无法打开 zip:", repr(e))
        return
    bad = z.testzip()
    print("  完整性 testzip (None=正常):", bad)
    infos = z.infolist()
    print("  条目数:", len(infos))
    for i in infos:
        flag = ""
        if i.flag_bits & 0x1:
            flag += " [加密]"
        if i.compress_type == 0:
            flag += " [stored]"
        elif i.compress_type == 8:
            flag += " [deflate]"
        elif i.compress_type == 12:
            flag += " [bzip2]"
        elif i.compress_type == 9:
            flag += " [deflate64]"
        print(f"    ct={i.compress_type:2d} size={i.file_size:>9} {i.filename!r}{flag}")

analyze(A, "A=坏(列克星敦)")
analyze(B, "B=好(明斯克)")
