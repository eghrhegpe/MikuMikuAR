import sys, os

def write_ko():
    f_path = os.path.join(os.getcwd(), "README.ko.md")
    with open(f_path, "w", encoding="utf-8") as f:
        f.write("# 🎵 MikuMikuAR\n\n")
        f.write("> Wails v3 + Babylon.js / babylon-mmd 기반의 크로스플랫폼 MMD 데스크톱 플레이어——\n")
        f.write("> PMX 모델 뷰어, VMD 애니메이션 재생, 즉시 의상 변경, 프로시저얼 댄스, AR 카메라, 셀 셰이딩 렌더링, 한 곳에서 모두 해결.\n\n")

def write_tw():
    f_path = os.path.join(os.getcwd(), "README.zh-TW.md")
    with open(f_path, "w", encoding="utf-8") as f:
        f.write("# 🎵 MikuMikuAR\n\n")
        f.write("> 基於 Wails v3 + Babylon.js / babylon-mmd 的跨平台 MMD 桌面播放器——\n")
        f.write("> PMX 模型檢視、VMD 動作播放、即時換裝、程式化舞蹈、AR 相機、卡通化渲染，一次搞定。\n\n")

if __name__ == "__main__":
    write_ko()
    write_tw()
    print("Test Done")