#!/usr/bin/env python3
"""初始化 MyAgent 存储架构工作根目录。

用法：
    python init_myagent.py [--root <根目录>]

默认根目录为 D:\\MyAgent，可用 --root 覆盖（如 macOS/Linux 用户传入 ~/MyAgent）。
已在目标位置存在的文件/目录不会重复创建或覆盖。
"""
import argparse
import shutil
import sys
from pathlib import Path

DEFAULT_ROOT = r"D:\MyAgent"

# (落盘相对路径, 类型) —— 类型：dir=目录, asset=从 assets/<源文件名> 复制
# 资产文件名与落盘文件名不一致时，用 "落盘名:源名" 指定
STRUCTURE = [
    ("工程", "dir"),
    ("项目", "dir"),
    ("SKILL", "dir"),
    ("Agent_Rule.md", "asset"),
    ("总索引.md:总索引模板.md", "asset"),
]


def main() -> int:
    parser = argparse.ArgumentParser(description="初始化 MyAgent 存储架构工作根目录")
    parser.add_argument("--root", default=DEFAULT_ROOT, help=f"工作根目录，默认 {DEFAULT_ROOT}")
    args = parser.parse_args()

    root = Path(args.root).expanduser()
    assets = Path(__file__).resolve().parent.parent / "assets"

    if not assets.is_dir():
        print(f"错误：找不到 assets 目录：{assets}", file=sys.stderr)
        return 1

    root.mkdir(parents=True, exist_ok=True)
    created, existed = [], []

    for rel, kind in STRUCTURE:
        src_name = rel
        if ":" in rel:
            rel, src_name = rel.split(":", 1)
        target = root / rel
        if kind == "dir":
            if target.exists():
                existed.append(rel + "\\")
            else:
                target.mkdir()
                created.append(rel + "\\")
        else:  # asset
            if target.exists():
                existed.append(rel)
            else:
                src = assets / src_name
                if not src.is_file():
                    print(f"错误：assets 中缺少 {src_name}", file=sys.stderr)
                    return 1
                shutil.copyfile(src, target)
                created.append(rel)

    print(f"工作根目录：{root}")
    print("新建：")
    for item in created:
        print(f"  + {item}")
    if existed:
        print("已存在（未改动）：")
        for item in existed:
            print(f"  = {item}")
    print("\n下一步：打开 总索引.md，在「工程目录」表中登记你的第一个工程。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
