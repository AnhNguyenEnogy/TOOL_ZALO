# -*- mode: python ; coding: utf-8 -*-
import os
from PyInstaller.utils.hooks import collect_data_files

# Thu thập toàn bộ node_modules (cần cho zalo_bridge.mjs)
node_modules_datas = []
node_modules_path = os.path.join(os.getcwd(), 'node_modules')
for root, dirs, files in os.walk(node_modules_path):
    for f in files:
        full_path = os.path.join(root, f)
        rel_dir = os.path.relpath(root, os.getcwd())
        node_modules_datas.append((full_path, rel_dir))

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('zalo_bridge.mjs', '.'),
        ('package.json', '.'),
        *node_modules_datas,
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'torch', 'torchvision', 'torchaudio', 'gradio', 'gradio_client',
        'PyQt6', 'faster_whisper', 'onnxruntime', 'numpy', 'scipy',
        'matplotlib', 'pandas', 'sklearn', 'tensorflow',
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ZaloTool',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['zalo_icon.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='ZaloTool',
)
