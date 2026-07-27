import zipfile

paths = [
    r"C:/Users/zhujieling11/MikuMikuAR/text-model/PMX/分类1/【阿卡夏之眼】[Tda][神帝宇]梦野樱-(红色冬季学院服-金边魔法黑丝).zip",
    r"C:/Users/zhujieling11/MikuMikuAR/text-model/PMX/分类1/【少女前线2：追放】妮基塔（无垢契约）.zip",
]

def probe(p):
    print("=" * 72)
    print("ZIP:", p.split("/")[-1])
    try:
        with zipfile.ZipFile(p) as z:
            infos = z.infolist()
            print("entry count:", len(infos))
            shown = 0
            for info in infos:
                fn = info.filename
                utf8_flag = bool(info.flag_bits & 0x800)
                # zipfile 对无 UTF-8 标志的条目用 cp437 解码；cp437 满射 0-255，可还原原始字节
                try:
                    raw = fn.encode("cp437")
                except UnicodeEncodeError:
                    raw = b""  # 已由 UTF-8 路径解码（含 >0xFF 字符）
                has_high = any(b > 0x7F for b in raw)
                sjis = gbk = None
                if has_high:
                    try:
                        sjis = raw.decode("shift_jis")
                    except Exception as e:
                        sjis = f"<err {e}>"
                    try:
                        gbk = raw.decode("gbk")
                    except Exception as e:
                        gbk = f"<err {e}>"
                if has_high or utf8_flag is False:
                    shown += 1
                    if shown <= 12:
                        print(f"  utf8_flag={utf8_flag} high={has_high} fn={fn!r}")
                        if has_high:
                            print(f"      raw_hex={raw[:24].hex()} shift_jis={sjis!r} gbk={gbk!r}")
            print("  (entries with high bytes or non-utf8 flag shown:", shown, ")")
    except Exception as e:
        print("ERROR:", repr(e))

for p in paths:
    probe(p)
